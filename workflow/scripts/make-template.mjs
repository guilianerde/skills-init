#!/usr/bin/env node
// 从一份样例文档（团队现有的技术方案 / 上线方案等）抽出模板骨架：保留标题层级与表格列，正文换成 {{...}} 填写提示。
// 用于「创建模板」：技术方案、上线方案的模板不随 skills 提供，第一次用时由用户给样例、生成后经确认保存
// （见 workflow/references/templates.md「创建模板」）。确定性的结构抽取放在这里，填写提示的措辞、哪些章节必填由 agent 与用户确认。
// 只读样例，只往 stdout 输出（--out 时写文件）；不写 DocNexus。
//
// 用法（在项目根执行）：
//   node .agents/skills/workflow/scripts/make-template.mjs <样例.md | -> [--out <文件>]
// 样例可以是本地 Markdown，也可以是 wiki 页面的纯文本（md-to-wiki/scripts/upload.mjs get <pageId> --text 的 text 字段，用 - 从 stdin 读）。
// 退出码：0 正常；1 参数错误或样例里没有任何标题

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const TABLE = /^\s*\|.*\|\s*$/;
const SEP = /^\s*\|[\s:|-]+\|\s*$/;

const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

// 标题文本：一级标题保留【前缀】，其余换成占位；其他级别原样保留（章节名本身就是模板的一部分）
function headingText(level, text) {
  if (level > 1) return text;
  const prefix = /^【[^】]+】/.exec(text)?.[0] ?? '';
  return `${prefix}{{文档标题}}`;
}

// 一节正文 → 骨架：表格保留表头 + 一行占位；代码块保留围栏；其余文字合并成一条填写提示
function bodySkeleton(lines, title) {
  const out = [];
  let prose = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*```/.test(l)) {
      const lang = l.trim().slice(3);
      let j = i + 1;
      while (j < lines.length && !/^\s*```/.test(lines[j])) j++;
      out.push('', `\`\`\`${lang}`, `{{${title}示例}}`, '```');
      i = j;
      continue;
    }
    if (TABLE.test(l)) {
      const head = cells(l);
      let j = i + 1;
      while (j < lines.length && TABLE.test(lines[j])) j++;
      out.push('', `| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, `| ${head.map((h) => `{{${h || '内容'}}}`).join(' | ')} |`);
      i = j - 1;
      continue;
    }
    if (SEP.test(l)) continue;
    if (l.trim() && !prose) { out.push('', `{{${title}：按样例的写法填写}}`); prose = true; }
  }
  return out;
}

export function skeleton(sample) {
  let text = sample.replace(/^﻿/, '').replace(/^<!-- md-to-wiki:[^\n]*-->\n?/, '').replace(/^---\n[\s\S]*?\n---\n/, '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  const lines = text.split(/\r?\n/);
  const out = [];
  let i = 0;
  // 标题之前的内容（含生成文档开头的元信息引用块）不进模板：元信息由生成文档的 skill 自己写
  while (i < lines.length && !HEADING.test(lines[i])) i++;
  let headings = 0;
  while (i < lines.length) {
    const m = HEADING.exec(lines[i]);
    let j = i + 1;
    while (j < lines.length && !HEADING.test(lines[j])) j++;
    const level = m[1].length;
    const title = m[2].replace(/\s*\*\s*$/, '').replace(/\s*[（(]\s*如有[^)）]*[)）]/g, '');
    out.push(`${m[1]} ${headingText(level, m[2])}`);
    headings++;
    // 一级标题下紧跟的引用块是元信息，跳过；其他内容照常抽骨架
    const body = lines.slice(i + 1, j);
    const rest = level === 1 ? body.filter((l) => !/^\s*>/.test(l)) : body;
    out.push(...bodySkeleton(rest, title.replace(/^[一二三四五六七八九十]+[、.．]\s*|^\d+(\.\d+)*[.、．]?\s*/, '')), '');
    i = j;
  }
  return { headings, template: out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n' };
}

function main(argv) {
  let src = null; let out = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = argv[++i] ?? null;
    else if (src === null) src = argv[i];
    else { src = null; break; }
  }
  if (!src) { console.error('用法: make-template.mjs <样例.md | -> [--out <文件>]'); return 1; }
  const sample = src === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(src, 'utf8');
  const r = skeleton(sample);
  if (!r.headings) { console.error('样例里没有找到任何标题（# / ## ...），无法抽取结构；请换一份带章节标题的样例'); return 1; }
  if (out) { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, r.template); console.error(`已写入 ${out}（${r.headings} 个标题）`); }
  else process.stdout.write(r.template);
  return 0;
}

const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exit(main(process.argv.slice(2)));
