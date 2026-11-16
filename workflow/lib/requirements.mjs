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

// 同种产物只留最新版，文件名固定（review.md、tech-doc.md …），文档里的引用不会失效。版本号记在 meta.json 的 versions。
export const OLD_DIR = `${TMP_DIR}/old-artifacts`;
export const archivePath = (root, dirAbs, kind, v) => path.join(root, OLD_DIR, path.relative(path.join(root, REQ_DIR), dirAbs), `${FILES[kind]}_v${v}.md`);

export function indexArtifacts(dir, versions = {}, { requireVersion = false } = {}) {
  return fs.readdirSync(dir).map((name) => {
    const p = parseFile(name);
    if (!p) return null;
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    const fixed = name === `${FILES[p.kind]}.md`;
    const registered = !fixed || Object.hasOwn(versions, p.kind);
    return {
      kind: p.kind,
      version: fixed ? (registered ? versions[p.kind] : null) : p.version,
      file: name,
      branch: parseBranch(text),
      date: headerDate(text),
      wiki: parseWiki(text),
      docnexus: parseDocnexus(text),
      ...(requireVersion && !registered ? { registered: false } : {}),
    };
  }).filter(Boolean).sort((a, b) => Object.keys(FILES).indexOf(a.kind) - Object.keys(FILES).indexOf(b.kind) || a.version - b.version);
}

// 只重建派生索引。versions、runs、绑定、批准和证据均保持原值；版本无法确认时标为未登记。
export function reindexRequirement(root, dirRel) {
  const dir = path.resolve(root, dirRel);
  const f = path.join(dir, 'meta.json');
  const result = updateMeta(f, (old) => {
    const versions = { ...(old.versions ?? {}) };
    const artifacts = indexArtifacts(dir, versions, { requireVersion: true });
    const latest = Object.fromEntries(Object.keys(FILES).map((k) => [k, artifacts.filter((a) => a.kind === k).at(-1)?.file ?? null]));
    const changed = JSON.stringify(old.artifacts ?? null) !== JSON.stringify(artifacts);
    const meta = {
      ...old,
      latest,
      ...(Object.keys(versions).length ? { versions } : {}),
      artifacts,
      indexed_at: changed || !old.indexed_at ? now() : old.indexed_at,
    };
    return meta;
  }, { root });
  return {
    ...result,
    unregistered: result.artifacts.filter((artifact) => artifact.registered === false),
  };
}

export function reindex(root, { branch = null, all = false } = {}) {
  const L = layout(root);
  const targets = all ? requirements(root, L) : [find(root, branch, L)].filter(Boolean);
  if (!all && !targets.length) throw new Error('当前分支没有绑定需求');
  const results = [];
  for (const target of targets) {
    try {
      const meta = reindexRequirement(root, target.dir);
      results.push({
        ok: true,
        dir: target.dir,
        artifacts: meta.artifacts.length,
        latest: meta.latest,
        versions: meta.versions ?? {},
        unregistered: meta.unregistered.map(({ kind, file }) => ({ kind, file })),
      });
    } catch (error) {
      if (!all) throw error;
      results.push({ ok: false, dir: target.dir, error: error.message });
    }
  }
  return all ? { ok: results.every((entry) => entry.ok), results } : results[0];
}

const notReady = (L) => ({ ok: false, mode: L.mode, ...(L.need_project ? { need_project: true, suggested_project: L.suggested_project } : {}), hint: L.hint });

export function which(root, branch) {
  const L = layout(root);
  if (!L.ok) return notReady(L);
  const r = find(root, branch, L);
  const where = L.mode === 'repo' ? { mode: 'repo', repo: L.repo_rel, project: L.project } : { mode: 'project', project: L.project };
  if (r) return { bound: true, ...where, branch, name: r.name, dir: r.dir, meta: r.meta };
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
  return { ok: true, mode: L.mode, created: !existedHere, joined: !!target && !existedHere, name: meta.name, named_by: meta.named_by, dir: rel, project: L.project, branches: meta.branches };
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
