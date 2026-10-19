#!/usr/bin/env node
// 给审查发现定位行号：每条发现带上问题所在的原代码片段（code），由脚本在文件里找到它、算出起止行，不靠模型自己数行号。
// project-review 第 6 步复核前使用。片段先精确匹配，再按忽略空白匹配；单行片段还可以是某一行的一部分。
// 有多处匹配时优先本次改动的行，再取离模型给的 line 最近的一处，并标 ambiguous。找不到的标 anchored: false，要回去重读代码改片段。
// 范围参数和 review-scope.mjs 一样，决定读哪个版本的文件、哪些行算本次改动（in_change）。
//
// 用法（在项目根执行；--root 可指定项目根）：
//   node .agents/skills/workflow/scripts/locate.mjs <发现.json> [--diff <base>...<head> | --base <分支>]
// <发现.json> 是数组：[{ "file": "src/A.java", "code": "原代码片段（可多行）", "line": 42（可选，模型估的行号）, …其他字段原样保留 }]
// 输出 JSON：{ ok, ref, anchored, total, findings: [{ …原字段, start_line, end_line, anchored, match, in_change, ambiguous? }] }。
// 退出码：0 正常（有没定位到的也是 0，看 anchored）；1 参数错误、文件读不到或 git 失败

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDiff, readAt } from './review-scope.mjs';

const loose = (s) => s.replace(/\s+/g, ' ').trim();

// 片段 → 行数组：去掉首尾空行、行尾空白；整段都是从 diff 里复制来的（每行以 + 或空格开头且至少一行是 +）时去掉这一列
export function snippetLines(code) {
  let lines = String(code ?? '').replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, ''));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  const body = lines.filter((l) => l.length);
  if (body.length && body.every((l) => /^[+ ]/.test(l)) && body.some((l) => l.startsWith('+'))) lines = lines.map((l) => l.slice(1));
  return lines;
}

// 在 fileLines 里找 snip 的所有位置（1 起的行号）
export function findAll(fileLines, snip) {
  const n = snip.length;
  if (!n) return { match: 'none', hits: [] };
  const scan = (eq) => {
    const hits = [];
    for (let i = 0; i + n <= fileLines.length; i++) {
      let ok = true;
      for (let j = 0; j < n && ok; j++) ok = eq(fileLines[i + j], snip[j]);
      if (ok) hits.push(i + 1);
    }
    return hits;
  };
  let hits = scan((a, b) => a.replace(/\s+$/, '') === b);
  if (hits.length) return { match: 'exact', hits };
  hits = scan((a, b) => loose(a) === loose(b));
  if (hits.length) return { match: 'loose', hits };
  // 单行片段：允许是某一行的一部分（至少 8 个非空白字符，避免太短的片段到处都能匹配）
  if (n === 1 && loose(snip[0]).replace(/ /g, '').length >= 8) {
    hits = fileLines.map((l, i) => (loose(l).includes(loose(snip[0])) ? i + 1 : 0)).filter(Boolean);
    if (hits.length) return { match: 'partial', hits };
  }
  return { match: 'none', hits: [] };
}

const overlaps = (s, e, hunks) => hunks.some(([a, b]) => s <= b && e >= a);

export function locateOne(finding, { read, hunksOf }) {
  const out = { ...finding };
  const file = String(finding.file ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
  const text = file ? read(file) : null;
  if (text == null) return { ...out, anchored: false, match: 'none', reason: file ? '文件读不到（路径写错或不在这个版本里）' : '缺少 file' };
  const snip = snippetLines(finding.code);
  if (!snip.length) return { ...out, anchored: false, match: 'none', reason: '缺少 code（问题所在的原代码片段）' };
  const fileLines = text.replace(/\r/g, '').split('\n');
  const { match, hits } = findAll(fileLines, snip);
  if (!hits.length) return { ...out, anchored: false, match: 'none', reason: '片段在文件里找不到：回去重读代码，照原样复制片段' };
  const hunks = hunksOf(file);
  const span = snip.length - 1;
  const inChange = hits.filter((s) => overlaps(s, s + span, hunks));
  const pool = inChange.length ? inChange : hits;
  const guess = Number(finding.line); // 模型可能写成字符串 "42"
  const near = Number.isInteger(guess) && guess > 0 ? [...pool].sort((a, b) => Math.abs(a - guess) - Math.abs(b - guess)) : pool;
  const start = near[0];
  return {
    ...out, start_line: start, end_line: start + span, anchored: true, match,
    in_change: overlaps(start, start + span, hunks),
    ...(pool.length > 1 ? { ambiguous: true, candidates: pool.slice(0, 10) } : {}),
  };
}

export function locate(root, findings, opts = {}) {
  const d = loadDiff(root, opts);
  if (!d.ok) return d;
  const byPath = new Map(d.files.map((f) => [f.path, f.hunks]));
  const cache = new Map();
  const read = (f) => { if (!cache.has(f)) cache.set(f, readAt(root, d.ref, f)); return cache.get(f); };
  const res = findings.map((f) => locateOne(f, { read, hunksOf: (p) => byPath.get(p) ?? [] }));
  return { ok: true, ref: d.ref, range: d.range, total: res.length, anchored: res.filter((x) => x.anchored).length, findings: res };
}

function main(argv) {
  let root = process.cwd();
  const o = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = path.resolve(argv[++i] ?? '.');
    else if (argv[i] === '--diff') o.diff = argv[++i] ?? null;
    else if (argv[i] === '--base') o.base = argv[++i] ?? null;
    else if (argv[i] === '--exclude') i++; // 和 review-scope.mjs 用同一组参数时带过来的，定位用不到
    else rest.push(argv[i]);
  }
  if (rest.length !== 1) { console.error('用法: locate.mjs <发现.json> [--diff <base>...<head> | --base <分支>]'); return 1; }
  let findings;
  try { findings = JSON.parse(fs.readFileSync(path.resolve(root, rest[0]), 'utf8')); } catch (e) { console.error(`读不了 ${rest[0]}：${e.message}`); return 1; }
  if (!Array.isArray(findings)) { console.error(`${rest[0]} 要是数组：[{ "file": …, "code": … }]`); return 1; }
  const r = locate(root, findings, o);
  console.log(JSON.stringify(r, null, 2));
  return r.ok ? 0 : 1;
}

export { main };
const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exit(main(process.argv.slice(2)));
