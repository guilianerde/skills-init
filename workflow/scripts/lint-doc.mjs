#!/usr/bin/env node
// 文档自检：对照该 skill 当前生效的模板（与 resolve.mjs template 同一套来源规则）检查生成的 Markdown 文档。
// 文档类 skill 写完文件后运行，有错误先修再交付。
//
// 用法（在项目根执行）：
//   node .agents/skills/workflow/scripts/lint-doc.mjs <文档.md> --skill <skill> [--template <文件名>] [--facts [--diff <base>...<head>]] [--json]
// 检查项：
//   错误：模板中带 * 的必填章节缺失；残留 {{...}} 占位符或 <在此填写…>；缺少 skill.json 中 lint.requiredMeta 列出的元信息行
//   警告：普通章节缺失（标「如有」的章节缺失不报）；章节顺序与模板不一致
//   提示：「待填写 / 待补充 / 待人工确认」的位置（交付时告诉用户）
//   --facts：核对正文行内代码里的类名、文件路径、接口路径、表名——在 diff 和 <head> 分支的代码里都找不到的记为「未核实」
//            （可能是编造，也可能是外部系统 / 配置中心里的名字）。范围默认取元信息行「对比分支：`dev` ←→ `main`」
// 退出码：0 无错误；1 有错误；2 模板无法解析（如已接入 DocNexus 但缺模板）；3 参数错误

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveTemplate, skillMeta } from './resolve.mjs';
import { proseLines, headings } from '../lib/document-model.mjs';
export { headings, headingKey } from '../lib/document-model.mjs';

const TODO = /待填写|待补充|待人工确认/;

export function lint(doc, template, { requiredMeta = [] } = {}) {
  const errors = [];
  const warnings = [];
  const todos = [];
  const tpl = headings(template).filter((h) => !h.placeholder && h.key);
  const got = headings(doc);
  const gotKeys = got.map((h) => h.key);

  for (const h of tpl) {
    if (gotKeys.includes(h.key)) continue;
    if (h.required) errors.push(`缺少必填章节「${h.text.replace(/\s*\*+\s*$/, '')}」`);
    else if (!h.optional) warnings.push(`缺少章节「${h.text}」（不适用时保留标题并写「无」）`);
  }
  // 顺序：只比较两边都有的章节
  const order = tpl.map((h) => h.key).filter((k) => gotKeys.includes(k));
  const seen = got.map((h) => h.key).filter((k, i, a) => order.includes(k) && a.indexOf(k) === i);
  const firstDiff = order.findIndex((k, i) => seen[i] !== k);
  if (firstDiff >= 0) warnings.push(`章节顺序与模板不一致（从「${order[firstDiff]}」开始）`);

  const lines = doc.replace(/\r/g, '').split('\n');
  lines.forEach((text, i) => {
    if (/\{\{[^}]*\}\}/.test(text)) errors.push(`第 ${i + 1} 行残留模板占位符：${text.trim().slice(0, 60)}`);
    if (/<在此填写[^>]*>/.test(text)) errors.push(`第 ${i + 1} 行未替换：${text.trim().slice(0, 60)}`);
    if (TODO.test(text)) todos.push({ line: i + 1, text: text.trim().slice(0, 80) });
  });
  for (const key of requiredMeta) {
    const re = new RegExp(`^>\\s*(\\*\\*)?${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    if (!lines.some((l) => re.test(l.trim()))) errors.push(`缺少元信息行「> ${key}…」`);
  }
  return { ok: errors.length === 0, errors, warnings, todos };
}

// 正文（不含代码块与 > 元信息行）行内代码里可核对的名字：{ line, ref, kind }
const REF_KINDS = [
  ['file', /^[\w.-]+(?:\/[\w.-]+)+\.[A-Za-z]{1,10}$/],
  ['api', /^(?:(?:GET|POST|PUT|DELETE|PATCH)\s+)?\/[\w{}.-]+(?:\/[\w{}.-]*)*$/],
  ['class', /^[A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]*)+(?:[.#][a-z]\w*(?:\(\))?)?$/],
  ['table', /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/],
];
export function extractRefs(doc) {
  const out = [];
  const seen = new Set();
  for (const { line, text } of proseLines(doc)) {
    if (/^\s*>/.test(text)) continue;
    for (const [, code] of text.matchAll(/`([^`\n]+)`/g)) {
      const ref = code.trim();
      const hit = REF_KINDS.find(([, re]) => re.test(ref));
      if (!hit || seen.has(ref)) continue;
      seen.add(ref);
      out.push({ line, ref, kind: hit[0] });
    }
  }
  return out;
}

export function diffRange(doc) {
  const m = doc.match(/对比分支[：:]\s*`([^`]+)`\s*←→\s*`([^`]+)`/);
  return m ? `${m[2]}...${m[1]}` : null;
}

const git = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

// 每个名字先在 diff 全文里找，再到 head 的代码里找；都没有 → 未核实
export function checkRefs(root, refs, range) {
  const head = range.split('...')[1];
  if (!head || git(root, ['rev-parse', '--verify', '--quiet', `${head}^{commit}`]).status !== 0) {
    return { ok: false, error: `无法核对：找不到分支 ${head || range}` };
  }
  const d = git(root, ['diff', range]);
  if (d.status !== 0) return { ok: false, error: `git diff ${range} 失败：${d.stderr.trim().split('\n')[0]}` };
  const diff = d.stdout;
  const files = git(root, ['ls-tree', '-r', '--name-only', head]).stdout.split('\n');
  const inCode = (needle, icase) => git(root, ['grep', '-q', '-F', ...(icase ? ['-i'] : []), '-e', needle, head, '--']).status === 0;
  const unverified = [];
  for (const r of refs) {
    let needle = r.ref.replace(/^(GET|POST|PUT|DELETE|PATCH)\s+/, '');
    if (r.kind === 'class') needle = needle.split(/[.#]/)[0];
    if (r.kind === 'api') needle = needle.split('{')[0].replace(/\/$/, '') || needle;
    const found = r.kind === 'file'
      ? files.some((f) => f === needle || f.endsWith(`/${needle}`)) || diff.includes(needle)
      : diff.includes(needle) || (r.kind === 'table' && diff.toLowerCase().includes(needle)) || inCode(needle, r.kind === 'table');
    if (!found) unverified.push(r);
  }
  return { ok: true, range, checked: refs.length, unverified };
}

function main(argv) {
  let root = process.cwd(), skill = '', id = '', json = false, file = '', facts = false, range = '';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') root = path.resolve(argv[++i] ?? '.');
    else if (a === '--skill') skill = argv[++i] ?? '';
    else if (a === '--template') id = argv[++i] ?? '';
    else if (a === '--json') json = true;
    else if (a === '--facts') facts = true;
    else if (a === '--diff') { facts = true; range = argv[++i] ?? ''; }
    else if (!file && !a.startsWith('--')) file = a;
    else { console.error(`未知参数 ${a}`); return 3; }
  }
  if (!file || !skill) { console.error('用法: lint-doc.mjs <文档.md> --skill <skill> [--template <文件名>] [--facts [--diff <base>...<head>]] [--json] [--root <项目根>]'); return 3; }
  const meta = skillMeta(skill);
  const entries = (meta?.templates ?? []).filter((t) => t.lint);
  const t = id ? entries.find((x) => x.id === id) : entries[0];
  if (!t) { console.error(`skill「${skill}」没有可检查的文档模板（skill.json 的 templates 中带 lint 的项）`); return 3; }
  const r = resolveTemplate(root, skill, t.id);
  if (!r.ok) { console.log(JSON.stringify(r, null, 2)); return 2; }
  const docPath = path.resolve(root, file);
  if (!fs.existsSync(docPath)) { console.error(`文档不存在：${file}`); return 3; }
  const docText = fs.readFileSync(docPath, 'utf8');
  const res = lint(docText, fs.readFileSync(path.join(root, r.path), 'utf8'), t.lint);
  if (facts) {
    const rg = range || diffRange(docText);
    res.facts = rg ? checkRefs(root, extractRefs(docText), rg) : { ok: false, error: '没有 --diff，元信息行里也没有「对比分支」，无法核对' };
    if (!res.facts.ok) res.warnings.push(res.facts.error);
    for (const u of res.facts.unverified ?? []) res.warnings.push(`第 ${u.line} 行的 \`${u.ref}\` 在 diff 和 ${rg.split('...')[1]} 的代码里都找不到：确认不是编造（外部系统 / 配置中心的名字可忽略）`);
  }
  const out = { doc: file, template: r.path, source: r.source, ...res };
  if (json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`文档：${file}\n模板：${r.path}（${r.source}）`);
    for (const e of res.errors) console.log(`  错误  ${e}`);
    for (const w of res.warnings) console.log(`  警告  ${w}`);
    if (res.todos.length) console.log(`  提示  ${res.todos.length} 处待填写 / 待确认：${res.todos.map((x) => `第 ${x.line} 行`).join('、')}`);
    console.log(res.ok ? '通过' : `${res.errors.length} 个错误，请修正后再交付`);
  }
  return res.ok ? 0 : 1;
}

const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exit(main(process.argv.slice(2)));
