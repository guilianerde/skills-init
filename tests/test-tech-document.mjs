import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BRANCH, flowFixture } from './helpers/run-flow.mjs';
import { parseBranch, headerDate } from '../workflow/lib/artifact-model.mjs';
import { diffRange } from '../workflow/scripts/lint-doc.mjs';
import { branchView } from '../workflow/scripts/artifacts.mjs';
import { buildReport } from '../workflow/scripts/report.mjs';
import { loadWorkspace, readGitArtifacts } from '../workflow/lib/workspace-read.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const hidden = `<!-- workflow-run:
生成时间：2026-11-02T10:00:00+08:00
对比分支：\`${BRANCH}\` ←→ \`main\`
diff 概览：1 file changed
PRD 参考：无
模板来源：docnexus
-->`;
const body = '# 开发部分\n\n## 背景\n\n调整导出行为。\n\n## 数据链路\n\n数仓协助评估影响。\n\n``` title="数仓评审必填字段"\ndb_name：\ntable_name：\n是否需要评审：否\n```\n';

test('隐藏元信息与旧正文格式均能识别分支和日期，发布时间不干扰', () => {
  const text = `<!-- md-to-wiki: pageId=42 version=2 at=2026-11-03T01:00:00Z -->\n${hidden}\n${body}`;
  assert.equal(parseBranch(text), BRANCH);
  assert.equal(diffRange(text), `main...${BRANCH}`);
  assert.equal(headerDate(text), '2026-11-02');
  assert.equal(headerDate(text.replace(/\n/g, '\r\n')), '2026-11-02');
  assert.equal(headerDate('<!-- md-to-wiki: at=2026-11-03T01:00:00Z -->\n# 技术方案\n> 生成时间：2026-10-29'), '2026-10-29');
  assert.equal(headerDate('<!-- md-to-wiki: at=2026-11-03T01:00:00Z -->\n# 技术方案'), null);
});

test('技术方案无可见元信息时可自检、正式落盘、按分支查询及转换 Wiki，错误分支仍被拒绝', (t) => {
  const f = flowFixture(t);
  const put = (rel, text) => {
    const file = path.join(f.root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
  };
  put('.docnexus/project.json', JSON.stringify({ format_version: 7, output_dir: 'workflow-run' }));
  put(`.docnexus/node_modules/.bin/${process.platform === 'win32' ? 'docnexus.cmd' : 'docnexus'}`, '');
  put('workflow-run/docnexus/library/templates/create-tech-md-doc/template.md', '# 开发部分\n## 背景 *\n## 数据链路 *\n');
  const draft = put('workflow-run/tmp/tech-doc.md', `${hidden}\n\n${body}`);
  const cli = (script, ...args) => spawnSync(process.execPath, [path.join(REPO, script), ...args], { cwd: f.root, encoding: 'utf8' });
  let r = cli('workflow/scripts/lint-doc.mjs', draft, '--skill', 'create-tech-md-doc', '--facts', '--diff', `main...${BRANCH}`, '--json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const lint = JSON.parse(r.stdout);
  assert.deepEqual(lint.errors, []);
  assert.deepEqual(lint.warnings, []);
  assert.equal(lint.facts.range, `main...${BRANCH}`);
  let run = f.start(BRANCH, 'tech');
  run = f.save(run, { stage: 'T4', steps: Object.fromEntries(['T0', 'T1', 'T2', 'T3'].map((s) => [s, { status: 'completed' }])) });
  const publish = () => cli('workflow/scripts/artifact.mjs', 'finalize', '--id', run.id, '--expect-revision', String(run.revision), '--kind', 'tech', '--draft', draft, '--branch', BRANCH);
  fs.writeFileSync(draft, `${hidden.replace(BRANCH, 'feature/other')}\n\n${body}`);
  r = publish();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /分支必须与运行分支一致/);
  fs.writeFileSync(draft, `${hidden}\n\n${body}`);
  r = publish();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const published = JSON.parse(r.stdout);
  run = f.save(published.run, { steps: { T4: { status: 'completed' } } }, 'complete');
  assert.equal(run.status, 'completed');
  const workspace = loadWorkspace(f.root);
  assert.deepEqual(workspace.diagnostics, []);
  assert.equal(branchView(f.root, BRANCH, workspace).latest.tech.path, published.path);
  assert.equal(workspace.artifacts[0].date, '2026-11-02');
  assert.deepEqual(buildReport(f.root, { workspace }).without_branch, []);
  const meta = JSON.parse(fs.readFileSync(f.file));
  assert.equal(meta.artifacts[0].branch, BRANCH);
  assert.equal(meta.artifacts[0].date, '2026-11-02');
  f.git('add', published.path, path.relative(f.root, f.file));
  f.git('commit', '-m', 'technical document');
  const gitArtifacts = readGitArtifacts(f.root, BRANCH);
  assert.equal(gitArtifacts[0].branch, BRANCH);
  assert.equal(gitArtifacts[0].date, '2026-11-02');
  const html = path.join(f.root, 'workflow-run/tmp/tech-doc.html');
  r = cli('md-to-wiki/scripts/md-to-wiki.mjs', published.path, html);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const output = fs.readFileSync(html, 'utf8');
  assert.doesNotMatch(output, /workflow-run:|生成时间|对比分支|diff 概览|PRD 参考|模板来源|ac:name="info"/);
  assert.match(output, /^<h1>开发部分<\/h1>/);
  assert.match(output, /数仓协助评估影响/);
  assert.match(output, /<ac:parameter ac:name="title">数仓评审必填字段<\/ac:parameter>/);
});
