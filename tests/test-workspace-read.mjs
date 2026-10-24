// 统一读取模型：一致性、只读边界、跨项目与 Git 来源，以及安装后的依赖完整性。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadWorkspace, readGitArtifacts } from '../workflow/lib/workspace-read.mjs';
import { bind, sync, list } from '../workflow/lib/requirements.mjs';
import { startRun, runState } from '../workflow/lib/runs.mjs';
import { collect, branchView } from '../workflow/scripts/artifacts.mjs';
import { buildReport } from '../workflow/scripts/report.mjs';
import { viewData } from '../workflow/scripts/view.mjs';
import { buildDescription } from '../workflow/scripts/pr-desc.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const BRANCH = 'feature/export';
const doc = (kind, branch = BRANCH) => `# ${kind}\n\n> 类型：功能开发 ｜ 规模：M ｜ 日期：2026-10-24\n> 对比分支：\`${branch}\` ←→ \`main\`\n> DocNexus：无需沉淀\n\n## 结果 *\n\n完成导出。\n\n## 验证 *\n\n- 未验证项：无\n`;
function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-read-model-'));
  const root = path.join(temp, 'svc');
  fs.mkdirSync(root);
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const req = bind(root, { name: '订单导出', branch: BRANCH });
  const put = (file, text) => { const abs = path.join(root, file); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, text); return abs; };
  const meta = path.join(root, req.dir, 'meta.json');
  const git = (...args) => {
    const r = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  return { root, req, put, meta, git };
}

test('各查询复用同一次快照：每份正文和元信息只读一次，结果一致且不改运行或索引', (t) => {
  const f = fixture(t);
  const files = ['plan.md', 'review.md', 'delivery.md'].map((name) => f.put(`${f.req.dir}/${name}`, doc(name)));
  sync(f.root, f.req.dir);
  const run = startRun(f.root, { branch: BRANCH, kind: 'feature', size: 'M' }).run;
  const before = fs.readFileSync(f.meta, 'utf8');
  const mtime = fs.statSync(f.meta).mtimeMs;
  const reads = new Map([...files, f.meta].map((file) => [file, 0]));
  const read = fs.readFileSync;
  fs.readFileSync = function (file, ...args) {
    if (reads.has(file)) reads.set(file, reads.get(file) + 1);
    return read.call(this, file, ...args);
  };
  try {
    const workspace = loadWorkspace(f.root, { allProjects: true });
    const artifacts = collect(f.root, { workspace });
    const status = runState(f.root, BRANCH, workspace);
    const branch = branchView(f.root, BRANCH, workspace);
    const report = buildReport(f.root, { workspace });
    const view = viewData(f.root, workspace);
    const pr = buildDescription(f.root, BRANCH, 'main', workspace);
    assert.equal(workspace.diagnostics.length, 0);
    assert.equal(artifacts.length, 3);
    assert.equal(status.current.id, run.id);
    assert.equal(branch.execution.current.id, run.id);
    assert.equal(view.requirements[0].runs[0].id, run.id);
    assert.equal(report.artifacts, view.report.artifacts);
    assert.equal(pr.sources.review, branch.latest.review.path);
    assert.ok(pr.markdown.includes('完成导出'));
    for (const [file, count] of reads) assert.equal(count, 1, file);
  } finally { fs.readFileSync = read; }
  assert.equal(fs.readFileSync(f.meta, 'utf8'), before);
  assert.equal(fs.statSync(f.meta).mtimeMs, mtime);
});

test('list 纯读取；未同步正文能显示，sync 保留 runs、扩展字段和显式分支绑定', (t) => {
  const f = fixture(t);
  const run = startRun(f.root, { branch: BRANCH, kind: 'feature', size: 'M' }).run;
  const meta = JSON.parse(fs.readFileSync(f.meta));
  meta.extension = { keep: true };
  fs.writeFileSync(f.meta, JSON.stringify(meta));
  f.put(`${f.req.dir}/review.md`, doc('审查', 'feature/unbound'));
  const before = fs.readFileSync(f.meta, 'utf8');
  assert.equal(list(f.root)[0].artifacts, 1);
  assert.equal(fs.readFileSync(f.meta, 'utf8'), before);
  const result = sync(f.root, f.req.dir);
  assert.deepEqual(result.branches, [BRANCH]);
  assert.equal(result.artifacts[0].branch, 'feature/unbound');
  assert.deepEqual(result.runs[run.id], run);
  assert.deepEqual(result.extension, { keep: true });
  const original = JSON.stringify(result);
  sync(f.root, f.req.dir);
  assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(f.meta))), original);
});

test('损坏元信息隔离诊断；正文仍可展示，写入拒绝覆盖，缺失产物有明确提示', (t) => {
  const f = fixture(t);
  f.put(`${f.req.dir}/review.md`, doc('审查'));
  sync(f.root, f.req.dir);
  const meta = fs.readFileSync(f.meta, 'utf8');
  fs.writeFileSync(f.meta, '{broken');
  let workspace = loadWorkspace(f.root);
  assert.equal(workspace.artifacts.length, 1);
  assert.equal(workspace.runs.length, 0);
  assert.equal(workspace.diagnostics[0].code, 'invalid_meta');
  assert.equal(viewData(f.root, workspace).requirements[0].artifacts.length, 1);
  assert.equal(branchView(f.root, BRANCH, workspace).execution.current, null);
  assert.throws(() => sync(f.root, f.req.dir), /不是合法 JSON/);
  assert.equal(fs.readFileSync(f.meta, 'utf8'), '{broken');
  fs.writeFileSync(f.meta, meta);
  fs.rmSync(path.join(f.root, f.req.dir, 'review.md'));
  workspace = loadWorkspace(f.root);
  assert.equal(workspace.diagnostics[0].code, 'missing_artifact');
  assert.equal(workspace.artifacts.length, 0);
});

test('跨项目视图共享快照，效果报告仍默认当前项目；other、tmp 和知识输出不参与采集', (t) => {
  const f = fixture(t);
  f.put(`${f.req.dir}/delivery.md`, doc('交付'));
  const other = 'workflow-run/docs/requirements/订单导出/another-service';
  f.put(`${other}/review.md`, doc('审查'));
  f.put(`${other}/meta.json`, JSON.stringify({ name: '订单导出', branches: [BRANCH] }));
  for (const dir of ['other/讨论/svc', 'tmp/草稿/svc', 'docnexus/library/方案/svc']) f.put(`workflow-run/${dir}/review.md`, doc('非需求产物'));
  const workspace = loadWorkspace(f.root, { allProjects: true });
  assert.equal(workspace.artifacts.length, 2);
  const view = viewData(f.root, workspace);
  assert.equal(view.requirements.length, 1);
  assert.equal(view.requirements[0].projects.length, 2);
  assert.equal(view.report.artifacts, 1);
  assert.equal(buildReport(f.root, { workspace }).artifacts, 1);
  assert.equal(collect(f.root, { workspace }).length, 1);
  assert.equal(collect(f.root, { allProjects: true, workspace }).length, 2);
});

test('索引结构损坏不会吞掉正文或有效运行；读取提示异常，显式 sync 可修复索引', (t) => {
  const f = fixture(t);
  f.put(`${f.req.dir}/review.md`, doc('审查'));
  const run = startRun(f.root, { branch: BRANCH, kind: 'feature', size: 'M' }).run;
  sync(f.root, f.req.dir);
  const meta = JSON.parse(fs.readFileSync(f.meta));
  meta.artifacts = [null];
  fs.writeFileSync(f.meta, JSON.stringify(meta));
  const workspace = loadWorkspace(f.root);
  assert.ok(workspace.diagnostics.some((d) => d.code === 'invalid_index'));
  assert.equal(workspace.artifacts.length, 1);
  assert.equal(workspace.runs[0].id, run.id);
  const fixed = sync(f.root, f.req.dir);
  assert.equal(fixed.artifacts[0].file, 'review.md');
  assert.deepEqual(fixed.runs[run.id], run);
  assert.equal(loadWorkspace(f.root).diagnostics.length, 0);
});

test('Git 产物读取同一引用的版本；工作区同路径优先，缺失文件再从分支补入', (t) => {
  const f = fixture(t);
  const file = `${f.req.dir}/tech-doc.md`;
  f.put(file, doc('技术方案'));
  let meta = JSON.parse(fs.readFileSync(f.meta));
  meta.versions = { tech: 7 };
  fs.writeFileSync(f.meta, JSON.stringify(meta));
  sync(f.root, f.req.dir);
  f.git('init', '-q', '-b', BRANCH);
  f.git('add', '.');
  f.git('commit', '-qm', 'docs');
  meta = JSON.parse(fs.readFileSync(f.meta)); meta.versions.tech = 99;
  fs.writeFileSync(f.meta, JSON.stringify(meta));
  f.put(file, doc('工作区新版'));
  let workspace = loadWorkspace(f.root, { allBranches: true });
  assert.equal(workspace.artifacts.length, 1);
  assert.equal(workspace.artifacts[0].version, 99);
  assert.equal(workspace.artifacts[0].source, 'worktree');
  assert.equal(readGitArtifacts(f.root, BRANCH)[0].version, 7);
  fs.rmSync(path.join(f.root, file));
  workspace = loadWorkspace(f.root, { allBranches: true });
  assert.equal(workspace.artifacts[0].version, 7);
  assert.equal(workspace.artifacts[0].source, 'git');
  assert.equal(workspace.artifacts[0].ref, BRANCH);
});

test('共享核心依赖方向：不反向依赖命令脚本，纯模型不依赖 I/O，库内导入无环', () => {
  const lib = path.join(REPO, 'workflow/lib');
  const graph = new Map();
  for (const file of fs.readdirSync(lib).filter((f) => f.endsWith('.mjs'))) {
    const text = fs.readFileSync(path.join(lib, file), 'utf8');
    const imports = [...text.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    assert.ok(!imports.some((p) => p.includes('/scripts/') || p.includes('/bin/')), file);
    if (['document-model.mjs', 'artifact-model.mjs'].includes(file)) assert.ok(!imports.some((p) => p.startsWith('node:')), file);
    graph.set(file, imports.filter((p) => p.startsWith('./')).map((p) => p.slice(2)));
  }
  const visit = (file, stack = []) => {
    assert.ok(!stack.includes(file), [...stack, file].join(' -> '));
    for (const next of graph.get(file) ?? []) visit(next, [...stack, file]);
  };
  for (const file of graph.keys()) visit(file);
});
