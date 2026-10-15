#!/usr/bin/env node
// database-query 的执行入口：读本 skill 目录的 config.json，按规则选连接、取密码、强制只读、补 LIMIT、超时、脱敏，
// 再调用本机 mysql / psql 客户端。把这些规则固化在脚本里，而不是每次由 agent 手拼命令。
//
// 用法（在项目根执行）：
//   node .agents/skills/database-query/scripts/query.mjs [选项] "<SQL>"
//   echo "<SQL>" | node .../query.mjs [选项]
// 选项：
//   --conn <名称>     连接名；缺省用 default_connection（再缺省用 default）
//   --limit <n>       SELECT / WITH 没写 LIMIT 时自动补上，默认 200；0 = 不补
//   --timeout <秒>    超时，默认 30
//   --format md|tsv|json   输出格式，默认 md
//   --write           在 readonly=false 的连接上执行写语句（必须先得到用户明确同意）
//   --no-mask         不脱敏（仅在用户明确要求时使用）
//   --list            列出连接（不含凭据）
//   --schema [--tables a,b] [--write]   导出表结构为 Markdown；--write 写入 references/schema.md（begin/end 标记之间，先经用户确认）
// 退出码：0 成功；1 执行失败；2 参数 / 配置 / 只读拦截；3 本机没有对应客户端（改用 SKILL.md 中的 JDBC 方式）

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const READ_KEYWORDS = new Set(['select', 'show', 'describe', 'desc', 'explain', 'with']);
const WRITE_WORDS = /\b(insert|update|delete|merge|upsert|drop|alter|create|truncate|grant|revoke|call|copy)\b/i; // 只用于 WITH：识别数据修改型 CTE
// 默认脱敏的列名；config.json 顶层或连接上的 mask_columns（正则字符串数组）会追加进来
const SECRET_COLS = /pass(word)?|passwd|pwd|secret|token|api_?key|private_?key|salt/i;
const PII_COLS = /phone|mobile|tel|id_?card|id_?no|identity|ssn|bank_?card|card_?no|account_?no|email/i;

class UsageError extends Error {}

// 去掉注释与字符串字面量（替换为空串占位），用于关键字判断；不追求完整 SQL 解析
export function stripSql(sql) {
  let out = '';
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], n = sql[i + 1];
    if (c === '-' && n === '-' || c === '#') { while (i < sql.length && sql[i] !== '\n') i++; out += ' '; continue; }
    if (c === '/' && n === '*') { i = sql.indexOf('*/', i + 2); if (i < 0) i = sql.length; else i++; out += ' '; continue; }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === c && sql[j + 1] !== c)) j += sql[j] === c || sql[j] === '\\' ? 2 : 1;
      out += c === '`' || c === '"' ? 'ident' : "''";
      i = j; continue;
    }
    out += c;
  }
  return out;
}

// 返回 { kind: 'read' | 'write', keyword }；多条语句直接拒绝
export function classify(sql) {
  const s = stripSql(sql).trim().replace(/;\s*$/, '');
  if (!s) throw new UsageError('SQL 为空');
  if (s.includes(';')) throw new UsageError('一次只执行一条语句（检测到多个 ;）');
  const keyword = s.match(/^\(?\s*([a-z]+)/i)?.[1].toLowerCase() ?? '';
  if (!READ_KEYWORDS.has(keyword)) return { kind: 'write', keyword };
  if (keyword === 'with' && WRITE_WORDS.test(s)) return { kind: 'write', keyword };
  if (/\binto\s+(outfile|dumpfile)\b|\bfor\s+update\b/i.test(s)) return { kind: 'write', keyword };
  return { kind: 'read', keyword };
}

// SELECT / WITH 没有 LIMIT / FETCH FIRST 时补 LIMIT（多取 1 行用来判断是否截断）
export function addLimit(sql, limit) {
  const body = sql.trim().replace(/;\s*$/, '');
  const { keyword } = classify(body);
  if (!limit || !['select', 'with'].includes(keyword)) return { sql: body, limited: false };
  if (/\blimit\s+\d+|\bfetch\s+(first|next)\b/i.test(stripSql(body))) return { sql: body, limited: false };
  return { sql: `${body}\nLIMIT ${limit + 1}`, limited: true };
}

export function maskValue(col, v) {
  if (v === '' || v === 'NULL' || v == null) return v;
  if (SECRET_COLS.test(col)) return '******';
  const s = String(v);
  if (s.includes('@')) { const [u, d] = s.split('@'); return `${u.slice(0, 1)}***@${d}`; }
  return s.length > 7 ? `${s.slice(0, 3)}****${s.slice(-4)}` : '****';
}

export function parseTsv(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter((l, i, a) => !(l === '' && i === a.length - 1));
  if (!lines.length) return { columns: [], rows: [] };
  return { columns: lines[0].split('\t'), rows: lines.slice(1).map((l) => l.split('\t')) };
}

function loadConfig() {
  const f = path.join(SKILL_DIR, 'config.json');
  if (!fs.existsSync(f)) throw new UsageError(`未找到 ${f}：重跑 skills-init 配置数据库，或按 references/config.example.json 手动创建`);
  const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!cfg.connections || !Object.keys(cfg.connections).length) throw new UsageError('config.json 中没有 connections');
  return cfg;
}

function pickConn(cfg, name) {
  const want = name || cfg.default_connection || 'default';
  const conn = cfg.connections[want];
  if (!conn) throw new UsageError(`连接「${want}」不存在；已有：${Object.keys(cfg.connections).join('、')}`);
  return { name: want, conn };
}

function password(conn) {
  if (conn.password_env && process.env[conn.password_env]) return process.env[conn.password_env];
  if (process.env.DB_PASSWORD) return process.env.DB_PASSWORD;
  if (conn.password) return conn.password;
  throw new UsageError(`没有可用的密码：请设置环境变量 ${conn.password_env || 'DB_PASSWORD'}（不要在对话里贴密码）`);
}

function onPath(bin) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' });
  return r.status === 0;
}

function buildCommand(conn, readonly, sql, timeoutMs, pwd) {
  const driver = String(conn.driver || 'mysql').toLowerCase();
  if (driver === 'mysql' || driver === 'mariadb') {
    const args = ['-h', conn.host, '-P', String(conn.port || 3306), '-u', conn.user, '--batch', '--default-character-set=utf8mb4', '--connect-timeout=10'];
    if (readonly) args.push('--init-command=SET SESSION TRANSACTION READ ONLY');
    args.push(conn.database, '-e', sql);
    return { bin: 'mysql', args, env: { MYSQL_PWD: pwd } };
  }
  if (driver === 'postgresql' || driver === 'postgres' || driver === 'pg') {
    const opts = [`-c statement_timeout=${timeoutMs}`];
    if (readonly) opts.push('-c default_transaction_read_only=on');
    const args = ['-X', '-A', '-F', '\t', '-P', 'footer=off', '-v', 'ON_ERROR_STOP=1', '-h', conn.host, '-p', String(conn.port || 5432), '-U', conn.user, '-d', conn.database, '-c', sql];
    return { bin: 'psql', args, env: { PGPASSWORD: pwd, PGOPTIONS: opts.join(' '), PGCONNECT_TIMEOUT: '10' } };
  }
  return null;
}

function mdCell(v) { return String(v ?? '').replace(/\|/g, '\\|').replace(/\\n/g, '<br>'); }

function render(fmt, res) {
  if (fmt === 'json') return JSON.stringify(res, null, 2);
  const { columns, rows } = res;
  if (fmt === 'tsv') return [columns.join('\t'), ...rows.map((r) => r.join('\t'))].join('\n');
  const head = `连接：${res.connection}（${res.readonly ? '只读' : '可写'}）｜ 耗时：${res.elapsed_ms} ms ｜ 返回行数：${rows.length}${res.truncated ? `（已截断，仅显示前 ${rows.length} 行）` : ''}`;
  const notes = [];
  if (res.limit_added) notes.push(`已自动追加 LIMIT ${res.limit}`);
  if (res.masked.length) notes.push(`已脱敏列：${res.masked.join('、')}`);
  if (!columns.length) return [head, ...notes, '（无结果集）'].join('\n');
  const table = [`| ${columns.map(mdCell).join(' | ')} |`, `|${columns.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(mdCell).join(' | ')} |`)];
  return [head, ...notes, '', ...table].join('\n');
}

function parseArgs(argv) {
  const o = { conn: '', limit: 200, timeout: 30, format: 'md', write: false, mask: true, list: false, schema: false, tables: '', sql: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new UsageError(`${a} 需要一个值`); return argv[++i]; };
    switch (a) {
      case '--conn': o.conn = val(); break;
      case '--limit': o.limit = Number(val()); break;
      case '--timeout': o.timeout = Number(val()); break;
      case '--format': o.format = val(); break;
      case '--write': o.write = true; break;
      case '--no-mask': o.mask = false; break;
      case '--list': o.list = true; break;
      case '--schema': o.schema = true; break;
      case '--tables': o.tables = val(); break;
      default:
        if (a.startsWith('--')) throw new UsageError(`未知参数 ${a}`);
        o.sql = o.sql ? `${o.sql} ${a}` : a;
    }
  }
  if (!Number.isInteger(o.limit) || o.limit < 0) throw new UsageError('--limit 需为非负整数');
  if (!(o.timeout > 0)) throw new UsageError('--timeout 需为正数');
  if (!['md', 'tsv', 'json'].includes(o.format)) throw new UsageError('--format 只支持 md / tsv / json');
  return o;
}

// 执行一条 SQL（调用方已完成语句检查），返回 { code, error, columns, rows, elapsed }；code 同退出码约定
export function execute(conn, readonly, sql, timeoutSec) {
  const timeoutMs = Math.round(timeoutSec * 1000);
  const cmd = buildCommand(conn, readonly, sql, timeoutMs, password(conn));
  if (!cmd) return { code: 3, error: `不支持的 driver「${conn.driver}」：按 SKILL.md 用项目的 JDBC 驱动写临时查询类（conn.setReadOnly(true)）` };
  if (!onPath(cmd.bin)) return { code: 3, error: `本机没有 ${cmd.bin} 客户端：按 SKILL.md 改用 JDBC 临时查询类，或给出 SQL 让用户手动执行` };
  const t0 = Date.now();
  const r = spawnSync(cmd.bin, cmd.args, { encoding: 'utf8', env: { ...process.env, ...cmd.env }, timeout: timeoutMs + 5000, maxBuffer: 64 * 1024 * 1024 });
  const elapsed = Date.now() - t0;
  if (r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM') return { code: 1, error: `查询超时（${timeoutSec}s），已终止。缩小范围或加索引条件后重试` };
  if (r.status !== 0) return { code: 1, error: (r.stderr || r.stdout || '执行失败').trim() };
  return { code: 0, elapsed, ...parseTsv(r.stdout) };
}

// ---------------------------------------------------------------- 表结构导出（--schema）
const SCHEMA_BEGIN = '<!-- schema:begin -->';
const SCHEMA_END = '<!-- schema:end -->';

export function schemaSql(driver, tables) {
  const pg = /^(postgres|postgresql|pg)$/i.test(driver);
  const list = tables.map((t) => `'${t}'`).join(', ');
  if (pg) {
    return `SELECT c.table_name, c.column_name, c.data_type, c.is_nullable, CASE WHEN k.column_name IS NOT NULL THEN 'PRI' ELSE '' END AS column_key, c.column_default, coalesce(pgd.description, '') AS column_comment, coalesce(obj_description(st.relid), '') AS table_comment
FROM information_schema.columns c
LEFT JOIN pg_catalog.pg_statio_all_tables st ON st.schemaname = c.table_schema AND st.relname = c.table_name
LEFT JOIN pg_catalog.pg_description pgd ON pgd.objoid = st.relid AND pgd.objsubid = c.ordinal_position
LEFT JOIN (SELECT kcu.table_name, kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = current_schema()) k ON k.table_name = c.table_name AND k.column_name = c.column_name
WHERE c.table_schema = current_schema()${tables.length ? ` AND c.table_name IN (${list})` : ''}
ORDER BY c.table_name, c.ordinal_position`;
  }
  return `SELECT c.TABLE_NAME, c.COLUMN_NAME, c.COLUMN_TYPE, c.IS_NULLABLE, c.COLUMN_KEY, c.COLUMN_DEFAULT, c.COLUMN_COMMENT, t.TABLE_COMMENT
FROM information_schema.COLUMNS c JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
WHERE c.TABLE_SCHEMA = DATABASE()${tables.length ? ` AND c.TABLE_NAME IN (${list})` : ''}
ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`;
}

// 列结果 -> Markdown：每张表一节（表注释、字段表）
export function schemaMarkdown(connName, conn, rows) {
  const byTable = new Map();
  for (const [table, col, type, nullable, key, def, comment, tcomment] of rows) {
    if (!byTable.has(table)) byTable.set(table, { comment: tcomment, cols: [] });
    byTable.get(table).cols.push({ col, type, nullable, key, def, comment });
  }
  const cell = (v) => (v == null || v === 'NULL' ? '' : String(v).replace(/\|/g, '\\|').replace(/\\n/g, ' '));
  const out = [SCHEMA_BEGIN, `<!-- 由 query.mjs --schema 生成：连接 ${connName}（${conn.database}），${new Date().toISOString().slice(0, 10)}。重新生成会替换 begin/end 之间的内容，补充说明请写在外面。 -->`, ''];
  out.push(`共 ${byTable.size} 张表：${[...byTable.keys()].map((t) => `\`${t}\``).join('、')}`, '');
  for (const [table, { comment, cols }] of byTable) {
    out.push(`### ${table}${comment ? ` — ${cell(comment)}` : ''}`, '', '| 字段 | 类型 | 可空 | 键 | 默认值 | 说明 |', '|---|---|---|---|---|---|');
    for (const c of cols) out.push(`| ${cell(c.col)} | ${cell(c.type)} | ${c.nullable === 'YES' ? '是' : '否'} | ${cell(c.key)} | ${cell(c.def)} | ${cell(c.comment)} |`);
    out.push('');
  }
  out.push(SCHEMA_END);
  return out.join('\n');
}

// 写入 schema.md：替换 begin/end 之间的内容；没有标记时追加到末尾，其他内容保留
export function mergeSchema(existing, block) {
  const a = existing.indexOf(SCHEMA_BEGIN), b = existing.indexOf(SCHEMA_END);
  if (a >= 0 && b > a) return existing.slice(0, a) + block + existing.slice(b + SCHEMA_END.length);
  return `${existing.replace(/\s*$/, '')}\n\n## 表结构（自动导出）\n\n${block}\n`;
}

export function main(argv) {
  const o = parseArgs(argv);
  const cfg = loadConfig();
  if (o.list) {
    for (const [name, c] of Object.entries(cfg.connections)) {
      const def = name === (cfg.default_connection || 'default') ? '（默认）' : '';
      console.log(`${name}${def}: ${c.driver || 'mysql'} ${c.host}:${c.port || ''}/${c.database} user=${c.user} ${c.readonly === false ? '可写' : '只读'}`);
    }
    return 0;
  }
  const { name, conn } = pickConn(cfg, o.conn);
  const readonly = conn.readonly !== false;

  if (o.schema) {
    const tables = o.tables ? o.tables.split(/[,，\s]+/).filter(Boolean) : [];
    const badName = tables.find((t) => !/^[\w$]+$/.test(t));
    if (badName) throw new UsageError(`表名不合法：${badName}`);
    // 表结构查询只读，无论连接是否可写都按只读会话执行
    const r = execute(conn, true, schemaSql(conn.driver || 'mysql', tables), o.timeout);
    if (r.code) { console.error(r.error); return r.code; }
    if (!r.rows.length) { console.error(tables.length ? `没有找到表：${tables.join('、')}` : '当前库 / schema 下没有表'); return 1; }
    const block = schemaMarkdown(name, conn, r.rows);
    if (!o.write) { console.log(block); return 0; }
    const f = path.join(SKILL_DIR, 'references', 'schema.md');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, mergeSchema(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '# Schema Notes\n', block));
    console.log(`已写入 ${f}（${new Set(r.rows.map((x) => x[0])).size} 张表）`);
    return 0;
  }

  if (!o.sql && !process.stdin.isTTY) o.sql = fs.readFileSync(0, 'utf8');
  const { kind, keyword } = classify(o.sql);
  if (kind === 'write' && readonly) throw new UsageError(`连接「${name}」是只读的，拒绝执行 ${keyword.toUpperCase()}。需要写操作时请用户在 config.json 配置 "readonly": false 的连接并点名使用`);
  if (kind === 'write' && !o.write) throw new UsageError(`${keyword.toUpperCase()} 是写操作：先向用户说明影响并得到明确同意，再加 --write 执行`);
  const { sql, limited } = kind === 'read' ? addLimit(o.sql, o.limit) : { sql: o.sql.trim(), limited: false };
  const r = execute(conn, readonly, sql, o.timeout);
  if (r.code) { console.error(r.error); return r.code; }

  let { columns, rows } = r;
  const truncated = limited && rows.length > o.limit;
  if (truncated) rows = rows.slice(0, o.limit);
  const extra = [...(cfg.mask_columns || []), ...(conn.mask_columns || [])].map((p) => new RegExp(p, 'i'));
  const maskIdx = o.mask ? columns.map((c, i) => (SECRET_COLS.test(c) || PII_COLS.test(c) || extra.some((re) => re.test(c)) ? i : -1)).filter((i) => i >= 0) : [];
  if (maskIdx.length) rows = rows.map((row) => row.map((v, i) => (maskIdx.includes(i) ? maskValue(columns[i], v) : v)));
  console.log(render(o.format, {
    connection: name, readonly, sql, elapsed_ms: r.elapsed, columns, rows, truncated,
    limit_added: limited, limit: o.limit, masked: maskIdx.map((i) => columns[i]),
  }));
  return 0;
}

const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) {
  try { process.exit(main(process.argv.slice(2))); } catch (e) {
    if (e instanceof UsageError || e instanceof SyntaxError) { console.error(`错误：${e.message}`); process.exit(2); }
    throw e;
  }
}
