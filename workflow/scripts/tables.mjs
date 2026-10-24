#!/usr/bin/env node
// 找出改动（或指定文件）涉及哪些数据库表：dev 调研 / 自检、project-review 审 SQL 与 DDL 时先用它定位表，
// 再用 database-query 的 query.mjs --schema --tables <表> --indexes 只读拉取实际表结构、索引与行数核对。
// 规则：实体注解（@TableName / @Table，MyBatis-Plus 实体没写表名时按类名转下划线并标 inferred）、
// MyBatis XML 与代码字符串里的 SQL（FROM / JOIN / INTO / UPDATE）、.sql 脚本（CREATE / ALTER / DROP TABLE、CREATE INDEX ... ON 记为 DDL）。
// 只读；不连数据库。说明见 workflow/references/tables.md。
//
// 用法（在项目根执行；--root 可指定项目根）：
//   node .agents/skills/workflow/scripts/tables.mjs --diff <base>...<head>   # 分支对比：读 <head> 里改动过的文件
//   node .agents/skills/workflow/scripts/tables.mjs [--base <分支>]          # 未提交 + 已提交、相对基线的改动，读工作区；缺省基线取画像 main_branch（再缺省 main）
//   node .agents/skills/workflow/scripts/tables.mjs --files a.java,b.xml      # 指定文件（还没有改动时，调研读到的实体 / Mapper）
// 输出 JSON。退出码：0 正常；1 参数错误或 git 失败

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readProfile } from '../lib/project.mjs';

const SKILLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXT = /\.(java|kt|scala|groovy|go|py|ts|js|xml|sql)$/i;
const IDENT = '[`"\\[]?([A-Za-z_][\\w$]*(?:\\.[A-Za-z_][\\w$]*)?)[`"\\]]?';
const DML = new RegExp(`\\b(?:FROM|JOIN|INTO|UPDATE)\\s+${IDENT}`, 'gi');
const DDL = new RegExp(`\\b(?:CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?|ALTER\\s+TABLE|DROP\\s+TABLE(?:\\s+IF\\s+EXISTS)?|RENAME\\s+TABLE|TRUNCATE\\s+TABLE|CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+\\S+\\s+ON)\\s+${IDENT}`, 'gi');
const NOT_TABLE = new Set(['select', 'set', 'where', 'values', 'dual', 'table', 'if', 'the', 'a', 'an', 'to', 'of', 'and', 'or', 'not', 'null', 'lateral', 'unnest', 'json_table']);

const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;
const bare = (name) => name.split('.').pop();
const snake = (cls) => cls.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z])([A-Z][a-z])/g, '$1_$2').toLowerCase();

// 一个文件 → [{ table, line, how, ddl, inferred? }]
export function scan(file, text) {
  const out = [];
  const add = (name, idx, how, extra = {}) => {
    const t = bare(name);
    if (!t || NOT_TABLE.has(t.toLowerCase()) || /^\d/.test(t)) return;
    out.push({ table: t, line: lineOf(text, idx), how, ...extra });
  };
  const ext = path.extname(file).toLowerCase();
  if (ext === '.sql') {
    const body = text.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    for (const m of body.matchAll(DDL)) add(m[1], m.index, 'DDL', { ddl: true });
    for (const m of body.matchAll(DML)) add(m[1], m.index, 'SQL 脚本', { ddl: false });
    return dedupeByLine(out);
  }
  if (ext === '.xml') {
    const body = text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
    if (!/<mapper\b|<select\b|<insert\b|<update\b|<delete\b/i.test(body)) return [];
    // 去掉标签本身（<update id=...> 的 update 不是 SQL），保留标签之间的 SQL 文本与行号
    const sqlText = body.replace(/<[^>]*>/g, (m) => m.replace(/[^\n]/g, ' '));
    for (const m of sqlText.matchAll(DDL)) add(m[1], m.index, 'Mapper XML', { ddl: true });
    for (const m of sqlText.matchAll(DML)) add(m[1], m.index, 'Mapper XML', { ddl: false });
    return dedupeByLine(out);
  }
  // 代码：实体注解
  for (const m of text.matchAll(/@TableName\s*\(\s*(?:value\s*=\s*)?"([^"]+)"/g)) add(m[1], m.index, '@TableName', { ddl: false });
  for (const m of text.matchAll(/@Table\s*\([^)]*?\bname\s*=\s*"([^"]+)"/g)) add(m[1], m.index, '@Table', { ddl: false });
  // MyBatis-Plus / JPA 实体没写表名：按类名推断
  const named = /@TableName\s*\(\s*(?:value\s*=\s*)?"|@Table\s*\([^)]*\bname\s*=/.test(text);
  if (!named && /@TableName\b|@Entity\b/.test(text)) {
    const cls = /\bclass\s+([A-Z]\w*)/.exec(text);
    if (cls) add(snake(cls[1]), cls.index, '实体类名推断', { ddl: false, inferred: true });
  }
  // 代码里的 SQL 字符串（含 Java 文本块）
  for (const s of text.matchAll(/"""[\s\S]*?"""|"(?:[^"\\\n]|\\.)*"|`[^`]*`/g)) {
    const lit = s[0];
    if (!/\b(select|insert|update|delete|create|alter)\b/i.test(lit)) continue;
    for (const m of lit.matchAll(DDL)) add(m[1], s.index + m.index, 'SQL 字符串', { ddl: true });
    for (const m of lit.matchAll(DML)) add(m[1], s.index + m.index, 'SQL 字符串', { ddl: false });
  }
  return dedupeByLine(out);
}

// 同一行同一张表只记一次，DDL 优先
function dedupeByLine(items) {
  const m = new Map();
  for (const it of items) {
    const k = `${it.table.toLowerCase()}:${it.line}`;
    if (!m.has(k) || (it.ddl && !m.get(k).ddl)) m.set(k, it);
  }
  return [...m.values()];
}

// database-query/references/schema.md 里已导出的表名（### <表>）
export function schemaTables(file = path.join(SKILLS_DIR, 'database-query', 'references', 'schema.md')) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  return new Set([...text.matchAll(/^###\s+`?([\w$.]+)`?/gm)].map((m) => bare(m[1]).toLowerCase()));
}

const git = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

export function collect(root, { diff = null, base = null, files = null } = {}) {
  let list;
  let read;
  let range;
  if (files) {
    list = files;
    read = (f) => { try { return fs.readFileSync(path.resolve(root, f), 'utf8'); } catch { return null; } };
    range = null;
  } else if (diff) {
    const head = diff.split(/\.{2,3}/)[1] || 'HEAD';
    const r = git(root, ['diff', '--name-only', '--diff-filter=d', diff]);
    if (r.status !== 0) return { ok: false, error: r.stderr.trim() || `git diff ${diff} 失败` };
    list = r.stdout.split('\n').filter(Boolean);
    read = (f) => { const s = git(root, ['show', `${head}:${f}`]); return s.status === 0 ? s.stdout : null; };
    range = diff;
  } else {
    const b = base || readProfile(root).profile.main_branch || 'main';
    const mb = git(root, ['merge-base', b, 'HEAD']);
    const from = mb.status === 0 ? mb.stdout.trim() : b;
    const r = git(root, ['diff', '--name-only', '--diff-filter=d', from]);
    if (r.status !== 0) return { ok: false, error: r.stderr.trim() || `git diff ${b} 失败` };
    const untracked = git(root, ['ls-files', '--others', '--exclude-standard']).stdout.split('\n').filter(Boolean);
    list = [...new Set([...r.stdout.split('\n').filter(Boolean), ...untracked])];
    read = (f) => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return null; } };
    range = `${b}（含未提交）`;
  }
  const scanned = list.filter((f) => EXT.test(f));
  const byTable = new Map();
  for (const f of scanned) {
    const text = read(f);
    if (text == null) continue;
    for (const hit of scan(f, text)) {
      const k = hit.table.toLowerCase();
      if (!byTable.has(k)) byTable.set(k, { table: hit.table, ddl: false, inferred: true, sources: [] });
      const t = byTable.get(k);
      t.ddl ||= hit.ddl;
      t.inferred &&= !!hit.inferred;
      t.sources.push({ file: f, line: hit.line, how: hit.how });
    }
  }
  const known = schemaTables();
  const tables = [...byTable.values()].sort((a, b) => Number(b.ddl) - Number(a.ddl) || a.table.localeCompare(b.table))
    .map((t) => ({ ...t, in_schema_md: known ? known.has(t.table.toLowerCase()) : null }));
  const names = tables.map((t) => t.table);
  return {
    ok: true, range, files_scanned: scanned.length, tables,
    next: names.length ? `node <skills>/database-query/scripts/query.mjs --schema --tables ${names.join(',')} --indexes` : null,
  };
}

function main(argv) {
  let root = process.cwd();
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = path.resolve(argv[++i] ?? '.');
    else if (argv[i] === '--diff') o.diff = argv[++i] ?? null;
    else if (argv[i] === '--base') o.base = argv[++i] ?? null;
    else if (argv[i] === '--files') o.files = (argv[++i] ?? '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    else { console.error('用法: tables.mjs [--diff <base>...<head> | --base <分支> | --files a,b]'); return 1; }
  }
  if (o.diff && !/\.{2,3}/.test(o.diff)) { console.error('--diff 写成 <base>...<head>'); return 1; }
  const r = collect(root, o);
  console.log(JSON.stringify(r, null, 2));
  return r.ok ? 0 : 1;
}

const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exit(main(process.argv.slice(2)));
