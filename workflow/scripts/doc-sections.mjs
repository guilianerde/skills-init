// 读 skill 产物（交付说明、审查报告等）的小工具：按二级标题切节、取表格行、取元信息行。
// report.mjs 与 pr-desc.mjs 共用；标题识别与归一化复用 lint-doc.mjs（跳过代码块、去编号 / 必填 / 「如有」标记），
// 模板标题的写法只在一处定义。只做文本解析，不读写文件。

import { headings, headingKey } from './lint-doc.mjs';

const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');

// 二级标题（归一化后的 key）→ 正文（去掉 HTML 注释与首尾空行）
export function sections(text) {
  const lines = text.split(/\r?\n/);
  const hs = headings(text);
  const out = new Map();
  hs.forEach((h, i) => {
    if (h.level !== 2) return;
    const next = hs.slice(i + 1).find((x) => x.level <= 2);
    const body = lines.slice(h.line, next ? next.line - 1 : lines.length).join('\n');
    if (!out.has(h.key)) out.set(h.key, stripComments(body).trim());
  });
  return out;
}

// 按标题前缀取一节（「严重问题」匹配「严重问题（CRITICAL / HIGH）」），前缀同样归一化
export function section(secs, prefix) {
  const key = headingKey(prefix);
  for (const [k, v] of secs) if (k.startsWith(key)) return v;
  return null;
}

// 「无」「无。」或只剩占位符的节当作空
export const isEmpty = (body) => !body || /^(无|无。|none|n\/a)$/i.test(body.trim()) || /^\{\{[^}]*\}\}$/.test(body.trim());

// 表格数据行（跳过表头、分隔行、全空行和带 {{占位符}} 的模板行），返回单元格数组
export function tableRows(body) {
  if (!body) return [];
  const lines = body.split('\n').filter((l) => /^\s*\|/.test(l));
  return lines.slice(1)
    .filter((l) => !/^\s*\|[\s:|-]+\|\s*$/.test(l))
    .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
    .filter((cells) => cells.some((c) => c) && !cells.some((c) => /\{\{/.test(c)));
}

// 列表项（- / * / 1.），跳过「无」与占位符
export function listItems(body) {
  if (!body) return [];
  return body.split('\n').map((l) => /^\s*(?:[-*]|\d+[.)])\s+(.*)$/.exec(l)?.[1]?.trim()).filter((x) => x && !isEmpty(x) && !/\{\{/.test(x));
}

// 开头引用块里的元信息：「> DocNexus：xxx」取 xxx（遇到「｜」截断）
export function meta(text, key) {
  const head = text.split(/\r?\n/).slice(0, 20).join('\n');
  const m = new RegExp(`${key}[：:]\\s*([^｜\\n]*)`).exec(head);
  const v = m?.[1]?.trim();
  return v && !/^\{\{/.test(v) ? v : null;
}
