#!/usr/bin/env node
// 按分类列出与某个 skill 相关的 DocNexus 文档（标题、摘要、路径，不含正文），供 skill 开工前挑选阅读。
// 相关分类来自 skill.json 的 docnexus.readFrom（列出要参考哪些 skill 的沉淀），分类名经 resolve.mjs category 解析，
// 所以项目画像改了分类名也能跟上。列表用 document query --category；给了 --query 时再在每个分类内 recall
// （DocNexus 0.16.0 起 recall 支持 --category；旧版不支持时只列文档，并提示改用不带分类的 recall）。
// 只读，不写入任何东西。
//
// 用法（在项目根执行；--root 可指定项目根）：
//   node .agents/skills/workflow/scripts/knowledge.mjs <skill> [--match 词1,词2] [--limit 20] [--query "<问题>" [--recall-limit 5]]
// --match：只保留标题 / 摘要 / 标签 / 路径里含任一词的文档（不区分大小写）；--limit：每个分类最多列出几篇（按更新时间倒序）
// --query：在每个分类内 recall，结果放进该分类的 recall 字段（按正文检索，补上 --match 只看标题摘要的不足）
// 输出 JSON。退出码：0 正常；1 参数错误 / 未知 skill；2 未接入 DocNexus

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { skillMeta, resolveCategory, docnexusConnected, docnexusBin } from './resolve.mjs';

const IS_WIN = process.platform === 'win32';

const docnexus = (root, args) => spawnSync(path.join(root, docnexusBin(root) ?? path.join('node_modules', '.bin', 'docnexus')), args,
  { cwd: root, encoding: 'utf8', shell: IS_WIN, maxBuffer: 256 * 1024 * 1024 });

function runJson(root, args, what) {
  const r = docnexus(root, args);
  try { if (r.status === 0) return { ok: true, data: JSON.parse(r.stdout) }; } catch { /* 非 JSON 输出 */ }
  return { ok: false, error: (r.stderr || r.stdout || `${what} 失败`).trim().slice(0, 500) };
}

function query(root, category) {
  const r = runJson(root, ['document', 'query', '--all', '--category', category], 'document query');
  return r.ok ? { ok: true, documents: r.data.documents ?? [] } : r;
}

// 旧版会静默忽略不认识的参数，recall 会退化成全库检索，所以先看帮助里 recall 有没有 --category
export function recallSupportsCategory(root) {
  const r = docnexus(root, ['--help']);
  return /recall[^\n]*--category/.test(`${r.stdout}${r.stderr}`);
}

export function knowledge(root, skill, { match = [], limit = 20, query: question = '', recallLimit = 5 } = {}) {
  const meta = skillMeta(skill);
  if (!meta) return { ok: false, error: 'unknown', message: `未安装 skill「${skill}」` };
  if (!docnexusConnected(root)) return { ok: false, error: 'no_docnexus', message: '未接入 DocNexus，跳过知识库参考' };
  const terms = match.map((t) => t.toLowerCase()).filter(Boolean);
  const hit = (d) => !terms.length || terms.some((t) => [d.title, d.summary, d.file_path, ...(d.tags ?? [])].some((v) => String(v ?? '').toLowerCase().includes(t)));
  const byCategory = question ? recallSupportsCategory(root) : false;
  const seen = new Set();
  const categories = [];
  for (const from of meta.docnexus?.readFrom ?? []) {
    const c = resolveCategory(root, from);
    if (!c.ok || seen.has(c.category)) continue; // 没装的 skill / 没声明分类的跳过
    seen.add(c.category);
    const q = query(root, c.category);
    if (!q.ok) { categories.push({ category: c.category, from, ok: false, error: q.error }); continue; }
    const docs = q.documents.filter(hit).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    const entry = {
      category: c.category, from, ok: true, total: docs.length,
      documents: docs.slice(0, limit).map((d) => ({ id: d.id, title: d.title, summary: d.summary, path: d.library_path, updated_at: d.updated_at })),
    };
    if (byCategory) {
      const r = runJson(root, ['recall', question, '--limit', String(recallLimit), '--category', c.category], 'recall');
      entry.recall = r.ok ? r.data : { ok: false, error: r.error };
    }
    categories.push(entry);
  }
  const out = { ok: true, skill, categories };
  if (question) {
    out.recall_by_category = byCategory;
    if (!byCategory) out.recall_hint = '已装的 DocNexus 不支持 recall --category（0.16.0 起支持）：改用不带分类的 recall，并按上面列出的分类 / 路径挑结果；可升级 @rowansenne/docnexus';
  }
  return out;
}

function main(argv) {
  let root = process.cwd();
  const opts = { match: [], limit: 20 };
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = path.resolve(argv[++i] ?? '.');
    else if (argv[i] === '--match') opts.match = String(argv[++i] ?? '').split(/[,，]/).map((s) => s.trim());
    else if (argv[i] === '--limit') opts.limit = Number(argv[++i]);
    else if (argv[i] === '--query') opts.query = String(argv[++i] ?? '').trim();
    else if (argv[i] === '--recall-limit') opts.recallLimit = Number(argv[++i]);
    else args.push(argv[i]);
  }
  if (args.length !== 1 || !(opts.limit > 0) || (opts.recallLimit !== undefined && !(opts.recallLimit > 0))) {
    console.error('用法: knowledge.mjs [--root <项目根>] <skill> [--match 词1,词2] [--limit 20] [--query "<问题>" [--recall-limit 5]]');
    return 1;
  }
  const r = knowledge(root, args[0], opts);
  console.log(JSON.stringify(r, null, 2));
  return r.ok ? 0 : r.error === 'no_docnexus' ? 2 : 1;
}

const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exit(main(process.argv.slice(2)));
