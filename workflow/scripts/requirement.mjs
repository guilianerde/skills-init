#!/usr/bin/env node
// 产物按需求归档：方案、交付说明、审查报告、技术方案、上线方案按需求放在一起，meta.json 汇总需求名、绑定的分支、各产物、
// wiki 发布记录与 DocNexus 沉淀，供 /workflow view 等直接读取。
// 本工具的产出都在项目根的 workflow-run/ 里（需求产物 docs/requirements/、DocNexus 工作区 docnexus/、项目模板 templates/、临时文件 tmp/），
// 不往项目的其他地方写。两种用法：
// 两种用法的目录结构完全一样：产物都在 workflow-run/docs/requirements/<需求名>/<项目名>/，一个需求横跨多个服务时各项目各占一个子目录，
// 所以两种用法之间切换只是换一个 git 仓库来跟踪 workflow-run/，文件不用挪：
//   - 默认：workflow-run/ 随代码提交；项目名没配置时取 git 远端仓库名（第一次 bind 时写进 profile.json，之后固定）
//   - 独立文档仓库：团队文档仓库克隆到 workflow-run/（它自己是 git 仓库，代码仓库忽略它），项目名要先配置（各服务在同一个仓库里，名字由团队定）；
//     文档仓库单独提交（写完由用户确认，可用 artifacts.commit_prompt 关闭提交提示）
// 需求目录写进项目根 .ignore，不参与代码搜索。旧版本（随代码提交时没有 <项目名>/ 这一层）的产物由安装器 upgrade 时迁移（migrateLayout）
// 需求名由用户在流程开始或第一次落盘时给出；用户不给时按分支名生成。分支 → 需求的绑定记在 meta.json 的 branches。
// 说明见 workflow/references/requirements.md。
//
// 用法（在项目根执行；--root 可指定项目根；--branch 缺省为当前 git 分支）：
//   requirement.mjs which [--branch b]                 # 当前分支绑定的需求；没绑定时给出建议名、最近的需求（文档仓库模式还列出其他项目的需求）
//   requirement.mjs bind [--name <需求名>] [--branch b] [--base m]   # 绑定（没有就新建）；不给 --name 按分支名生成
//   requirement.mjs path <plan|delivery|review|tech|release> [--branch b]   # 本次落盘的文件路径（文件名固定；已有时上一版复制到
//                                                     # workflow-run/tmp/old-artifacts/<种类>_v<N>.md，输出 previous）
//   requirement.mjs sync [<需求目录或其中的文件> | --all]  # 按目录里的文件重建 meta.json；指定了目录 / 文件时确认新版本号、输出归档了哪些上一版；
//                                                     # 文档仓库模式下带上提交提示
//   requirement.mjs pending [--branch b]               # 文档仓库模式：当前需求在文档仓库里未提交的改动与建议的提交命令
//   requirement.mjs list                               # 所有需求（名称、分支、产物数、更新时间）
//   requirement.mjs config [--project <项目名>] [--commit-prompt on|off] [--local]   # 查看 / 修改产物配置
// 输出 JSON。退出码：0 正常；1 参数错误 / git 失败；2 需要先问用户（还没绑定需求、还没配置项目名）

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { updateMeta } from './meta-store.mjs';

const SKILLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// 本工具在项目里的唯一目录
export const HOME = 'workflow-run';
export const REQ_DIR = `${HOME}/docs/requirements`;
export const TEMPLATES_DIR = `${HOME}/templates`;
export const TMP_DIR = `${HOME}/tmp`;
export const IGNORE_LINE = `${HOME}/docs/`;
export const homeDir = (root) => path.join(root, HOME);
// workflow-run/ 自己是 git 仓库（团队文档仓库克隆到这里）= 独立文档仓库模式
export const homeIsRepo = (root) => fs.existsSync(path.join(root, HOME, '.git'));
// 产物种类 → 需求目录里的文件名（只放最新版 <base>.md；版本号在 meta.json 的 versions，旧版归档为 <base>_v<N>.md）
export const FILES = { plan: 'plan', delivery: 'delivery', review: 'review', tech: 'tech-doc', release: 'release-doc' };
const LABELS = { plan: '方案', delivery: '交付说明', review: '审查报告', tech: '技术方案', release: '上线方案' };
// 安装后的 skills 目录（安装器从安装包调用本脚本时，到项目里找画像）
const INSTALL_BASES = ['.agents/skills', '.claude/skills', '.qwen/skills', '.codebuddy/skills'];

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const toPosix = (p) => p.split(path.sep).join('/');
const now = () => new Date().toISOString();
const relOf = (root, abs) => toPosix(path.relative(root, abs));
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const skipDir = (d) => !d.isDirectory() || d.name.startsWith('.');

// 需求名 / 项目名 → 目录名：保留中文，去掉路径与文件系统不允许的字符，空白换成 -
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
export function parseBranch(text) {
  const m = head(text).match(/(?:对比)?分支[：:]\s*`?([^`\s｜|←，,）)]+)`?/);
  return m && !/^[{<]/.test(m[1]) ? m[1] : null;
}
function parseWiki(text) {
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
const headerDate = (text) => /(\d{4}-\d{2}-\d{2})/.exec(head(text.replace(/<!--[\s\S]*?-->/g, ''), 8))?.[1] ?? null;

// ------------------------------------------------------------------ 配置与布局
// 画像所在目录：本脚本所在的 skills 目录；从安装包调用时（安装器）到项目里已安装的 skills 目录找
function profileDir(root) {
  const own = path.join(SKILLS_DIR, 'workflow');
  if (fs.existsSync(path.join(own, 'profile.json')) || fs.existsSync(path.join(own, 'profile.local.json'))) return own;
  for (const b of INSTALL_BASES) { const d = path.join(root, b, 'workflow'); if (fs.existsSync(path.join(d, 'profile.json'))) return d; }
  return own;
}

// workflow/profile.json 的 artifacts，profile.local.json（个人设置，不提交）覆盖其上
export function artifactsConfig(root) {
  const dir = profileDir(root);
  const team = readJson(path.join(dir, 'profile.json'))?.artifacts ?? {};
  const mine = readJson(path.join(dir, 'profile.local.json'))?.artifacts ?? {};
  const c = { ...team, ...mine };
  return { project: c.project ? String(c.project) : '', commit_prompt: c.commit_prompt !== false, profile_dir: dir };
}

// 产物位置：两种模式都是 workflow-run/docs/requirements/<需求>/<项目>/。
// mode 只决定谁来提交（project = 随代码提交，repo = workflow-run/ 是独立的文档仓库）、引用怎么写、项目名能不能自动取
export function layout(root, cfg = artifactsConfig(root)) {
  const home = homeDir(root);
  const base = path.join(root, REQ_DIR);
  if (!homeIsRepo(root)) {
    const project = cfg.project ? dirName(cfg.project) : suggestProject(root);
    return { mode: 'project', ok: true, base, home, repo: null, project, project_configured: !!cfg.project, commit_prompt: cfg.commit_prompt, reqDir: (slug) => path.join(base, slug, project), ref: (abs) => relOf(root, abs) };
  }
  const repoName = remoteName(home);
  const L = { mode: 'repo', base, home, repo: home, repo_rel: HOME, repo_name: repoName, project: cfg.project ? dirName(cfg.project) : null, project_configured: !!cfg.project, commit_prompt: cfg.commit_prompt };
  L.reqDir = (slug) => path.join(base, slug, L.project ?? '_');
  // 文档里引用产物用「文档仓库名:仓库内路径」，各服务、各人的克隆里都一样
  L.ref = (abs) => `${repoName}:${toPosix(path.relative(home, abs))}`;
  if (!L.project) return { ...L, ok: false, need_project: true, suggested_project: suggestProject(root), hint: '文档仓库模式需要项目名（产物放在 workflow-run/docs/requirements/<需求名>/<项目名>/），只需配置一次：问用户这个项目在文档仓库里叫什么（默认 suggested_project），然后运行 config --project <项目名>' };
  return { ...L, ok: true };
}

// 文档仓库名：它的 git 远端仓库名，没有远端时用 workflow-run
const remoteNames = new Map();
function remoteName(home) {
  if (!remoteNames.has(home)) {
    const url = git(home, ['remote', 'get-url', 'origin']).stdout?.trim();
    remoteNames.set(home, url ? url.replace(/[/\\]+$/, '').replace(/\.git$/, '').split(/[/\\:]/).pop() || HOME : HOME);
  }
  return remoteNames.get(home);
}

// 项目名建议：git 远端仓库名，取不到用项目目录名
export function suggestProject(root) {
  const url = git(root, ['remote', 'get-url', 'origin']).stdout?.trim();
  const name = url ? url.replace(/[/\\]+$/, '').replace(/\.git$/, '').split(/[/\\:]/).pop() : path.basename(path.resolve(root));
  return dirName(name);
}

// ------------------------------------------------------------------ 读需求
// 当前项目的需求目录：{ dir（相对项目根）, abs, slug, name, branches, updated, meta }
export function requirements(root, L = layout(root)) {
  if (!L.ok && L.mode === 'repo') return [];
  const out = [];
  if (!isDir(L.base)) return out;
  for (const d of fs.readdirSync(L.base, { withFileTypes: true })) {
    if (skipDir(d)) continue;
    const abs = L.reqDir(d.name);
    if (!isDir(abs)) continue;
    const meta = readJson(path.join(abs, 'meta.json')) ?? {};
    out.push({ dir: relOf(root, abs), abs, slug: d.name, name: meta.name ?? d.name, branches: meta.branches ?? [], updated: meta.updated ?? null, meta });
  }
  return out;
}

// 所有项目的需求（跨服务视图、bind 时找同名需求）：{ slug, name, projects:[{ project, abs, dir, meta }] }。
// 两种模式结构相同；随代码提交时通常只有本项目一个
export function repoRequirements(root, L = layout(root)) {
  if (!isDir(L.base)) return [];
  const out = [];
  for (const d of fs.readdirSync(L.base, { withFileTypes: true })) {
    if (skipDir(d)) continue;
    const projects = fs.readdirSync(path.join(L.base, d.name), { withFileTypes: true }).filter((p) => p.isDirectory() && !p.name.startsWith('.')).map((p) => {
      const abs = path.join(L.base, d.name, p.name);
      return { project: p.name, abs, dir: relOf(root, abs), meta: readJson(path.join(abs, 'meta.json')) ?? {} };
    });
    if (!projects.length) continue;
    const name = projects.map((p) => p.meta.name).find(Boolean) ?? d.name;
    const updated = projects.map((p) => p.meta.updated ?? '').sort().at(-1) || null;
    out.push({ slug: d.name, name, updated, projects });
  }
  return out;
}

// 产物文件（view / artifacts.mjs 读）：{ abs, rel（相对项目根）, cite（文档里引用它的写法）, slug, project, kind, version }
export function artifactFiles(root, { allProjects = false } = {}) {
  const L = layout(root);
  const dirs = allProjects
    ? repoRequirements(root, L).flatMap((r) => r.projects.map((p) => ({ abs: p.abs, slug: r.slug, project: p.project })))
    : requirements(root, L).map((r) => ({ abs: r.abs, slug: r.slug, project: L.project }));
  const out = [];
  for (const d of dirs) {
    const versions = versionsOf(d.abs);
    for (const name of fs.readdirSync(d.abs)) {
      const p = parseFile(name);
      if (!p) continue;
      const abs = path.join(d.abs, name);
      out.push({ abs, rel: relOf(root, abs), cite: L.ref(abs), slug: d.slug, project: d.project, ...p, ...(name === `${FILES[p.kind]}.md` ? { version: versions[p.kind] ?? 1 } : {}) });
    }
  }
  return out;
}

// 分支绑定的需求：多个需求都绑了这个分支时取最近更新的
export function find(root, branch, L = layout(root)) {
  const hits = requirements(root, L).filter((r) => r.branches.includes(branch));
  hits.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  return hits[0] ?? null;
}

// 同种产物只留最新版，文件名固定（review.md、tech-doc.md …），文档里的引用不会失效。版本号记在 meta.json 的 versions。
// path 时把当前版复制到 workflow-run/tmp/old-artifacts/<需求目录（相对 requirements/）>/<种类>_v<N>.md（不提交），
// 写完 sync <path> 时新版内容和这份副本不同才算新版本（versions 加一）；没写就放弃的话版本号不变
export const OLD_DIR = `${TMP_DIR}/old-artifacts`;
const archivePath = (root, dirAbs, kind, v) => path.join(root, OLD_DIR, path.relative(path.join(root, REQ_DIR), dirAbs), `${FILES[kind]}_v${v}.md`);
const versionsOf = (dirAbs) => readJson(path.join(dirAbs, 'meta.json'))?.versions ?? {};

// 按目录里的文件重建 meta.json（保留需求名、分支、创建时间）
// bump：写完新版后（sync <path>）确认新版本——和 path 时归档的上一版副本内容不同就把版本号加一，返回归档了哪些
export function sync(root, dirRel, { bump = false } = {}) {
  const dir = path.resolve(root, dirRel);
  const f = path.join(dir, 'meta.json');
  const archived = [];
  const result = updateMeta(f, (old) => {
    const versions = { ...(old.versions ?? {}) };
    if (bump) {
      for (const kind of Object.keys(FILES)) {
        const cur = path.join(dir, `${FILES[kind]}.md`);
        const v = versions[kind] ?? 1;
        const arc = archivePath(root, dir, kind, v);
        if (!fs.existsSync(cur) || !fs.existsSync(arc) || fs.readFileSync(arc).equals(fs.readFileSync(cur))) continue;
        versions[kind] = v + 1;
        archived.push({ kind, version: v, file: relOf(root, arc) });
      }
    }
    const artifacts = fs.readdirSync(dir).map((name) => {
      const p = parseFile(name);
      if (!p) return null;
      const text = fs.readFileSync(path.join(dir, name), 'utf8');
      return { kind: p.kind, version: name === `${FILES[p.kind]}.md` ? versions[p.kind] ?? 1 : p.version, file: name, branch: parseBranch(text), date: headerDate(text), wiki: parseWiki(text), docnexus: parseDocnexus(text) };
    }).filter(Boolean).sort((a, b) => Object.keys(FILES).indexOf(a.kind) - Object.keys(FILES).indexOf(b.kind) || a.version - b.version);
    const branches = [...new Set([...(old.branches ?? []), ...artifacts.map((a) => a.branch).filter(Boolean)])];
    const latest = Object.fromEntries(Object.keys(FILES).map((k) => [k, artifacts.filter((a) => a.kind === k).at(-1)?.file ?? null]));
    // 内容没变就不写（meta.json 随需求目录提交，避免无谓的改动）；产物有变化才更新 updated
    const changed = JSON.stringify(old.artifacts ?? null) !== JSON.stringify(artifacts) || JSON.stringify(old.branches ?? null) !== JSON.stringify(branches);
    const meta = {
      ...old,
      name: old.name ?? path.basename(dir), named_by: old.named_by ?? 'user', ...(old.project ? { project: old.project } : {}), branches, base: old.base ?? null,
      created: old.created ?? now(), updated: changed || !old.updated ? now() : old.updated, latest, ...(Object.keys(versions).length ? { versions } : {}), artifacts,
    };
    return meta;
  }, { root });
  return bump ? { ...result, archived } : result;
}

const notReady = (L) => ({ ok: false, mode: L.mode, ...(L.need_project ? { need_project: true, suggested_project: L.suggested_project } : {}), hint: L.hint });

export function which(root, branch) {
  const L = layout(root);
  if (!L.ok) return notReady(L);
  const r = find(root, branch, L);
  const where = L.mode === 'repo' ? { mode: 'repo', repo: L.repo_rel, project: L.project } : { mode: 'project', project: L.project };
  if (r) return { bound: true, ...where, branch, name: r.name, dir: r.dir, meta: sync(root, r.dir) };
  const recent = requirements(root, L).sort((a, b) => String(b.updated).localeCompare(String(a.updated))).slice(0, 5).map(({ name, dir, branches, updated }) => ({ name, dir, branches, updated }));
  // 其他项目已有的需求（跨服务需求，本项目可以用同一个名字加入）；文档仓库里常见，随代码提交时一般没有
  const mine = new Set(requirements(root, L).map((x) => x.slug));
  const others = repoRequirements(root, L).filter((x) => !mine.has(x.slug)).sort((a, b) => String(b.updated).localeCompare(String(a.updated))).slice(0, 10).map((x) => ({ name: x.name, projects: x.projects.map((p) => p.project), updated: x.updated }));
  return {
    bound: false, ...where, branch, suggested_name: branch ? dirName(branch.replace(/\//g, '-')) : null, recent, ...(others.length || L.mode === 'repo' ? { other_projects: others } : {}),
    hint: `当前分支还没有绑定需求：问用户这个需求叫什么（给出 suggested_name 作为默认；也可以选 recent 里已有的需求继续${others.length || L.mode === 'repo' ? '，或加入 other_projects 里其他服务已有的需求' : ''}），然后运行 bind --name <需求名>；用户不给就运行 bind（按分支名生成）。`,
  };
}

export function bind(root, { name = null, branch, base = null }) {
  const L = layout(root);
  if (!L.ok) return notReady(L);
  if (!branch) return { ok: false, error: '无法确定当前分支（detached HEAD？），请用 --branch 指定' };
  const named = name != null && String(name).trim() !== '';
  const display = named ? String(name).trim() : branch.replace(/\//g, '-');
  // 同名需求沿用（按所有项目找，跨服务的需求共用一个目录）；目录名被别的需求占了就加 -2、-3
  const pool = repoRequirements(root, L).map((r) => ({ slug: r.slug, name: r.name }));
  const target = pool.find((r) => r.name === display) ?? null;
  let slug = target?.slug;
  if (!slug) {
    slug = dirName(display);
    for (let i = 2; pool.some((r) => r.slug === slug) || isDir(L.reqDir(slug)); i++) slug = `${dirName(display)}-${i}`;
  }
  // 随代码提交时项目名是自动取的：第一次落盘时写进 profile.json 固定下来，之后改了 git 远端名也不会换目录
  // （只在项目里装过 skills、有 profile.json 时写；直接从安装包运行脚本时不写）
  if (!L.project_configured && fs.existsSync(path.join(profileDir(root), 'profile.json'))) setConfig(root, { project: L.project });
  const dir = L.reqDir(slug);
  const existedHere = isDir(dir);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'meta.json');
  const meta = updateMeta(f, (old) => {
    const value = Object.keys(old).length ? old : { name: target?.name ?? display, named_by: named ? 'user' : 'branch', project: L.project, branches: [], base, created: now() };
    if (!value.branches.includes(branch)) value.branches.push(branch);
    if (base && !value.base) value.base = base;
    value.updated = now();
    return value;
  }, { root });
  const rel = relOf(root, dir);
  return { ok: true, mode: L.mode, created: !existedHere, joined: !!target && !existedHere, name: meta.name, named_by: meta.named_by, dir: rel, project: L.project, branches: sync(root, rel).branches };
}

// 本次落盘路径：文件名固定（review.md …），已有时先把当前版复制到 tmp/old-artifacts/<种类>_v<N>.md（previous，复审对照用），
// 并带上它第一行的 wiki 发布记录；新版直接写到 path（覆盖当前版），写完 sync <path> 确认版本号
export function nextPath(root, kind, branch) {
  if (!FILES[kind]) return { code: 1, out: { ok: false, error: `未知产物种类「${kind}」：${Object.keys(FILES).join(' / ')}` } };
  const L = layout(root);
  if (!L.ok) return { code: 2, out: notReady(L) };
  const r = find(root, branch, L);
  if (!r) return { code: 2, out: { ok: false, ...which(root, branch) } };
  const abs = path.join(r.abs, `${FILES[kind]}.md`);
  let v = 1; let previous = null; let record = null;
  if (fs.existsSync(abs)) {
    const cur = versionsOf(r.abs)[kind] ?? 1;
    const arc = archivePath(root, r.abs, kind, cur);
    fs.mkdirSync(path.dirname(arc), { recursive: true });
    fs.copyFileSync(abs, arc);
    v = cur + 1; previous = relOf(root, arc);
    record = /^<!-- md-to-wiki: [^\n]*-->/.exec(fs.readFileSync(abs, 'utf8'))?.[0] ?? null;
  }
  return { code: 0, out: { ok: true, mode: L.mode, name: r.name, dir: r.dir, path: relOf(root, abs), cite: L.ref(abs), version: v, previous, wiki_record: record } };
}

export function list(root) {
  const L = layout(root);
  return requirements(root, L).map((r) => {
    const m = sync(root, r.dir);
    return { name: m.name, dir: r.dir, branches: m.branches, named_by: m.named_by, created: m.created, artifacts: m.artifacts.length, latest: m.latest };
  }).sort((a, b) => String(b.created).localeCompare(String(a.created)));
}

// ------------------------------------------------------------------ 文档仓库的提交提示
// 当前需求（或给定目录）在文档仓库里未提交的改动；项目模式下产物随代码提交，不单独提示
export function pending(root, branch, dirRel = null) {
  const L = layout(root);
  if (L.mode === 'project') return { mode: 'project', commit_prompt: false, note: `产物在项目仓库的 ${HOME}/ 里，随代码一起提交` };
  if (!L.ok) return notReady(L);
  const abs = dirRel ? path.resolve(root, dirRel) : find(root, branch, L)?.abs;
  if (!abs) return { ok: false, mode: 'repo', error: '当前分支没有绑定需求' };
  const inRepo = toPosix(path.relative(L.repo, abs));
  const top = git(L.repo, ['rev-parse', '--show-toplevel']);
  if (top.status !== 0) return { ok: true, mode: 'repo', repo: L.repo_rel, is_git: false, files: [], commit_prompt: L.commit_prompt, note: '文档仓库还不是 git 仓库，产物只保存在本地' };
  const st = git(L.repo, ['-c', 'core.quotePath=false', 'status', '--porcelain', '--untracked-files=all', '--', inRepo]);
  const files = st.stdout.split('\n').filter(Boolean).map((l) => l.slice(3));
  const meta = readJson(path.join(abs, 'meta.json')) ?? {};
  const kinds = [...new Set(files.map((f) => parseFile(path.basename(f))?.kind).filter(Boolean))].map((k) => LABELS[k]);
  const message = `docs(${meta.name ?? path.basename(path.dirname(abs))}): ${L.project}${kinds.length ? ` ${kinds.join('、')}` : ' 更新产物'}`;
  // DocNexus 也在这个文档仓库里（workflow-run/docnexus/）：知识库的改动单独列出，单独提交，提交信息写沉淀了什么
  const kn = isDir(path.join(L.repo, 'docnexus', 'library'))
    ? git(L.repo, ['-c', 'core.quotePath=false', 'status', '--porcelain', '--untracked-files=all', '--', 'docnexus']).stdout.split('\n').filter(Boolean).map((l) => l.slice(3))
    : [];
  return {
    ok: true, mode: 'repo', repo: L.repo_rel, is_git: true, project: L.project, dir: relOf(root, abs), files, commit_prompt: L.commit_prompt,
    suggested_message: files.length ? message : null,
    commands: files.length ? [`git -C ${JSON.stringify(L.repo_rel)} add -- ${JSON.stringify(inRepo)}`, `git -C ${JSON.stringify(L.repo_rel)} commit -m ${JSON.stringify(message)}`] : [],
    ...(kn.length ? { knowledge_files: kn, knowledge_commands: [`git -C ${JSON.stringify(L.repo_rel)} add -- docnexus`, `git -C ${JSON.stringify(L.repo_rel)} commit -m "knowledge: <沉淀了什么>"`] } : {}),
  };
}

// ------------------------------------------------------------------ 旧结构迁移
// 旧版本随代码提交时没有 <项目名>/ 这一层：文件直接放在 docs/requirements/<需求>/ 下。
// 列出这样的需求目录（目录里直接有文件的；隐藏文件不算）
export function legacyRequirements(root) {
  const base = path.join(root, REQ_DIR);
  if (!isDir(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true }).filter((d) => !skipDir(d)).map((d) => d.name)
    .filter((slug) => fs.readdirSync(path.join(base, slug), { withFileTypes: true }).some((e) => e.isFile() && !e.name.startsWith('.')));
}

// 把旧结构的需求目录挪到 <需求>/<项目名>/：被 git 跟踪的用 git mv（保留历史），其余直接移动；
// tmp/old-artifacts/<需求>/ 下归档的上一版也一起挪，复审对照还能找到。
// 目标里已有同名文件时这个需求整个跳过，留给用户处理。项目名没配置时按 layout 自动取的写进 profile.json。
// 返回 { project, moved: [{ from, to }], skipped: [{ dir, reason }] }
export function migrateLayout(root) {
  const L = layout(root);
  const slugs = legacyRequirements(root);
  if (!slugs.length) return { project: L.project, moved: [], skipped: [] };
  if (!L.project) return { project: null, moved: [], skipped: slugs.map((s) => ({ dir: `${REQ_DIR}/${s}`, reason: '还没配置项目名' })) };
  const repoOf = (abs) => (L.mode === 'repo' ? L.repo : root);
  const tracked = (abs) => git(repoOf(abs), ['ls-files', '--error-unmatch', '--', path.relative(repoOf(abs), abs)]).status === 0;
  const moved = []; const skipped = [];
  const move = (from, to, useGit) => {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const cwd = repoOf(from);
    if (useGit && tracked(from) && git(cwd, ['mv', '--', path.relative(cwd, from), path.relative(cwd, to)]).status === 0) return;
    fs.renameSync(from, to);
  };
  for (const slug of slugs) {
    const dir = path.join(L.base, slug);
    const files = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name);
    const target = path.join(dir, L.project);
    const clash = files.filter((f) => fs.existsSync(path.join(target, f)));
    if (clash.length) { skipped.push({ dir: relOf(root, dir), reason: `${relOf(root, target)} 里已有 ${clash.join('、')}` }); continue; }
    for (const f of files) {
      move(path.join(dir, f), path.join(target, f), true);
      moved.push({ from: relOf(root, path.join(dir, f)), to: relOf(root, path.join(target, f)) });
    }
    const m = readJson(path.join(target, 'meta.json'));
    if (m && m.project !== L.project) fs.writeFileSync(path.join(target, 'meta.json'), `${JSON.stringify({ ...m, project: L.project }, null, 2)}\n`);
    const old = path.join(root, OLD_DIR, slug);
    if (isDir(old)) {
      for (const e of fs.readdirSync(old, { withFileTypes: true })) if (e.isFile()) move(path.join(old, e.name), path.join(old, L.project, e.name), false);
    }
  }
  if (moved.length && !L.project_configured && fs.existsSync(path.join(profileDir(root), 'profile.json'))) setConfig(root, { project: L.project });
  return { project: L.project, moved, skipped };
}

// ------------------------------------------------------------------ 配置
// 修改 artifacts 配置：团队共用的写 profile.json，--local 写个人的 profile.local.json（不提交）
export function setConfig(root, patch, { local = false } = {}) {
  const dir = profileDir(root);
  const f = path.join(dir, local ? 'profile.local.json' : 'profile.json');
  const cur = readJson(f) ?? {};
  const a = { ...(cur.artifacts ?? {}) };
  if (patch.project !== undefined) a.project = dirName(patch.project);
  if (patch.commit_prompt !== undefined) a.commit_prompt = patch.commit_prompt;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(f, `${JSON.stringify({ ...cur, artifacts: a }, null, 2)}\n`);
  const L = layout(root);
  return { file: relOf(root, f), artifacts: a, effective: { mode: L.mode, repo: L.repo_rel ?? null, project: L.project, commit_prompt: L.commit_prompt, ok: L.ok, hint: L.ok ? null : L.hint } };
}

// .ignore 里加上需求目录（ripgrep 与 agent 的搜索跳过它；git 不受影响）。返回是否改动
export function ensureIgnore(root) {
  const f = path.join(root, '.ignore');
  const text = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  const norm = (l) => l.trim().replace(/^\//, '').replace(/\/$/, '');
  if (text.split(/\r?\n/).some((l) => norm(l) === norm(IGNORE_LINE))) return false;
  const add = `# workflow-run：需求产物（方案、交付说明、审查报告、技术 / 上线方案）不参与代码搜索，检索交给 DocNexus\n${IGNORE_LINE}\n`;
  fs.writeFileSync(f, text ? `${text.replace(/\s*$/, '')}\n\n${add}` : add);
  return true;
}

// ------------------------------------------------------------------ CLI
const USAGE = '用法: requirement.mjs which | bind [--name <需求名>] | path <plan|delivery|review|tech|release> | sync [<目录|文件> | --all] | pending | list | config [--project <名>] [--commit-prompt on|off] [--local]  （通用：--root <项目根> --branch <分支>）';

function main(argv) {
  let root = process.cwd();
  const o = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') root = path.resolve(argv[++i] ?? '.');
    else if (['--name', '--branch', '--base', '--repo', '--project', '--commit-prompt'].includes(a)) { if (i + 1 >= argv.length) { console.error(USAGE); return 1; } o[a.slice(2)] = argv[++i]; }
    else if (a === '--all' || a === '--local') o[a.slice(2)] = true;
    else if (a.startsWith('--')) { console.error(USAGE); return 1; }
    else pos.push(a);
  }
  const [cmd, arg] = pos;
  const branch = o.branch ?? currentBranch(root);
  const print = (x, code = 0) => { console.log(JSON.stringify(x, null, 2)); return code; };
  const ready = (x) => (x.ok === false && x.need_project ? 2 : 0);
  switch (cmd) {
    case 'which': { const r = which(root, branch); return print(r, ready(r)); }
    case 'bind': { const r = bind(root, { name: o.name, branch, base: o.base }); return print(r, r.ok ? 0 : ready(r) || 1); }
    case 'path': { const r = nextPath(root, arg, branch); return print(r.out, r.code); }
    case 'list': return print(list(root));
    case 'pending': { const r = pending(root, branch); return print(r, ready(r)); }
    case 'config': {
      const patch = {};
      if (o.repo !== undefined) { console.error(`--repo 已不再支持：独立文档仓库改为把团队文档仓库克隆到项目根的 ${HOME}/（见 workflow/references/requirements.md）`); return 1; }
      if (o.project !== undefined) patch.project = o.project;
      if (o['commit-prompt'] !== undefined) {
        if (!['on', 'off'].includes(o['commit-prompt'])) { console.error('--commit-prompt 取 on / off'); return 1; }
        patch.commit_prompt = o['commit-prompt'] === 'on';
      }
      if (!Object.keys(patch).length) { const L = layout(root); const c = artifactsConfig(root); return print({ mode: L.mode, repo: L.repo_rel ?? null, project: L.project, commit_prompt: c.commit_prompt, ok: L.ok, hint: L.ok ? null : L.hint }); }
      return print(setConfig(root, patch, { local: !!o.local }));
    }
    case 'sync': {
      const L = layout(root);
      if (o.all) return print(requirements(root, L).map((r) => ({ dir: r.dir, artifacts: sync(root, r.dir).artifacts.length })));
      let target = null;
      if (arg) {
        const abs = path.resolve(root, arg);
        target = requirements(root, L).find((r) => abs === r.abs || abs.startsWith(r.abs + path.sep)) ?? null;
      } else target = find(root, branch, L);
      if (!target) { console.error('不在当前项目的需求目录下，或当前分支没有绑定需求'); return 1; }
      const m = sync(root, target.dir, { bump: true });
      const out = { dir: target.dir, name: m.name, artifacts: m.artifacts.length, latest: m.latest, versions: m.versions ?? {} };
      if (m.archived.length) {
        const to = path.posix.dirname(m.archived[0].file);
        out.archived = { files: m.archived, dir: to, hint: `上一版已归档到 ${to}/（不提交），目录里只留最新版。告诉用户归档了哪些文件，请用户确认不再需要后自己删除；不要替用户删` };
      }
      // 文档仓库模式：写完产物后提示提交（由用户确认；artifacts.commit_prompt 关闭时不提示）
      if (L.mode === 'repo') {
        const pd = pending(root, branch, target.dir);
        out.commit = pd.commit_prompt && pd.files?.length ? { repo: pd.repo, files: pd.files, suggested_message: pd.suggested_message, commands: pd.commands, hint: '文档仓库有未提交的产物：把改动和建议的提交信息给用户看，用户确认后再执行 commands；推送另外问用户' } : null;
      }
      return print(out);
    }
    default: console.error(USAGE); return 1;
  }
}

const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exit(main(process.argv.slice(2)));
