#!/usr/bin/env node
// 本地效果报告：只读扫描 workflow-run/docs/requirements/下的产物，回答「用了这套工作流以后有没有更好」。
// 数据全部来自已经落盘的产物，不上报、不另存记录：
//   - 审查：每份报告的 CRITICAL / HIGH / MEDIUM / LOW 条数、复核通过率；复审报告里上次问题的「已修复 / 仍存在 / 不再适用」→ 修复率
//   - 交付：功能 / 缺陷、S / M / L、需求澄清中确认的决定条数、带「未验证项」的交付
//   - 沉淀：交付说明与审查报告的「DocNexus」元信息行 → 已沉淀 / 未沉淀 / 未询问 / 无需沉淀 / 未接入
//   - 知识复用：正文里引用 docnexus/library/ 的产物（开工前召回到并用上了）
//   - 链路完整度：每个分支有哪些产物、文档有没有发布到 wiki
// S 快速通道不落盘（不绑定需求，也不写审查报告 / 交付说明），不在统计内。
// 默认只看工作区；产物随特性分支提交、还没合并时，加 --all-branches 用 git 只读扫描所有本地分支（同一路径以工作区为准）。
//
// 用法（在项目根执行；--root 可指定项目根）：
//   node .agents/skills/workflow/scripts/report.mjs [--since YYYY-MM-DD] [--all-branches] [--json]
// 默认输出 Markdown，--json 输出 JSON。退出码：0 正常；1 参数错误

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect, collectGit, localBranches, KINDS } from './artifacts.mjs';
import { sections, section, tableRows, listItems, meta, isEmpty } from './doc-sections.mjs';

const LEVELS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);

// DocNexus 元信息行 → captured / not_captured / not_asked / not_needed / not_connected / missing
export function captureState(text) {
  const v = meta(text, 'DocNexus');
  if (!v) return 'missing';
  if (/docnexus\/library\//.test(v)) return 'captured';
  if (/未接入/.test(v)) return 'not_connected';
  if (/未询问/.test(v)) return 'not_asked';
  if (/无需沉淀/.test(v)) return 'not_needed';
  if (/未沉淀/.test(v)) return 'not_captured';
  return 'missing';
}

// 正文（元信息行之外）有没有引用知识库文档
export const citesKnowledge = (text) => text.split(/\r?\n/).some((l) => !/^>\s*DocNexus[：:]/.test(l) && /docnexus\/library\//.test(l));

export function parseReview(text) {
  const secs = sections(text);
  const levels = Object.fromEntries(LEVELS.map((l) => [l, 0]));
  let verified = 0; let pending = 0;
  for (const cells of tableRows(section(secs, '严重问题'))) {
    const lv = LEVELS.find((l) => cells[1]?.toUpperCase().includes(l));
    if (lv) levels[lv]++;
    const last = cells[cells.length - 1] ?? '';
    if (last.includes('✅')) verified++; else if (last.includes('⚠')) pending++;
  }
  levels.MEDIUM += tableRows(section(secs, '一般问题')).length;
  levels.LOW += tableRows(section(secs, '优化建议')).length;
  const followUp = { fixed: 0, open: 0, obsolete: 0 };
  for (const cells of tableRows(section(secs, '与上次审查对比'))) {
    const s = cells[2] ?? '';
    if (s.includes('已修复')) followUp.fixed++; else if (s.includes('仍存在')) followUp.open++; else if (s.includes('不再适用')) followUp.obsolete++;
  }
  return { levels, verified, pending, follow_up: followUp, is_rereview: followUp.fixed + followUp.open + followUp.obsolete > 0 };
}

export function parseDelivery(text) {
  const secs = sections(text);
  const type = meta(text, '类型');
  const scale = meta(text, '规模');
  const unverified = section(secs, '验证')?.match(/未验证项[：:]\s*(.*)/)?.[1]?.trim();
  return {
    type: type && /缺陷/.test(type) ? 'bug' : type ? 'feature' : null,
    scale: scale && /^[SML]$/.test(scale) ? scale : null,
    decisions: listItems(section(secs, '已确认的决定')).length,
    has_unverified: !!unverified && !isEmpty(unverified) && !/^\{\{/.test(unverified),
  };
}

// 工作区 + （可选）各本地分支提交过的产物；同一路径只取第一次见到的（工作区优先）
export function gather(root, allBranches) {
  const seen = new Set(); const out = [];
  const add = (list) => { for (const a of list) if (!seen.has(a.path)) { seen.add(a.path); out.push(a); } };
  add(collect(root));
  const branches = allBranches ? localBranches(root) : [];
  for (const b of branches) add(collectGit(root, b));
  return { items: out, scanned: branches };
}

export function buildReport(root, { since = null, allBranches = false } = {}) {
  const g = gather(root, allBranches);
  const all = g.items.filter((a) => !since || !a.date || a.date.slice(0, 10) >= since);
  const read = (a) => a.text ?? fs.readFileSync(path.join(root, a.path), 'utf8');
  const counts = Object.fromEntries(KINDS.map((k) => [k.kind, all.filter((a) => a.kind === k.kind).length]));

  const review = { reports: 0, rereviews: 0, levels: Object.fromEntries(LEVELS.map((l) => [l, 0])), verified: 0, pending: 0, follow_up: { fixed: 0, open: 0, obsolete: 0 } };
  const delivery = { total: 0, feature: 0, bug: 0, scale: { S: 0, M: 0, L: 0 }, with_decisions: 0, decisions: 0, with_unverified: 0 };
  const capture = { captured: 0, not_captured: 0, not_asked: 0, not_needed: 0, not_connected: 0, missing: 0 };
  let cites = 0;
  for (const a of all) {
    const text = read(a);
    if (citesKnowledge(text)) cites++;
    if (a.kind === 'review') {
      const r = parseReview(text);
      review.reports++; if (r.is_rereview) review.rereviews++;
      for (const l of LEVELS) review.levels[l] += r.levels[l];
      review.verified += r.verified; review.pending += r.pending;
      for (const k of Object.keys(review.follow_up)) review.follow_up[k] += r.follow_up[k];
    }
    if (a.kind === 'delivery') {
      const d = parseDelivery(text);
      delivery.total++;
      if (d.type) delivery[d.type]++;
      if (d.scale) delivery.scale[d.scale]++;
      if (d.decisions) { delivery.with_decisions++; delivery.decisions += d.decisions; }
      if (d.has_unverified) delivery.with_unverified++;
    }
    if (a.kind === 'delivery' || a.kind === 'review') capture[captureState(text)]++;
  }
  const f = review.follow_up;
  review.fix_rate = pct(f.fixed, f.fixed + f.open);
  review.verified_rate = pct(review.verified, review.verified + review.pending);
  const asked = capture.captured + capture.not_captured;
  capture.capture_rate = pct(capture.captured, asked);

  // 每个分支的链路完整度
  const branches = [...new Set(all.map((a) => a.branch).filter(Boolean))].sort().map((b) => {
    const items = all.filter((a) => a.branch === b);
    const has = Object.fromEntries(KINDS.map((k) => [k.kind, items.some((a) => a.kind === k.kind)]));
    const docs = items.filter((a) => a.kind === 'tech' || a.kind === 'release');
    return { branch: b, requirements: [...new Set(items.map((a) => a.requirement).filter(Boolean))], has, reviews: items.filter((a) => a.kind === 'review').length, unpublished: docs.filter((a) => !a.wiki).map((a) => a.path) };
  });

  return {
    since, scanned_branches: g.scanned, from_branches: all.filter((a) => a.ref).length, artifacts: all.length, counts, review, delivery, capture,
    knowledge: { citing: cites, rate: pct(cites, all.length) },
    branches,
    without_branch: all.filter((a) => !a.branch).map((a) => a.path),
  };
}

const show = (v) => (v == null ? '—' : `${v}%`);

export function toMarkdown(r) {
  const L = [];
  L.push(`# 工作流效果报告${r.since ? `（${r.since} 起）` : ''}`, '');
  L.push(r.scanned_branches.length
    ? `范围：工作区 + ${r.scanned_branches.length} 个本地分支（其中 ${r.from_branches} 份只在分支里）。`
    : '范围：只看工作区。随特性分支提交、还没合并的产物不在内，加 `--all-branches` 一起统计。', '');
  if (!r.artifacts) {
    L.push('`workflow-run/docs/requirements/` 下还没有产物。dev 交付（M / L 规模）、审查报告、技术方案、上线方案落盘后，这里才有数据。');
    return L.join('\n');
  }
  L.push(`产物 ${r.artifacts} 份：${KINDS.map((k) => `${k.label} ${r.counts[k.kind]}`).join('、')}。S 快速通道不落盘，不在统计内。`, '');
  const v = r.review;
  L.push('## 审查', '');
  L.push(`- 报告 ${v.reports} 份（其中复审 ${v.rereviews} 份）；发现 CRITICAL ${v.levels.CRITICAL} / HIGH ${v.levels.HIGH} / MEDIUM ${v.levels.MEDIUM} / LOW ${v.levels.LOW}`);
  L.push(`- 严重问题复核通过率：${show(v.verified_rate)}（✅ ${v.verified}，⚠ 待确认 ${v.pending}）`);
  L.push(`- 复审时上次问题的修复率：${show(v.fix_rate)}（已修复 ${v.follow_up.fixed}，仍存在 ${v.follow_up.open}，不再适用 ${v.follow_up.obsolete}）${v.rereviews ? '' : '；还没有复审，修复率要等第二次审查同一分支后才有'}`, '');
  const d = r.delivery;
  L.push('## 交付', '');
  L.push(`- 交付说明 ${d.total} 份：功能开发 ${d.feature}、缺陷修复 ${d.bug}；规模 S ${d.scale.S} / M ${d.scale.M} / L ${d.scale.L}`);
  L.push(`- 需求澄清：${d.with_decisions} 份交付在开工前和用户确认了决定，共 ${d.decisions} 条（这些决定不澄清就会被默默假设）`);
  L.push(`- 带「未验证项」的交付：${d.with_unverified} 份`, '');
  const c = r.capture;
  L.push('## 知识沉淀与复用', '');
  L.push(`- 交付与审查问过沉淀的 ${c.captured + c.not_captured} 次中，沉淀 ${c.captured} 次（${show(c.capture_rate)}）；未询问 ${c.not_asked}，没有值得沉淀的内容 ${c.not_needed}，未接入 DocNexus ${c.not_connected}，元信息缺失 ${c.missing}`);
  L.push(`- 正文引用知识库文档的产物：${r.knowledge.citing} 份（${show(r.knowledge.rate)}）`, '');
  L.push('## 各分支链路', '');
  L.push(`| 分支（需求） | ${KINDS.map((k) => k.label).join(' | ')} | 未发布到 wiki |`);
  L.push(`|---|${KINDS.map(() => '---').join('|')}|---|`);
  for (const b of r.branches) {
    const cell = (k) => (b.has[k.kind] ? (k.kind === 'review' && b.reviews > 1 ? `✓×${b.reviews}` : '✓') : '');
    L.push(`| \`${b.branch}\`${b.requirements.length ? `（${b.requirements.join('、')}）` : ''} | ${KINDS.map(cell).join(' | ')} | ${b.unpublished.length ? b.unpublished.map((p) => `\`${path.basename(p)}\``).join('<br>') : ''} |`);
  }
  if (r.without_branch.length) L.push('', `元信息里没有分支、未归组的产物：${r.without_branch.map((p) => `\`${p}\``).join('、')}`);
  return L.join('\n');
}

function main(argv) {
  let root = process.cwd(); let since = null; let json = false; let allBranches = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = path.resolve(argv[++i] ?? '.');
    else if (argv[i] === '--since') since = argv[++i] ?? '';
    else if (argv[i] === '--json') json = true;
    else if (argv[i] === '--all-branches') allBranches = true;
    else { console.error('用法: report.mjs [--root <项目根>] [--since YYYY-MM-DD] [--all-branches] [--json]'); return 1; }
  }
  if (since !== null && !/^\d{4}-\d{2}-\d{2}$/.test(since)) { console.error('--since 需要 YYYY-MM-DD'); return 1; }
  const r = buildReport(root, { since, allBranches });
  console.log(json ? JSON.stringify(r, null, 2) : toMarkdown(r));
  return 0;
}

export { main };
const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exit(main(process.argv.slice(2)));
