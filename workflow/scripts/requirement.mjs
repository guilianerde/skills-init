#!/usr/bin/env node
// 产物按需求归档：一个需求一个目录 docs/skills/requirements/<需求名>/，开发方案、交付说明、审查报告、技术方案、上线方案都放在里面，
// meta.json 汇总需求名、绑定的分支、各产物、wiki 发布记录与 DocNexus 沉淀，供以后的可视化直接读取。
// 需求名由用户在流程开始或第一次落盘时给出；用户不给时按分支名生成。分支 → 需求的绑定记在 meta.json 的 branches。
// 这个目录默认写进项目根的 .ignore，不参与代码搜索（检索交给 DocNexus）；各 skill 按这里给出的路径直接读写。
// 说明见 workflow/references/requirements.md。
//
// 用法（在项目根执行；--root 可指定项目根；--branch 缺省为当前 git 分支）：
//   node .agents/skills/workflow/scripts/requirement.mjs which [--branch b]              # 当前分支绑定的需求；没绑定时给出按分支名生成的建议名和最近的需求
//   node .agents/skills/workflow/scripts/requirement.mjs bind [--name <需求名>] [--branch b] [--base m]   # 绑定（没有就新建）；不给 --name 按分支名生成
//   node .agents/skills/workflow/scripts/requirement.mjs path <plan|delivery|review|tech|release> [--branch b]   # 本次落盘的文件路径（不覆盖：已有则 _v2、_v3）
//   node .agents/skills/workflow/scripts/requirement.mjs sync [<需求目录或其中的文件> | --all]   # 按目录里的文件重建 meta.json
//   node .agents/skills/workflow/scripts/requirement.mjs list                            # 所有需求（名称、分支、产物数、更新时间）
//   node .agents/skills/workflow/scripts/requirement.mjs migrate [--dry-run]             # 把旧版 docs/skills/<skill>/ 下的产物按分支搬进需求目录
// 输出 JSON。退出码：0 正常；1 参数错误 / git 失败；2 当前分支还没绑定需求（path 时：先问用户需求名再 bind）

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REQ_DIR = 'docs/skills/requirements';
export const IGNORE_LINE = `${REQ_DIR}/`;
// 产物种类 → 需求目录里的文件名（版本：<base>.md、<base>_v2.md …）
export const FILES = { plan: 'plan', delivery: 'delivery', review: 'review', tech: 'tech-doc', release: 'release-doc' };
// 旧版目录（docs/skills/<skill>/<前缀>…）→ 种类
const LEGACY = [
  { kind: 'plan', skill: 'dev', prefix: 'plan-' },
  { kind: 'delivery', skill: 'dev', prefix: 'delivery-' },
  { kind: 'review', skill: 'project-review', prefix: 'review-' },
  { kind: 'tech', skill: 'create-tech-md-doc', prefix: 'tech-doc' },
  { kind: 'release', skill: 'create-release-md-doc', prefix: 'release-doc' },
];

const git = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const toPosix = (p) => p.split(path.sep).join('/');
const now = () => new Date().toISOString();

// 需求名 → 目录名：保留中文，去掉路径与文件系统不允许的字符，空白换成 -
export function dirName(name) {
  const s = String(name).normalize('NFC').trim()
    .replace(/[\\/:*?"<>|#%{}^~[\]`'$&@!=+,;]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return [...s].slice(0, 60).join('') || 'unnamed';
}

// 文件名 → { kind, version }；不是需求目录里的产物返回 null
export function parseFile(name) {
  for (const [kind, base] of Object.entries(FILES)) {
    const m = new RegExp(`^${base}(?:_v(\\d+))?\\.md$`).exec(name);
    if (m) return { kind, version: m[1] ? Number(m[1]) : 1 };
  }
  return null;
}

function currentBranch(root) {
  const r = git(root, ['symbolic-ref', '--short', 'HEAD']);
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

const head = (text, n = 20) => text.split(/\r?\n/).slice(0, n).join('\n');
function parseBranch(text) {
  const m = head(text).match(/(?:对比)?分支[：:]\s*`?([^`\s｜|←，,）)]+)`?/);
  return m && !/^[{<]/.test(m[1]) ? m[1] : null;
}
function parseWiki(text) {
  const m = /^<!-- md-to-wiki: ([^\n]*?) -->/.exec(text);
  if (!m) return null;
  const kv = Object.fromEntries([...m[1].matchAll(/(\w+)=(\S+)/g)].map((x) => [x[1], x[2]]));
  return kv.pageId ? { pageId: kv.pageId, version: kv.version ? Number(kv.version) : null, url: kv.url ?? null, at: kv.at ?? null } : null;
}
function parseDocnexus(text) {
  const v = /DocNexus[：:]\s*([^｜\n]*)/.exec(head(text))?.[1]?.trim();
  return v && /docnexus\/library\//.test(v) ? v.split(/[、,，]\s*/).map((s) => s.trim()).filter(Boolean) : null;
}
const headerDate = (text) => /(\d{4}-\d{2}-\d{2})/.exec(head(text, 8))?.[1] ?? null;

// ------------------------------------------------------------------ 读需求
export function requirements(root) {
  const base = path.join(root, REQ_DIR);
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => {
    const dir = path.join(base, d.name);
    const meta = readJson(path.join(dir, 'meta.json')) ?? {};
    return { dir: toPosix(path.relative(root, dir)), slug: d.name, name: meta.name ?? d.name, branches: meta.branches ?? [], updated: meta.updated ?? null, meta };
  });
}

// 分支绑定的需求：多个需求都绑了这个分支时取最近更新的
export function find(root, branch) {
  const hits = requirements(root).filter((r) => r.branches.includes(branch));
  hits.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  return hits[0] ?? null;
}

// 按目录里的文件重建 meta.json（保留需求名、分支、创建时间）
export function sync(root, dirRel) {
  const dir = path.join(root, dirRel);
  const f = path.join(dir, 'meta.json');
  const old = readJson(f) ?? {};
  const artifacts = fs.readdirSync(dir).map((name) => {
    const p = parseFile(name);
    if (!p) return null;
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    return { kind: p.kind, version: p.version, file: name, branch: parseBranch(text), date: headerDate(text), wiki: parseWiki(text), docnexus: parseDocnexus(text) };
  }).filter(Boolean).sort((a, b) => Object.keys(FILES).indexOf(a.kind) - Object.keys(FILES).indexOf(b.kind) || a.version - b.version);
  const branches = [...new Set([...(old.branches ?? []), ...artifacts.map((a) => a.branch).filter(Boolean)])];
  const latest = Object.fromEntries(Object.keys(FILES).map((k) => [k, artifacts.filter((a) => a.kind === k).at(-1)?.file ?? null]));
  // 内容没变就不写（meta.json 随需求目录提交，避免无谓的改动）；产物有变化才更新 updated
  const changed = JSON.stringify(old.artifacts ?? null) !== JSON.stringify(artifacts) || JSON.stringify(old.branches ?? null) !== JSON.stringify(branches);
  const meta = {
    name: old.name ?? path.basename(dir), named_by: old.named_by ?? 'user', branches, base: old.base ?? null,
    created: old.created ?? now(), updated: changed || !old.updated ? now() : old.updated, latest, artifacts,
  };
  const out = `${JSON.stringify(meta, null, 2)}\n`;
  if (!fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== out) fs.writeFileSync(f, out);
  return meta;
}

export function which(root, branch) {
  const r = find(root, branch);
  if (r) return { bound: true, branch, name: r.name, dir: r.dir, meta: sync(root, r.dir) };
  const recent = requirements(root).sort((a, b) => String(b.updated).localeCompare(String(a.updated))).slice(0, 5).map(({ name, dir, branches, updated }) => ({ name, dir, branches, updated }));
  return {
    bound: false, branch, suggested_name: branch ? dirName(branch.replace(/\//g, '-')) : null, recent,
    hint: '当前分支还没有绑定需求：问用户这个需求叫什么（给出 suggested_name 作为默认；也可以选 recent 里已有的需求继续），然后运行 bind --name <需求名>；用户不给就运行 bind（按分支名生成）。',
  };
}

export function bind(root, { name = null, branch, base = null }) {
  if (!branch) return { ok: false, error: '无法确定当前分支（detached HEAD？），请用 --branch 指定' };
  const named = name != null && String(name).trim() !== '';
  const display = named ? String(name).trim() : branch.replace(/\//g, '-');
  const all = requirements(root);
  // 同名需求（按目录名比）沿用；目录名被别的需求占了就加 -2、-3
  let target = all.find((r) => r.name === display) ?? null;
  let slug = target?.slug;
  if (!target) {
    slug = dirName(display);
    for (let i = 2; all.some((r) => r.slug === slug); i++) slug = `${dirName(display)}-${i}`;
  }
  const dir = path.join(root, REQ_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'meta.json');
  const meta = readJson(f) ?? { name: display, named_by: named ? 'user' : 'branch', branches: [], base, created: now() };
  if (!meta.branches.includes(branch)) meta.branches.push(branch);
  if (base && !meta.base) meta.base = base;
  meta.updated = now();
  fs.writeFileSync(f, `${JSON.stringify(meta, null, 2)}\n`);
  const rel = toPosix(path.relative(root, dir));
  return { ok: true, created: !target, name: meta.name, named_by: meta.named_by, dir: rel, branches: sync(root, rel).branches };
}

// 本次落盘路径：同种产物已存在就用下一个版本号（不覆盖），并带上上一版第一行的 wiki 发布记录
export function nextPath(root, kind, branch) {
  if (!FILES[kind]) return { code: 1, out: { ok: false, error: `未知产物种类「${kind}」：${Object.keys(FILES).join(' / ')}` } };
  const r = find(root, branch);
  if (!r) return { code: 2, out: { ok: false, ...which(root, branch) } };
  const dir = path.join(root, r.dir);
  const versions = fs.readdirSync(dir).map(parseFile).filter((p) => p?.kind === kind).map((p) => p.version);
  const v = versions.length ? Math.max(...versions) + 1 : 1;
  const file = (n) => `${FILES[kind]}${n > 1 ? `_v${n}` : ''}.md`;
  const previous = versions.length ? `${r.dir}/${file(v - 1)}` : null;
  const record = previous ? /^<!-- md-to-wiki: [^\n]*-->/.exec(fs.readFileSync(path.join(root, previous), 'utf8'))?.[0] ?? null : null;
  return { code: 0, out: { ok: true, name: r.name, dir: r.dir, path: `${r.dir}/${file(v)}`, version: v, previous, wiki_record: record } };
}

export function list(root) {
  return requirements(root).map((r) => {
    const m = sync(root, r.dir);
    return { name: m.name, dir: r.dir, branches: m.branches, named_by: m.named_by, created: m.created, artifacts: m.artifacts.length, latest: m.latest };
  }).sort((a, b) => String(b.created).localeCompare(String(a.created)));
}

// .ignore 里加上需求目录（ripgrep 与 agent 的搜索跳过它；git 不受影响）。返回是否改动
export function ensureIgnore(root) {
  const f = path.join(root, '.ignore');
  const text = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  if (text.split(/\r?\n/).some((l) => l.trim().replace(/^\//, '') === IGNORE_LINE || l.trim().replace(/^\//, '') === REQ_DIR)) return false;
  const add = `# skills-init：需求产物（开发方案、交付说明、审查报告、技术 / 上线方案）不参与代码搜索，检索交给 DocNexus\n${IGNORE_LINE}\n`;
  fs.writeFileSync(f, text ? `${text.replace(/\s*$/, '')}\n\n${add}` : add);
  return true;
}

// ------------------------------------------------------------------ 迁移旧版布局
const SHORT = /^(?:plan|delivery)-(.+?)-\d{8}(?:_v\d+)?\.md$/;

export function planMigration(root) {
  const groups = new Map(); // branch → { names:Set, files:[] }
  const left = [];
  for (const k of LEGACY) {
    const d = path.join(root, 'docs', 'skills', k.skill);
    if (!fs.existsSync(d)) continue;
    for (const name of fs.readdirSync(d)) {
      if (!name.startsWith(k.prefix) || !name.endsWith('.md')) continue;
      const rel = `docs/skills/${k.skill}/${name}`;
      const text = fs.readFileSync(path.join(root, rel), 'utf8');
      const branch = parseBranch(text);
      if (!branch) { left.push(rel); continue; }
      if (!groups.has(branch)) groups.set(branch, { names: new Set(), files: [] });
      const g = groups.get(branch);
      const short = SHORT.exec(name)?.[1];
      if (short) g.names.add(short);
      const date = /(\d{8})(?:_v(\d+))?\.md$/.exec(name);
      g.files.push({ from: rel, kind: k.kind, order: `${date?.[1] ?? ''}#${(date?.[2] ?? '1').padStart(3, '0')}`, mtime: fs.statSync(path.join(root, rel)).mtimeMs });
    }
  }
  const taken = new Set(requirements(root).map((r) => r.slug));
  const plan = [];
  for (const [branch, g] of groups) {
    const existing = find(root, branch);
    const name = existing?.name ?? (g.names.size === 1 ? [...g.names][0] : branch.replace(/\//g, '-'));
    let slug = existing?.slug;
    if (!slug) { slug = dirName(name); for (let i = 2; taken.has(slug); i++) slug = `${dirName(name)}-${i}`; taken.add(slug); }
    const dir = `${REQ_DIR}/${slug}`;
    const used = new Set(existing ? fs.readdirSync(path.join(root, dir)) : []);
    const moves = [];
    for (const kind of Object.keys(FILES)) {
      const fs_ = g.files.filter((x) => x.kind === kind).sort((a, b) => a.order.localeCompare(b.order) || a.mtime - b.mtime);
      let v = 1;
      for (const x of fs_) {
        let to;
        do { to = `${FILES[kind]}${v > 1 ? `_v${v}` : ''}.md`; v++; } while (used.has(to));
        used.add(to);
        moves.push({ from: x.from, to: `${dir}/${to}` });
      }
    }
    plan.push({ branch, name, dir, existing: !!existing, moves });
  }
  return { requirements: plan, left_in_place: left };
}

export function migrate(root, { dryRun = false } = {}) {
  const p = planMigration(root);
  if (dryRun) return { ...p, moved: 0, dry_run: true };
  let moved = 0;
  for (const r of p.requirements) {
    fs.mkdirSync(path.join(root, r.dir), { recursive: true });
    const f = path.join(root, r.dir, 'meta.json');
    if (!fs.existsSync(f)) fs.writeFileSync(f, `${JSON.stringify({ name: r.name, named_by: 'migrated', branches: [r.branch], base: null, created: now() }, null, 2)}\n`);
    for (const m of r.moves) {
      // 已跟踪的文件用 git mv 保留历史；不在 git 里就直接移动
      git(root, ['mv', '-k', m.from, m.to]);
      if (!fs.existsSync(path.join(root, m.to))) fs.renameSync(path.join(root, m.from), path.join(root, m.to));
      moved++;
    }
    sync(root, r.dir);
  }
  // 搬空的旧目录删掉（只删空目录）
  for (const k of new Set(LEGACY.map((x) => x.skill))) {
    const d = path.join(root, 'docs', 'skills', k);
    if (fs.existsSync(d) && !fs.readdirSync(d).length) fs.rmdirSync(d);
  }
  return { ...p, moved, dry_run: false };
}

// ------------------------------------------------------------------ CLI
const USAGE = '用法: requirement.mjs which | bind [--name <需求名>] | path <plan|delivery|review|tech|release> | sync [<目录|文件> | --all] | list | migrate [--dry-run]  （通用：--root <项目根> --branch <分支>）';

function main(argv) {
  let root = process.cwd();
  const o = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') root = path.resolve(argv[++i] ?? '.');
    else if (['--name', '--branch', '--base'].includes(a)) o[a.slice(2)] = argv[++i] ?? null;
    else if (a === '--all' || a === '--dry-run') o[a.slice(2)] = true;
    else if (a.startsWith('--')) { console.error(USAGE); return 1; }
    else pos.push(a);
  }
  const [cmd, arg] = pos;
  const branch = o.branch ?? currentBranch(root);
  const print = (x, code = 0) => { console.log(JSON.stringify(x, null, 2)); return code; };
  switch (cmd) {
    case 'which': return print(which(root, branch));
    case 'bind': { const r = bind(root, { name: o.name, branch, base: o.base }); return print(r, r.ok ? 0 : 1); }
    case 'path': { const r = nextPath(root, arg, branch); return print(r.out, r.code); }
    case 'list': return print(list(root));
    case 'migrate': return print(migrate(root, { dryRun: !!o['dry-run'] }));
    case 'sync': {
      if (o.all) return print(requirements(root).map((r) => ({ dir: r.dir, artifacts: sync(root, r.dir).artifacts.length })));
      let rel = arg ? toPosix(path.relative(root, path.resolve(root, arg))) : find(root, branch)?.dir;
      if (rel && !rel.startsWith(`${REQ_DIR}/`)) rel = null;
      if (rel) rel = rel.split('/').slice(0, REQ_DIR.split('/').length + 1).join('/');
      if (!rel || !fs.existsSync(path.join(root, rel))) { console.error(`不在 ${REQ_DIR}/<需求>/ 下，或当前分支没有绑定需求`); return 1; }
      const m = sync(root, rel);
      return print({ dir: rel, name: m.name, artifacts: m.artifacts.length, latest: m.latest });
    }
    default: console.error(USAGE); return 1;
  }
}

const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exit(main(process.argv.slice(2)));
