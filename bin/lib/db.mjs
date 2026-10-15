// 数据库连接配置：查找已有配置、交互填写、写入 config.json

import fs from 'node:fs';
import path from 'node:path';
import { step, ok, warn, readJson, writeFile } from './core.mjs';
import { ask } from './prompt.mjs';

// 已有配置中的默认连接：default_connection → default → 第一个连接
export function defaultConn(cfg) {
  const conns = cfg?.connections;
  if (!conns || typeof conns !== 'object') return null;
  const name = cfg.default_connection && conns[cfg.default_connection] ? cfg.default_connection
    : conns.default ? 'default' : Object.keys(conns)[0];
  return name ? { name, conn: conns[name] } : null;
}
export function findExistingDbConfig(root) {
  for (const rel of ['.codex/database-query/config.json', '.agents/skills/database-query/config.json',
    '.claude/skills/database-query/config.json', '.qwen/skills/database-query/config.json']) {
    const f = path.join(root, rel);
    const cfg = readJson(f);
    const d = defaultConn(cfg);
    if (d?.conn?.host) return { file: f, cfg, ...d };
  }
  return null;
}
// 返回 { name, conn, reused, sourceCfg }；null 表示跳过
export async function getDb(o) {
  const existing = findExistingDbConfig(o.root);
  if (existing && existing.conn.database) {
    const c = existing.conn;
    const pw = c.password_env ? `$${c.password_env}` : c.password ? '****' : '';
    step('数据库连接配置');
    console.log(`    检测到现有配置: ${existing.file}`);
    console.log(`    连接=${existing.name}  driver=${c.driver || 'mysql'}  host=${c.host}:${c.port ?? '?'}  db=${c.database}  user=${c.user || ''}  password=${pw}  readonly=${c.readonly === false ? 'false' : 'true'}`);
    const db = { name: existing.name, conn: c, reused: true, sourceCfg: existing.cfg };
    if (o.yes) { ok('非交互模式，使用现有配置'); return db; }
    const a = (await ask('使用此配置？[Y=使用 / n=重新填写 / s=跳过数据库]: ')).toLowerCase();
    if (a === 's' || a === 'skip') return null;
    if (a !== 'n') return db;
  }
  if (o.yes) return null;
  step('填写数据库连接（写入 database-query/config.json 的 default 连接，并加入 .gitignore）');
  const driver = (await ask('数据库驱动 [mysql]: ')) || 'mysql';
  const host = await ask('数据库主机: ');
  const portStr = await ask('端口: ');
  const database = await ask('数据库名: ');
  const user = await ask('用户名: ');
  const password = await ask('密码（留空则改用环境变量，推荐）: ', { hidden: true });
  const passwordEnv = password ? '' : ((await ask('密码所在的环境变量名 [DB_PASSWORD]: ')) || 'DB_PASSWORD');
  const ro = (await ask('设为只读连接？[Y/n]: ')).toLowerCase();
  const port = /^\d+$/.test(portStr) ? Number(portStr) : (driver === 'postgresql' ? 5432 : 3306);
  if (!host || !database || !user) { warn('主机/库名/用户不能为空，跳过数据库配置'); return null; }
  const conn = { driver, host, port, database, user };
  if (password) conn.password = password; else conn.password_env = passwordEnv;
  conn.readonly = ro !== 'n';
  return { name: 'default', conn, reused: false };
}

// config.json 不来自模板：沿用已有配置时原样保留；新填写的连接写入 default，并保留文件中的其他连接
export function writeDbConfig(dst, db) {
  if (!db) return fs.existsSync(dst) ? 'config.json 已存在，保留不覆盖' : '未生成 config.json（未配置数据库）';
  if (db.reused && fs.existsSync(dst)) return 'config.json 沿用已有配置';
  const base = readJson(dst) || (db.reused ? db.sourceCfg : null) || {};
  const cfg = { ...base, connections: { ...(base.connections || {}), [db.name]: db.conn } };
  if (!cfg.default_connection || !cfg.connections[cfg.default_connection]) cfg.default_connection = db.name;
  writeFile(dst, JSON.stringify(cfg, null, 2) + '\n');
  return `config.json 已写入（连接 ${db.name}，${db.conn.readonly === false ? '可写' : '只读'}）`;
}
