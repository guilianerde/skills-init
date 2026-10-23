// 需求索引和运行状态共用同一把短时写锁；原子替换，避免读到半份 JSON。
// 锁和临时文件都放在 workflow-run/tmp/ 下（不放需求目录），崩溃残留不会混进 git；
// 锁里记 pid 和时间，超过 STALE_MS 且写入进程已不在时按陈旧锁清理，避免崩溃后永久卡死。
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

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

// 同一份 meta.json 的锁路径固定，跨机器无关；用需求目录的相对路径做文件名，便于人辨认。
function lockPath(root, file) {
  const rel = path.relative(root, file).replace(/[\\/]/g, '__').replace(/\.\./g, '');
  return path.join(root, LOCK_DIR, `${rel}.lock`);
}

const alive = (pid) => {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; } // 存在但不属于当前用户
};

function acquire(lock) {
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { return fs.openSync(lock, 'wx'); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const info = (() => { try { return JSON.parse(fs.readFileSync(lock, 'utf8')); } catch { return {}; } })();
      const age = Date.now() - (fs.statSync(lock).mtimeMs || 0);
      // 只有又旧又没进程在写才当陈旧锁清理；新锁或进程仍活着时老老实实报错
      if (age > STALE_MS && !alive(info.pid)) {
        fs.rmSync(lock, { force: true });
        continue;
      }
      throw new Error(`需求元信息正在写入，请稍后重试：${lock}${info.pid ? `（写入进程 ${info.pid}）` : ''}`);
    }
  }
  throw new Error(`需求元信息正在写入，请稍后重试：${lock}`);
}

export function updateMeta(file, update, { root = process.cwd() } = {}) {
  const lock = lockPath(root, file);
  const fd = acquire(lock);
  fs.writeFileSync(lock, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`);
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
    fs.closeSync(fd);
    fs.rmSync(lock, { force: true });
  }
}
