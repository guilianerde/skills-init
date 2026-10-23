// 需求索引和运行状态共用同一把短时写锁；原子替换，避免读到半份 JSON。
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function readMeta(file) {
  if (!fs.existsSync(file)) return {};
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`无效的需求元信息：${file}`);
  return value;
}

export function updateMeta(file, update) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  let fd;
  try { fd = fs.openSync(lock, 'wx'); }
  catch (e) {
    if (e.code === 'EEXIST') throw new Error(`需求元信息正在写入，请稍后重试：${lock}`);
    throw e;
  }
  const tmp = `${file}.${randomUUID()}.tmp`;
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
    fs.unlinkSync(lock);
  }
}
