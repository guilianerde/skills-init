// 需求绑定、产物版本与索引写入；调用只读查询和底层原子存储。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { updateMeta } from './meta-store.mjs';
import { FILES, LABELS, parseFile, parseBranch, parseWiki, parseDocnexus, headerDate } from './artifact-model.mjs';
import { HOME, REQ_DIR, TMP_DIR, dirName, profileDir, layout, setConfig } from './project.mjs';
import { requirements, repoRequirements, find } from './requirement-read.mjs';
import { loadWorkspace } from './workspace-read.mjs';
const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const relOf = (root, abs) => path.relative(root, abs).split(path.sep).join('/');
const toPosix = (p) => p.split(path.sep).join('/');
const now = () => new Date().toISOString();
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const skipDir = (d) => !d.isDirectory() || d.name.startsWith('.');

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
    const branches = old.branches ?? []; // 绑定只由 bind 更新；文档头不隐式修改需求归属。
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
  const workspace = loadWorkspace(root);
  return workspace.requirements.map((r) => {
    const artifacts = workspace.artifacts.filter((a) => a.requirement === r.slug && a.project === r.project).sort((a, b) => a.version - b.version);
    const latest = Object.fromEntries(Object.keys(FILES).map((kind) => [kind, artifacts.filter((a) => a.kind === kind).at(-1)?.path.split('/').at(-1) ?? null]));
    return { name: r.name, dir: r.dir, branches: r.branches, named_by: r.meta.named_by, created: r.meta.created, artifacts: artifacts.length, latest,
      ...(!r.valid ? { diagnostics: workspace.diagnostics.filter((d) => d.path.startsWith(r.dir + '/')) } : {}) };
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
