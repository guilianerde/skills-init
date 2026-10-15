#!/usr/bin/env node
// 按分类列出与某个 skill 相关的 DocNexus 文档（标题、摘要、路径，不含正文），供 skill 开工前挑选阅读。
// 相关分类来自 skill.json 的 docnexus.readFrom（列出要参考哪些 skill 的沉淀），分类名经 resolve.mjs category 解析，
// 所以项目画像改了分类名也能跟上。DocNexus 的 search / recall 不能按分类过滤，这里用 document query --category。
// 只读，不写入任何东西。
//
// 用法（在项目根执行；--root 可指定项目根）：
//   node .agents/skills/workflow/scripts/knowledge.mjs <skill> [--match 词1,词2] [--limit 20]
// --match：只保留标题 / 摘要 / 标签 / 路径里含任一词的文档（不区分大小写）；--limit：每个分类最多列出几篇（按更新时间倒序）
// 输出 JSON。退出码：0 正常；1 参数错误 / 未知 skill；2 未接入 DocNexus

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { skillMeta, resolveCategory, docnexusConnected } from './resolve.mjs';

const IS_WIN = process.platform === 'win32';

function query(root, category) {
  const bin = path.join(root, 'node_modules', '.bin', IS_WIN ? 'docnexus.cmd' : 'docnexus');
  const r = spawnSync(bin, ['document', 'query', '--all', '--category', category], { cwd: root, encoding: 'utf8', shell: IS_WIN, maxBuffer: 256 * 1024 * 1024 });
  try { if (r.status === 0) return { ok: true, documents: JSON.parse(r.stdout).documents ?? [] }; } catch { /* 非 JSON 输出 */ }
  return { ok: false, error: (r.stderr || r.stdout || 'document query 失败').trim().slice(0, 500) };
}

export function knowledge(root, skill, { match = [], limit = 20 } = {}) {
  const meta = skillMeta(skill);
  if (!meta) return { ok: false, error: 'unknown', message: `未安装 skill「${skill}」` };
  if (!docnexusConnected(root)) return { ok: false, error: 'no_docnexus', message: '未接入 DocNexus，跳过知识库参考' };
  const terms = match.map((t) => t.toLowerCase()).filter(Boolean);
  const hit = (d) => !terms.length || terms.some((t) => [d.title, d.summary, d.file_path, ...(d.tags ?? [])].some((v) => String(v ?? '').toLowerCase().includes(t)));
  const seen = new Set();
  const categories = [];
  for (const from of meta.docnexus?.readFrom ?? []) {
    const c = resolveCategory(root, from);
    if (!c.ok || seen.has(c.category)) continue; // 没装的 skill / 没声明分类的跳过
    seen.add(c.category);
    const q = query(root, c.category);
    if (!q.ok) { categories.push({ category: c.category, from, ok: false, error: q.error }); continue; }
    const docs = q.documents.filter(hit).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    categories.push({
      category: c.category, from, ok: true, total: docs.length,
      documents: docs.slice(0, limit).map((d) => ({ id: d.id, title: d.title, summary: d.summary, path: d.library_path, updated_at: d.updated_at })),
    });
  }
  return { ok: true, skill, categories };
}

function main(argv) {
  let root = process.cwd();
  const opts = { match: [], limit: 20 };
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = path.resolve(argv[++i] ?? '.');
    else if (argv[i] === '--match') opts.match = String(argv[++i] ?? '').split(/[,，]/).map((s) => s.trim());
    else if (argv[i] === '--limit') opts.limit = Number(argv[++i]);
    else args.push(argv[i]);
  }
  if (args.length !== 1 || !(opts.limit > 0)) {
    console.error('用法: knowledge.mjs [--root <项目根>] <skill> [--match 词1,词2] [--limit 20]');
    return 1;
  }
  const r = knowledge(root, args[0], opts);
  console.log(JSON.stringify(r, null, 2));
  return r.ok ? 0 : r.error === 'no_docnexus' ? 2 : 1;
}

const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exit(main(process.argv.slice(2)));
