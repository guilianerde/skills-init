// 单次命令的只读内存快照。工作区与 Git 使用相同解析器，消费者不再重读正文。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { layout, REQ_DIR } from './project.mjs';
import { readRequirementDirectories } from './requirement-read.mjs';
import { FILES, LABELS, parseFile, parseBranch, parseWiki, parseDocnexus, headerDate, captureState, citesKnowledge, parseReview, parseDelivery } from './artifact-model.mjs';

const relative = (root, file) => path.relative(root, file).split(path.sep).join('/');
const git = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
export function localBranches(root) {
  const r = git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
  return r.status === 0 ? r.stdout.split('\n').filter(Boolean) : [];
}

function artifact(file, text, versions = {}, extra = {}) {
  const parts = file.split('/');
  if ((parts.length !== 5 && parts.length !== 6) || parts.slice(0, 3).join('/') !== REQ_DIR) return null;
  const parsed = parseFile(parts.at(-1));
  if (!parsed) return null;
  const { kind } = parsed;
  const version = parts.at(-1) === `${FILES[kind]}.md` ? versions?.[kind] ?? 1 : parsed.version;
  return { kind, label: LABELS[kind], path: file, requirement: parts[3], project: parts.length === 6 ? parts[4] : null,
    version, branch: parseBranch(text), date: headerDate(text), wiki: parseWiki(text), text,
    knowledge: parseDocnexus(text) ?? [], capture: captureState(text), citesKnowledge: citesKnowledge(text),
    ...(kind === 'review' ? { review: parseReview(text) } : {}), ...(kind === 'delivery' ? { delivery: parseDelivery(text) } : {}), ...extra };
}

export const byArtifactDate = (a, b) => `${a.date ?? ''}#${String(a.version).padStart(3, '0')}`.localeCompare(`${b.date ?? ''}#${String(b.version).padStart(3, '0')}`) || a.mtime - b.mtime;

// CLI 原有产物条目格式；统一模型内部另有正文与解析结果，避免改变正常命令的输出。
export function artifactEntry(a) {
  const common = { kind: a.kind, label: a.label, path: a.path, ...(a.cite ? { cite: a.cite } : {}), requirement: a.requirement, project: a.project,
    ...(a.source === 'worktree' ? { version: a.version } : {}), branch: a.branch, date: `${a.date ?? ''}#${String(a.version).padStart(3, '0')}`, mtime: a.mtime, wiki: a.wiki };
  return a.source === 'git' ? { ...common, ref: a.ref, text: a.text } : common;
}

export function readGitArtifacts(root, ref, diagnostics = []) {
  const head = git(root, ['rev-parse', '--verify', `${ref}^{commit}`]);
  if (head.status !== 0) return [];
  const commit = head.stdout.trim();
  const ls = git(root, ['-c', 'core.quotePath=false', 'ls-tree', '-r', '--name-only', commit, '--', REQ_DIR]);
  if (ls.status !== 0) return [];
  const metas = new Map(); const out = [];
  for (const file of ls.stdout.split('\n').filter(Boolean)) {
    if (!parseFile(path.posix.basename(file))) continue;
    const show = git(root, ['show', `${commit}:${file}`]);
    if (show.status !== 0) continue;
    const metaPath = `${path.posix.dirname(file)}/meta.json`;
    if (!metas.has(metaPath)) {
      const result = git(root, ['show', `${commit}:${metaPath}`]);
      let meta = {};
      if (result.status === 0) {
        try {
          meta = JSON.parse(result.stdout);
          if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('元信息必须为对象');
        } catch (e) { diagnostics.push({ code: 'invalid_meta', path: metaPath, ref, message: e.message }); meta = {}; }
      }
      metas.set(metaPath, meta);
    }
    const a = artifact(file, show.stdout, metas.get(metaPath).versions, { mtime: 0, source: 'git', ref, commit });
    if (a) out.push(a);
  }
  return out.sort(byArtifactDate);
}

export function loadWorkspace(root, { allProjects = false, allBranches = false } = {}) {
  root = path.resolve(root);
  const L = layout(root); const diagnostics = [];
  const requirements = readRequirementDirectories(root, L, { allProjects, diagnostics });
  const artifacts = []; const runs = [];
  for (const req of requirements) {
    const found = new Set();
    const index = Array.isArray(req.meta.artifacts) ? req.meta.artifacts.filter((item) => item && typeof item.file === 'string') : [];
    if (req.meta.artifacts !== undefined && (!Array.isArray(req.meta.artifacts) || index.length !== req.meta.artifacts.length)) {
      diagnostics.push({ code: 'invalid_index', path: `${req.dir}/meta.json`, message: '产物索引结构无效，请显式 sync；运行状态保留' });
    }
    for (const entry of fs.readdirSync(req.abs, { withFileTypes: true })) {
      if (!entry.isFile() || !parseFile(entry.name)) continue;
      const abs = path.join(req.abs, entry.name); const file = relative(root, abs);
      try {
        const a = artifact(file, fs.readFileSync(abs, 'utf8'), req.meta.versions, { mtime: fs.statSync(abs).mtimeMs, source: 'worktree', cite: L.ref(abs) });
        found.add(entry.name);
        artifacts.push(a);
        const indexed = index.find((i) => i.file === entry.name);
        if ((Array.isArray(req.meta.artifacts) && !indexed) || (indexed && (indexed.branch !== a.branch || indexed.date !== a.date
          || JSON.stringify(indexed.wiki) !== JSON.stringify(a.wiki) || indexed.version !== a.version
          || JSON.stringify(indexed.docnexus ?? []) !== JSON.stringify(a.knowledge)))) {
          diagnostics.push({ code: 'stale_index', path: file, message: '文档与已登记索引不一致，请显式 sync' });
        }
      } catch (e) {
        diagnostics.push({ code: 'unreadable_artifact', path: file, message: e.message });
      }
    }
    for (const item of index) {
      if (!found.has(item.file)) diagnostics.push({ code: 'missing_artifact', path: `${req.dir}/${item.file}`, message: '索引引用的产物不存在' });
    }
    for (const [id, run] of Object.entries(req.meta.runs ?? {})) {
      if (!run || run.id !== id || typeof run.updated_at !== 'string' || typeof run.branch !== 'string' || !run.steps || typeof run.steps !== 'object' || Array.isArray(run.steps)
        || typeof run.kind !== 'string' || typeof run.stage !== 'string' || !Array.isArray(run.history)
        || Object.values(run.steps).some((step) => !step || !['pending', 'in_progress', 'completed', 'skipped'].includes(step.status))
        || !['running', 'waiting_user', 'blocked', 'completed', 'cancelled'].includes(run.status)) {
        diagnostics.push({ code: 'invalid_run', path: `${req.dir}/meta.json`, message: `运行 ${id} 结构无效，不能恢复` });
        continue;
      }
      runs.push({ ...run, requirement: req.name, dir: req.dir, project: req.project });
    }
  }
  artifacts.sort(byArtifactDate);
  const scanned = allBranches ? localBranches(root) : [];
  const seen = new Set(artifacts.map((a) => a.path));
  for (const ref of scanned) for (const a of readGitArtifacts(root, ref, diagnostics)) {
    if (!seen.has(a.path)) { seen.add(a.path); artifacts.push(a); }
  }
  runs.sort((a, b) => a.updated_at.localeCompare(b.updated_at));
  return { root, layout: L, requirements, artifacts, runs, diagnostics, scanned_branches: scanned };
}

// 展示可看全部项目；原有分支查询和效果报告默认只看当前项目。
export const projectArtifacts = (workspace, allProjects = false) => workspace.artifacts.filter((a) => allProjects || a.source === 'git' || a.project === workspace.layout.project);
