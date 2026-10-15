#!/usr/bin/env node
// 文档自检：对照该 skill 当前生效的模板（与 resolve.mjs template 同一套来源规则）检查生成的 Markdown 文档。
// 文档类 skill 写完文件后运行，有错误先修再交付。
//
// 用法（在项目根执行）：
//   node .agents/skills/workflow/scripts/lint-doc.mjs <文档.md> --skill <skill> [--template <文件名>] [--json]
// 检查项：
//   错误：模板中带 * 的必填章节缺失；残留 {{...}} 占位符或 <在此填写…>；缺少 skill.json 中 lint.requiredMeta 列出的元信息行
//   警告：普通章节缺失（标「如有」的章节缺失不报）；章节顺序与模板不一致
//   提示：「待填写 / 待补充 / 待人工确认」的位置（交付时告诉用户）
// 退出码：0 无错误；1 有错误；2 模板无法解析（如已接入 DocNexus 但缺模板）；3 参数错误

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTemplate, skillMeta } from './resolve.mjs';

const TODO = /待填写|待补充|待人工确认/;

// 去掉代码块后返回 [{ line, text }]，行号从 1 开始
function proseLines(md) {
  const out = [];
  let fence = null;
  md.replace(/\r/g, '').split('\n').forEach((text, i) => {
    const m = text.match(/^\s*(```+|~~~+)/);
    if (m) { if (!fence) fence = m[1][0]; else if (m[1][0] === fence) fence = null; return; }
    if (!fence) out.push({ line: i + 1, text });
  });
  return out;
}

// 章节标题归一化：去掉编号（1. / 4.1 / 一、/ 第一部分）、必填标记 *、可选标记（如有），用于模板与文档比对
export function headingKey(text) {
  return text
    .replace(/\*+\s*$/, '')
    .replace(/[（(]\s*如有[^)）]*[)）]/g, '')
    .replace(/^\s*(?:第?[一二三四五六七八九十]+[、.．]|[0-9]+(?:\.(?:[0-9]+|x))*[.、．]?)\s*/, '')
    .replace(/\s+/g, '')
    .trim();
}

export function headings(md) {
  return proseLines(md)
    .map(({ line, text }) => ({ line, m: text.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/) }))
    .filter((h) => h.m)
    .map(({ line, m }) => ({
      line, level: m[1].length, text: m[2],
      key: headingKey(m[2]),
      required: /\*\s*$/.test(m[2]),
      optional: /[（(]\s*如有/.test(m[2]),
      placeholder: /\{\{|<[^>]*填写[^>]*>/.test(m[2]),
    }));
}

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

function main(argv) {
  let root = process.cwd(), skill = '', id = '', json = false, file = '';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') root = path.resolve(argv[++i] ?? '.');
    else if (a === '--skill') skill = argv[++i] ?? '';
    else if (a === '--template') id = argv[++i] ?? '';
    else if (a === '--json') json = true;
    else if (!file && !a.startsWith('--')) file = a;
    else { console.error(`未知参数 ${a}`); return 3; }
  }
  if (!file || !skill) { console.error('用法: lint-doc.mjs <文档.md> --skill <skill> [--template <文件名>] [--json] [--root <项目根>]'); return 3; }
  const meta = skillMeta(skill);
  const entries = (meta?.templates ?? []).filter((t) => t.lint);
  const t = id ? entries.find((x) => x.id === id) : entries[0];
  if (!t) { console.error(`skill「${skill}」没有可检查的文档模板（skill.json 的 templates 中带 lint 的项）`); return 3; }
  const r = resolveTemplate(root, skill, t.id);
  if (!r.ok) { console.log(JSON.stringify(r, null, 2)); return 2; }
  const docPath = path.resolve(root, file);
  if (!fs.existsSync(docPath)) { console.error(`文档不存在：${file}`); return 3; }
  const res = lint(fs.readFileSync(docPath, 'utf8'), fs.readFileSync(path.join(root, r.path), 'utf8'), t.lint);
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
