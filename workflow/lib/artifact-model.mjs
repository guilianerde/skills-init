// 正式需求产物的统一纯模型；不扫描目录、不修改状态。
import { sections, section, tableRows, listItems, meta, isEmpty } from './document-model.mjs';

export const FILES = { requirement: 'requirement', plan: 'plan', delivery: 'delivery', review: 'review', tech: 'tech-doc', release: 'release-doc' };
export const LABELS = { requirement: '需求文档', plan: '方案', delivery: '交付说明', review: '审查报告', tech: '技术方案', release: '上线方案' };
export const KINDS = Object.keys(FILES).map((kind) => ({ kind, label: LABELS[kind] }));

// 文件名 → { kind, version }；不是需求目录里的产物返回 null
export function parseFile(name) {
  for (const [kind, base] of Object.entries(FILES)) {
    const m = new RegExp(`^${base}(?:_v(\\d+))?\\.md$`).exec(name);
    if (m) return { kind, version: m[1] ? Number(m[1]) : 1 };
  }
  return null;
}

const head = (text, n = 20) => text.split(/\r?\n/).slice(0, n).join('\n');
export function parseBranch(text) {
  const m = head(text).match(/(?:对比)?分支[：:]\s*`?([^`\s｜|←，,）)]+)`?/);
  return m && !/^[{<]/.test(m[1]) ? m[1] : null;
}
export function parseWiki(text) {
  const m = /^<!-- md-to-wiki: ([^\n]*?) -->/.exec(text);
  if (!m) return null;
  const kv = Object.fromEntries([...m[1].matchAll(/(\w+)=(\S+)/g)].map((x) => [x[1], x[2]]));
  return kv.pageId ? { pageId: kv.pageId, version: kv.version ? Number(kv.version) : null, url: kv.url ?? null, at: kv.at ?? null } : null;
}
export function parseDocnexus(text) {
  const v = /DocNexus[：:]\s*([^｜\n]*)/.exec(head(text))?.[1]?.trim();
  return v && /docnexus\/library\//.test(v) ? v.split(/[、,，]\s*/).map((s) => s.trim()).filter(Boolean) : null;
}
// 文档头里的日期（跳过第一行的 md-to-wiki 发布记录等 HTML 注释，那里的 at= 是发布时间）
export const headerDate = (text) => /(\d{4}-\d{2}-\d{2})/.exec(head(text.replace(/<!--[\s\S]*?-->/g, ''), 8))?.[1] ?? null;

const LEVELS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

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
