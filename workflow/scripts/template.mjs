#!/usr/bin/env node
// 修改 / 创建文档模板（/workflow template）的确定性步骤：起草稿 → 校验并与当前模板、已生成文档比对 → 确认后保存。
// 来源判定沿用 resolve.mjs template；改动只落在草稿 skills-init/tmp/template-draft/<skill>/<模板>，save 时才写到生效位置。
// 已接入 DocNexus 时 save 不直接写知识库（写入需按 capture 流程、经用户授权），退出码 2 并给出指引。
// 流程说明见 workflow/references/templates.md「修改模板」。
//
// 用法（在项目根执行；--root 可指定项目根）：
//   node .agents/skills/workflow/scripts/template.mjs list
//   node .agents/skills/workflow/scripts/template.mjs draft <模板> [--from <样例.md | ->] [--force]
//   node .agents/skills/workflow/scripts/template.mjs check <模板> [--file <草稿>]
//   node .agents/skills/workflow/scripts/template.mjs save  <模板> [--file <草稿>]
// <模板>：tech | release | plan | delivery | review | checklist，或 <skill>[/<模板文件名>]（如 create-tech-md-doc/template.md）
// draft：把当前生效的模板复制成草稿；还没有模板（或 --from）时按样例抽骨架（make-template.mjs）。草稿已存在时不覆盖，--force 重来
// check：草稿本身的格式问题、与当前模板相比的章节变化、拿最近几份已生成文档按新旧模板各跑一次 lint-doc 看影响
// save：check 无错误才写入；原模板备份到 skills-init/tmp/template-backup/<时间>/，写入后重新 resolve 确认生效，删除草稿
// 输出 JSON。退出码：0 正常；1 参数错误 / 草稿有错误；2 需要按输出的 hint 处理（缺样例、已接入 DocNexus 需 capture）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTemplate, skillMeta } from './resolve.mjs';
import { headings, lint } from './lint-doc.mjs';
import { skeleton } from './make-template.mjs';
import { collect } from './artifacts.mjs';

const ALIASES = {
  tech: ['create-tech-md-doc', 'template.md'],
  release: ['create-release-md-doc', 'template.md'],
  plan: ['dev', 'plan-template.md'],
  delivery: ['dev', 'delivery-template.md'],
  review: ['project-review', 'report.md'],
  checklist: ['project-review', 'checklist.md'],
};
// 模板 → 用它生成的产物种类（artifacts.mjs 的 KINDS），用来找已生成的文档试跑
const PRODUCES = { 'create-tech-md-doc/template.md': 'tech', 'create-release-md-doc/template.md': 'release', 'dev/plan-template.md': 'plan', 'dev/delivery-template.md': 'delivery', 'project-review/report.md': 'review' };
const SAMPLE_DOCS = 5;

const rel = (root, p) => path.relative(root, p).split(path.sep).join('/');
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');

// <模板> → { skill, id }；未知返回 null
export function target(name) {
  if (!name) return null;
  if (ALIASES[name]) { const [skill, id] = ALIASES[name]; return { skill, id }; }
  const [skill, id] = name.split('/');
  const meta = skillMeta(skill);
  if (!meta?.templates.length) return null;
  const t = id ? meta.templates.find((x) => x.id === id) : meta.templates[0];
  return t ? { skill, id: t.id } : null;
}

const draftPath = (root, { skill, id }) => path.join(root, 'skills-init', 'tmp', 'template-draft', skill, id);

// 草稿本身的格式检查：错误挡住保存，警告给用户看
export function checkFormat(text) {
  const errors = [];
  const warnings = [];
  const hs = headings(text);
  if (!hs.length) errors.push('没有任何章节标题（# / ## ...）');
  const lines = text.replace(/\r/g, '').split('\n');
  const first = lines.findIndex((l) => /^#{1,6}\s/.test(l));
  if (lines.slice(0, first < 0 ? lines.length : first).some((l) => /^\s*>/.test(l))) warnings.push('标题前有引用块：元信息由生成文档的 skill 自己写，模板里不需要');
  lines.forEach((l, i) => {
    if ((l.match(/\{\{/g) || []).length !== (l.match(/\}\}/g) || []).length) errors.push(`第 ${i + 1} 行 {{ }} 不成对：${l.trim().slice(0, 60)}`);
    if (/^\s*\{\{\s*fact:/.test(l)) errors.push(`第 ${i + 1} 行是 DocNexus 的事实引用语法 {{fact:...}}，模板里写填写说明即可`);
  });
  const seen = new Map();
  for (const h of hs.filter((x) => x.level >= 2 && x.key)) {
    const k = `${h.level}:${h.key}`;
    if (seen.has(k)) warnings.push(`章节「${h.text}」与第 ${seen.get(k)} 行重名，lint-doc 只认第一个`);
    else seen.set(k, h.line);
  }
  if (hs.length && !hs.some((h) => h.required)) warnings.push('没有标记必填章节（标题末尾加 *）：lint-doc 不会因为缺章节报错');
  return { errors, warnings, headings: hs.length, required: hs.filter((h) => h.required).map((h) => h.text.replace(/\s*\*+\s*$/, '')), optional: hs.filter((h) => h.optional).map((h) => h.text) };
}

// 与当前模板相比的章节变化（按归一化后的标题比对，改编号不算变化）
export function compare(oldText, newText) {
  const pick = (t) => headings(t).filter((h) => h.level >= 2 && h.key && !h.placeholder);
  const a = pick(oldText);
  const b = pick(newText);
  const ak = new Map(a.map((h) => [h.key, h]));
  const bk = new Map(b.map((h) => [h.key, h]));
  const mark = (h) => (h.required ? '必填' : h.optional ? '如有' : '普通');
  const order = a.map((h) => h.key).filter((k) => bk.has(k));
  const newOrder = b.map((h) => h.key).filter((k) => ak.has(k));
  return {
    added: b.filter((h) => !ak.has(h.key)).map((h) => h.text),
    removed: a.filter((h) => !bk.has(h.key)).map((h) => h.text),
    marks: b.filter((h) => ak.has(h.key) && mark(ak.get(h.key)) !== mark(h)).map((h) => `${h.text.replace(/\s*\*+\s*$/, '')}：${mark(ak.get(h.key))} → ${mark(h)}`),
    reordered: order.join('\n') !== newOrder.join('\n'),
  };
}

// 最近几份用这个模板生成的文档，按旧模板、新模板各 lint 一次，列出新模板下多出来的错误
function impact(root, t, oldText, newText) {
  const kind = PRODUCES[`${t.skill}/${t.id}`];
  if (!kind) return { docs: 0, affected: [] };
  const files = collect(root).filter((a) => a.kind === kind).map((a) => path.join(root, a.path));
  files.sort((x, y) => fs.statSync(y).mtimeMs - fs.statSync(x).mtimeMs);
  const requiredMeta = skillMeta(t.skill)?.templates.find((x) => x.id === t.id)?.lint?.requiredMeta ?? [];
  const affected = [];
  for (const f of files.slice(0, SAMPLE_DOCS)) {
    const doc = read(f);
    const before = new Set(oldText ? lint(doc, oldText, { requiredMeta }).errors : []);
    const after = lint(doc, newText, { requiredMeta }).errors.filter((e) => !before.has(e) && !/残留模板占位符|未替换/.test(e));
    if (after.length) affected.push({ path: rel(root, f), new_errors: after });
  }
  return { docs: Math.min(files.length, SAMPLE_DOCS), affected };
}

function current(root, t) {
  const r = resolveTemplate(root, t.skill, t.id);
  return { r, text: r.ok ? read(path.join(root, r.path)) : null };
}

export function draft(root, t, { from = null, force = false, stdin = () => fs.readFileSync(0, 'utf8') } = {}) {
  const file = draftPath(root, t);
  const { r, text } = current(root, t);
  const base = { skill: t.skill, id: t.id, draft: rel(root, file), source: r.ok ? r.source : null, current: r.ok ? r.path : null, docnexus: !!r.docnexus, expected: r.ok ? (r.source === 'default' ? rel(root, path.join(root, 'skills-init', 'templates', t.skill, t.id)) : r.path) : r.expected };
  if (r.error === 'unknown') return { code: 1, out: { ok: false, ...base, message: r.message } };
  if (fs.existsSync(file) && !force && !from) return { code: 0, out: { ok: true, ...base, created: false, note: '草稿已存在，沿用上次的草稿；要从当前模板重来加 --force' } };
  let content;
  let origin;
  if (from) {
    const sample = from === '-' ? stdin() : read(from);
    if (sample == null) return { code: 1, out: { ok: false, ...base, message: `读不到样例：${from}` } };
    const sk = skeleton(sample);
    if (!sk.headings) return { code: 1, out: { ok: false, ...base, message: '样例里没有任何标题，无法抽取结构；请换一份带章节标题的样例' } };
    [content, origin] = [sk.template, 'sample'];
  } else if (text != null) {
    [content, origin] = [text, r.source];
  } else if (r.import_from && read(path.join(root, r.import_from)) != null) {
    [content, origin] = [read(path.join(root, r.import_from)), 'import_from'];
  } else {
    return { code: 2, out: { ok: false, ...base, need_sample: true, hint: '还没有这份模板。请用户给一份团队现有的同类文档作样例（本地 md，或 wiki 页面用 md-to-wiki/scripts/upload.mjs get <pageId> --text 取 text），再运行 draft <模板> --from <样例文件>' } };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return { code: 0, out: { ok: true, ...base, created: true, from: origin } };
}

export function check(root, t, file = null) {
  const f = file ? path.resolve(root, file) : draftPath(root, t);
  const text = read(f);
  if (text == null) return { code: 1, out: { ok: false, skill: t.skill, id: t.id, message: `没有草稿 ${rel(root, f)}：先运行 draft` } };
  const { r, text: old } = current(root, t);
  const fmt = checkFormat(text);
  return {
    code: fmt.errors.length ? 1 : 0,
    out: {
      ok: !fmt.errors.length, skill: t.skill, id: t.id, draft: rel(root, f),
      current: r.ok ? r.path : null, source: r.ok ? r.source : null, ...fmt,
      changes: old != null ? compare(old, text) : null,
      unchanged: old != null && old === text,
      impact: impact(root, t, old, text),
    },
  };
}

export function save(root, t, file = null) {
  const c = check(root, t, file);
  if (c.code) return c;
  if (c.out.unchanged) return { code: 0, out: { ok: true, skill: t.skill, id: t.id, saved: null, note: '草稿与当前模板相同，没有写入' } };
  const r = resolveTemplate(root, t.skill, t.id);
  if (r.docnexus) {
    return {
      code: 2, out: {
        ok: false, skill: t.skill, id: t.id, docnexus: true, draft: c.out.draft, expected: r.ok ? r.path : r.expected,
        hint: '已接入 DocNexus，模板只认知识库里的那份，写入要按 capture 流程并经用户授权：已有模板时先 document get --include document,metadata,timeline 取 record_version，以草稿内容 --base-version <record_version> --category doc-template 封存，用户确认后 document add --draft <id> --replace；还没有时以 --category doc-template 新建。完成后重新运行 resolve.mjs template 确认。',
      },
    };
  }
  const dst = path.join(root, 'skills-init', 'templates', t.skill, t.id);
  let backup = null;
  if (fs.existsSync(dst)) {
    backup = path.join(root, 'skills-init', 'tmp', 'template-backup', stamp(), t.skill, t.id);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(dst, backup);
  }
  const src = path.resolve(root, c.out.draft);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, fs.readFileSync(src, 'utf8'));
  const after = resolveTemplate(root, t.skill, t.id);
  const effective = after.ok && after.path === rel(root, dst);
  if (effective && src === draftPath(root, t)) fs.rmSync(src);
  return { code: effective ? 0 : 1, out: { ok: effective, skill: t.skill, id: t.id, saved: rel(root, dst), backup: backup && rel(root, backup), effective, source: after.source ?? null, warnings: c.out.warnings, changes: c.out.changes } };
}

export function list(root) {
  return Object.entries(ALIASES).map(([alias, [skill, id]]) => {
    if (!skillMeta(skill)) return null;
    const r = resolveTemplate(root, skill, id);
    const d = draftPath(root, { skill, id });
    return { alias, skill, id, source: r.ok ? r.source : null, path: r.ok ? r.path : null, missing: !r.ok, draft: fs.existsSync(d) ? rel(root, d) : null };
  }).filter(Boolean);
}

const USAGE = '用法: template.mjs list | draft <模板> [--from <样例|->] [--force] | check <模板> [--file <草稿>] | save <模板> [--file <草稿>]  （<模板>：tech / release / plan / delivery / review / checklist 或 <skill>/<文件名>）';

function main(argv) {
  let root = process.cwd();
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = path.resolve(argv[++i] ?? '.');
    else if (argv[i] === '--from' || argv[i] === '--file') opt[argv[i].slice(2)] = argv[++i] ?? null;
    else if (argv[i] === '--force') opt.force = true;
    else if (argv[i].startsWith('--')) { console.error(USAGE); return 1; }
    else pos.push(argv[i]);
  }
  const [cmd, name] = pos;
  if (cmd === 'list') { console.log(JSON.stringify(list(root), null, 2)); return 0; }
  if (!['draft', 'check', 'save'].includes(cmd)) { console.error(USAGE); return 1; }
  const t = target(name);
  if (!t) { console.error(`未知模板「${name ?? ''}」。${USAGE}`); return 1; }
  const res = cmd === 'draft' ? draft(root, t, { from: opt.from, force: opt.force }) : cmd === 'check' ? check(root, t, opt.file) : save(root, t, opt.file);
  console.log(JSON.stringify(res.out, null, 2));
  return res.code;
}

const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exit(main(process.argv.slice(2)));
