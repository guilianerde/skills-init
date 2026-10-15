#!/usr/bin/env node
// Markdown → Confluence Storage Format（严格 XHTML）转换，只用 Node 内置能力，不调用任何 wiki API。
//
//   node md-to-wiki.mjs <inputMd> <outputHtml> [--banner <bannerMdPath>] [--no-banner]
//   node md-to-wiki.mjs --check <html>        # 只做 XML 良构校验
//
// 支持：ATX 标题、段落（单换行转 <br/>）、引用、有序 / 无序列表（可嵌套、任务列表）、GFM 表格（含对齐）、
//       分隔线、围栏代码块（→ code 宏 + CDATA）、行内代码 / 粗体 / 斜体 / 删除线 / 链接 / 图片 / 自动链接。
// 原始 HTML 一律转义成文本（HTML 注释直接丢弃），保证输出良构。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- 行内
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(text) {
  const slots = [];
  const keep = (html) => `\u0000${slots.push(html) - 1}\u0000`;
  let s = text
    // 行内代码优先，内容原样
    .replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (m, t, c) => keep(`<code>${esc(c.trim())}</code>`))
    // 反斜杠转义
    .replace(/\\([\\`*_{}\[\]()#+\-.!|~<>])/g, (m, c) => keep(esc(c)))
    // 图片、链接、自动链接
    .replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"([^"]*)")?\s*\)/g, (m, alt, src, title) =>
      keep(`<img src="${esc(src)}" alt="${esc(alt)}"${title ? ` title="${esc(title)}"` : ''}/>`))
    .replace(/\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"([^"]*)")?\s*\)/g, (m, label, href, title) =>
      keep(`<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ''}>${inline(label)}</a>`))
    .replace(/<(https?:\/\/[^>\s]+)>/g, (m, u) => keep(`<a href="${esc(u)}">${esc(u)}</a>`));
  s = esc(s)
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>')
    .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w_])_(?=\S)([^_]*?\S)_(?![\w_])/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
  // 槽位可能嵌套（链接文字里有代码），反复还原
  for (let i = 0; i < 5 && s.includes('\u0000'); i++) s = s.replace(/\u0000(\d+)\u0000/g, (m, n) => slots[n]);
  return s;
}

// ---------------------------------------------------------------- 块级
const RE = {
  fence: /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*).*$/,
  heading: /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/,
  hr: /^ {0,3}([-*_])(\s*\1){2,}\s*$/,
  quote: /^ {0,3}>\s?/,
  list: /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/,
  tableSep: /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/,
  blank: /^\s*$/,
};
const indentOf = (l) => l.match(/^\s*/)[0].replace(/\t/g, '    ').length;
const splitRow = (l) => {
  let t = l.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
};

function codeMacro(lang, code) {
  const body = code.replace(/]]>/g, ']]]]><![CDATA[>');
  const p = lang ? `<ac:parameter ac:name="language">${esc(lang)}</ac:parameter>` : '';
  return `<ac:structured-macro ac:name="code" ac:schema-version="1">${p}<ac:plain-text-body><![CDATA[${body}]]></ac:plain-text-body></ac:structured-macro>`;
}

function blocks(lines) {
  const out = [];
  let i = 0;
  const startsBlock = (l, next) => RE.fence.test(l) || RE.heading.test(l) || RE.hr.test(l) || RE.quote.test(l) ||
    RE.list.test(l) || (l.includes('|') && next !== undefined && RE.tableSep.test(next) && next.includes('-'));
  while (i < lines.length) {
    const line = lines[i];
    if (RE.blank.test(line)) { i++; continue; }

    let m;
    if ((m = line.match(RE.fence))) { // 围栏代码块
      const fence = m[1]; const lang = m[2]; const body = [];
      i++;
      while (i < lines.length && !new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`).test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(codeMacro(lang, body.join('\n') + (body.length ? '\n' : '')));
      continue;
    }
    if ((m = line.match(RE.heading))) { out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); i++; continue; }
    if (RE.hr.test(line)) { out.push('<hr/>'); i++; continue; }
    if (RE.quote.test(line)) {
      const body = [];
      while (i < lines.length && !RE.blank.test(lines[i]) && (RE.quote.test(lines[i]) || body.length)) {
        if (!RE.quote.test(lines[i]) && startsBlock(lines[i], lines[i + 1])) break;
        body.push(lines[i].replace(RE.quote, '')); i++;
      }
      out.push(`<blockquote>${blocks(body)}</blockquote>`);
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && RE.tableSep.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : ''));
      const cell = (tag, c, k) => `<${tag}${align[k] ? ` style="text-align: ${align[k]}"` : ''}>${inline(c)}</${tag}>`;
      let html = `<table><thead><tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr></thead><tbody>`;
      i += 2;
      while (i < lines.length && !RE.blank.test(lines[i]) && lines[i].includes('|')) {
        const row = splitRow(lines[i++]);
        html += `<tr>${head.map((_, k) => cell('td', row[k] ?? '', k)).join('')}</tr>`;
      }
      out.push(html + '</tbody></table>');
      continue;
    }
    if (RE.list.test(line)) { const r = list(lines, i); out.push(r.html); i = r.next; continue; }

    // 段落：直到空行或新的块；单换行转 <br/>
    const para = [];
    while (i < lines.length && !RE.blank.test(lines[i]) && (para.length === 0 || !startsBlock(lines[i], lines[i + 1]))) para.push(lines[i++].trim());
    out.push(`<p>${para.map(inline).join('<br/>')}</p>`);
  }
  return out.join('');
}

function list(lines, start) {
  const first = lines[start].match(RE.list);
  const base = indentOf(first[1]);
  const ordered = /\d/.test(first[2]);
  const tag = ordered ? 'ol' : 'ul';
  const startNum = ordered ? parseInt(first[2], 10) : 1;
  const items = [];
  let i = start;
  while (i < lines.length) {
    const m = lines[i].match(RE.list);
    if (!m || indentOf(m[1]) !== base || /\d/.test(m[2]) !== ordered) break;
    const contentIndent = m[0].length - m[3].length;
    const body = [m[3]];
    let sawBlank = false;
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (RE.blank.test(l)) { sawBlank = true; body.push(''); i++; continue; }
      const ind = indentOf(l);
      const lm = l.match(RE.list);
      if (lm && indentOf(lm[1]) <= base) break;      // 同级或更外层的新列表项
      if (ind <= base && !lm) {
        if (sawBlank) break;                           // 空行后的非缩进行：列表结束
        if (RE.heading.test(l) || RE.hr.test(l) || RE.fence.test(l) || RE.quote.test(l)) break;
        body.push(l.trim()); i++; continue;            // 惰性续行
      }
      body.push(l.slice(Math.min(ind, contentIndent)).replace(/^\t/, '')); i++;
      sawBlank = false;
    }
    while (body.length && body[body.length - 1] === '') body.pop();
    items.push(body);
  }
  const lis = items.map((body) => {
    let task = '';
    const tm = body[0].match(/^\[([ xX])\]\s+(.*)$/);
    if (tm) { task = tm[1] === ' ' ? '☐ ' : '☑ '; body[0] = tm[2]; }
    let html = blocks(body);
    // 紧凑列表项（只有一个段落）去掉 <p>
    const single = html.match(/^<p>([\s\S]*?)<\/p>((?:<(?:ul|ol)[\s\S]*)?)$/);
    if (single && !single[1].includes('</p>')) html = single[1] + single[2];
    return `<li>${esc(task)}${html}</li>`;
  });
  return { html: `<${tag}${ordered && startNum !== 1 ? ` start="${startNum}"` : ''}>${lis.join('')}</${tag}>`, next: i };
}

export function convert(md) {
  const text = md.replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
  return blocks(text.split('\n'));
}

// ---------------------------------------------------------------- 良构校验（够用的 XML 检查）
export function checkWellFormed(xml) {
  const stack = [];
  const re = /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\/?([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>|<|&(?!(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);)/g;
  let m;
  while ((m = re.exec(xml))) {
    const tok = m[0];
    if (tok.startsWith('<![CDATA[') || tok.startsWith('<!--')) continue;
    const line = xml.slice(0, m.index).split('\n').length;
    if (tok === '<') return { ok: false, line, error: '未转义的 <，或标签 / 属性格式不正确' };
    if (tok.startsWith('&')) return { ok: false, line, error: '未转义的 &' };
    if (tok.startsWith('</')) {
      const open = stack.pop();
      if (open !== m[1]) return { ok: false, line, error: `闭合标签 </${m[1]}> 与 <${open ?? '无'}> 不匹配` };
    } else if (!m[3]) stack.push(m[1]);
  }
  if (stack.length) return { ok: false, line: xml.split('\n').length, error: `未闭合的标签 <${stack[stack.length - 1]}>` };
  return { ok: true };
}

// ---------------------------------------------------------------- CLI
function infoMacro(md) {
  return `<ac:structured-macro ac:name="info" ac:schema-version="1"><ac:rich-text-body>${convert(md)}</ac:rich-text-body></ac:structured-macro>`;
}

// 第一个引用块（跳过代码块里的 >）：返回 [引用内容, 去掉它之后的正文]
function takeFirstQuote(md) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (RE.fence.test(lines[i])) inFence = !inFence;
    if (inFence || !RE.quote.test(lines[i])) continue;
    let j = i;
    while (j < lines.length && RE.quote.test(lines[j])) j++;
    const quote = lines.slice(i, j).map((l) => l.replace(RE.quote, '')).join('\n');
    return [quote, [...lines.slice(0, i), ...lines.slice(j)].join('\n')];
  }
  return [null, md];
}

function main(argv) {
  if (argv[0] === '--check') {
    if (!argv[1] || !fs.existsSync(argv[1])) { console.error('用法: node md-to-wiki.mjs --check <html>'); return 2; }
    const r = checkWellFormed(fs.readFileSync(argv[1], 'utf8'));
    if (r.ok) { console.log('XML well-formed: OK'); return 0; }
    console.error(`XML 不良构（第 ${r.line} 行）：${r.error}`); return 1;
  }
  const pos = []; let banner = null; let noBanner = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--banner') banner = argv[++i];
    else if (argv[i] === '--no-banner') noBanner = true;
    else pos.push(argv[i]);
  }
  if (pos.length !== 2) { console.error('用法: node md-to-wiki.mjs <inputMd> <outputHtml> [--banner <bannerMdPath>] [--no-banner]'); return 2; }
  const [input, output] = pos;
  if (!fs.existsSync(input)) { console.error(`ERROR: input markdown not found: ${input}`); return 1; }
  let md = fs.readFileSync(input, 'utf8');
  let bannerHtml = ''; let bannerFrom = 'none';
  if (!noBanner) {
    if (banner) {
      if (fs.existsSync(banner)) { bannerHtml = infoMacro(fs.readFileSync(banner, 'utf8')); bannerFrom = 'from --banner file'; }
      else console.error(`WARN: banner file not found: ${banner}, skipping banner`);
    } else {
      const [quote, rest] = takeFirstQuote(md);
      if (quote !== null) { bannerHtml = infoMacro(quote); md = rest; bannerFrom = 'moved from first blockquote'; }
    }
  }
  const html = bannerHtml + convert(md);
  const r = checkWellFormed(html);
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, html);
  console.log(`OK: wrote ${html.length} chars to ${output}`);
  console.log(`  banner: ${bannerFrom}`);
  if (!r.ok) { console.error(`XML 不良构（第 ${r.line} 行）：${r.error}`); return 1; }
  console.log('  XML well-formed: OK');
  return 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
