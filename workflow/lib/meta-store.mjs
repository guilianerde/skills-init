// 需求索引和运行状态共用同一把短时写锁；原子替换，避免读到半份 JSON。
// 锁和临时文件都放在 workflow-run/tmp/ 下（不放需求目录），崩溃残留不会混进 git；
// 锁目录里的唯一进程标记记录 pid 和时间；只回收已退出进程的旧标记，非空目录不能删除。
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const STALE_MS = 30_000;
const LOCK_DIR = 'workflow-run/tmp/locks'; // 与 requirement.mjs 的 HOME / TMP_DIR 一致；不 import 以免循环依赖

export function readMeta(file) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8');
  let value;
  try { value = JSON.parse(text); }
  catch { throw new Error(`需求元信息不是合法 JSON，已停止写入以免覆盖：${file}（修复或删除该文件后重试）`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`无效的需求元信息：${file}`);
  return value;
}

// 固定长度，避免中文需求名与项目名拼接后超过文件名限制，也避免分隔符替换碰撞。
function lockPath(root, file) {
  const target = path.join(fs.realpathSync.native(path.dirname(file)), path.basename(file));
  const rel = path.relative(fs.realpathSync.native(root), target).split(path.sep).join('/');
  const key = createHash('sha256').update(rel).digest('hex');
  return path.join(root, LOCK_DIR, `${key}.lock`);
}

const alive = (pid) => {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; } // 存在但不属于当前用户
};

const busy = (lock) => new Error(`需求元信息正在写入，请稍后重试：${lock}`);
const expired = (file) => Date.now() - fs.statSync(file).mtimeMs > STALE_MS;

function removeEmptyLock(lock) {
  try { fs.rmdirSync(lock); return true; }
  catch (e) {
    if (e.code === 'ENOENT') return true;
    if (e.code === 'ENOTEMPTY' || e.code === 'EEXIST') return false;
    throw e;
  }
}

function reclaim(lock) {
  try {
    const owners = fs.readdirSync(lock);
    if (!owners.length && !expired(lock)) return false;
    for (const name of owners) {
      const pid = /^(\d+)-[\da-f-]+\.json$/.exec(name)?.[1];
      const owner = path.join(lock, name);
      if (!pid || alive(Number(pid)) || !expired(owner)) return false;
      // UUID 标记不复用。即使另一个进程已重建目录，也不会删到它的标记。
      try { fs.unlinkSync(owner); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    return removeEmptyLock(lock);
  } catch (e) {
    if (e.code === 'ENOENT') return !fs.existsSync(lock);
    throw e;
  }
}

function acquire(lock) {
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { fs.mkdirSync(lock); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (reclaim(lock)) continue;
      throw busy(lock);
    }
    const name = `${process.pid}-${randomUUID()}.json`;
    const owner = path.join(lock, name);
    const release = () => {
      try { fs.unlinkSync(owner); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      removeEmptyLock(lock);
    };
    try {
      fs.writeFileSync(owner, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`, { flag: 'wx' });
      // mkdir 后进程若停顿到空目录过期，其他进程可能已经重建目录。
      const owners = fs.readdirSync(lock);
      if (owners.length !== 1 || owners[0] !== name) throw busy(lock);
      return release;
    } catch (e) {
      release();
      if (e.code === 'ENOENT') throw busy(lock);
      throw e;
    }
  }
  throw busy(lock);
}

export function updateMeta(file, update, { root = process.cwd() } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = lockPath(root, file);
  const release = acquire(lock);
  const tmp = path.join(path.dirname(lock), `${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    const next = update(readMeta(file));
    const text = `${JSON.stringify(next, null, 2)}\n`;
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) {
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, file);
    }
    return next;
  } finally {
    fs.rmSync(tmp, { force: true });
    release();
  }
}
