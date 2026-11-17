import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  createWorkflow,
  WORKFLOW_ERROR_CODES,
  WorkflowError,
} from '../workflow/core/index.mjs';
import { finalizeArtifact } from '../workflow/lib/artifact-finalize.mjs';
import { artifactsConfig, readProfile, setConfig } from '../workflow/lib/project.mjs';
import { templateParts } from '../workflow/lib/template-parts.mjs';
import { createSkillDocumentPolicy } from '../workflow/integrations/skill-document-policy.mjs';
import { useLocalDocNexus } from './helpers/docnexus-pkg.mjs';
import { BRANCH, flowFixture } from './helpers/run-flow.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const branch = 'feature/core';
useLocalDocNexus();

function tempProject(t, name = 'svc') {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-core-'));
  const root = path.join(parent, name);
  fs.mkdirSync(root);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  git('switch', '-q', '-c', branch);
  return { root, git };
}

function put(root, rel, value) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
}

function installConfig(root, value) {
  put(root, '.agents/skills/workflow/profile.json', value);
}

function runScript(root, inputDir, args, input) {
  const inputFile = path.join(inputDir, `checkpoint-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(inputFile, `${JSON.stringify(input, null, 2)}\n`);
  const result = spawnSync(
    process.execPath,
    [path.join(REPO, 'workflow/scripts/run.mjs'), ...args, '--root', root, '--branch', BRANCH, '--input', inputFile],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function invokeScript(root, script, args, input = null, expectedStatus = 0) {
  const extra = [];
  if (input !== null) {
    const inputFile = path.join(root, 'workflow-run/tmp', `checkpoint-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    fs.mkdirSync(path.dirname(inputFile), { recursive: true });
    fs.writeFileSync(inputFile, `${JSON.stringify(input, null, 2)}\n`);
    extra.push('--input', inputFile);
  }
  const result = spawnSync(process.execPath, [
    script,
    ...args,
    '--root', root,
    '--branch', BRANCH,
    ...extra,
  ], { encoding: 'utf8' });
  assert.equal(result.status, expectedStatus, result.stdout + result.stderr);
  return result;
}

function fillTemplate(repoRelative, values = {}) {
  const source = fs.readFileSync(path.join(REPO, repoRelative), 'utf8');
  return templateParts(source).content.replace(/\{\{([\s\S]*?)\}\}/g, (_, rawKey) => {
    const key = rawKey.trim();
    if (Object.hasOwn(values, key)) return values[key];
    if (key === 'S / M / L') return 'S';
    if (key === 'YYYY-MM-DD') return '2026-11-17';
    if (/^(?:dev分支|当前分支)$/.test(key)) return BRANCH;
    if (/^(?:基线分支|主分支)$/.test(key)) return 'main';
    if (/需求来源/.test(key)) return '自动化集成测试';
    if (/需求文档/.test(key)) return 'requirement.md（v1）';
    if (/审查方式/.test(key)) return '标准，全量精读，独立复核';
    if (/审查者/.test(key)) return '独立测试审查者';
    if (/DocNexus/.test(key)) return '未询问（由 dev 交付统一处理）';
    if (/级别|文件:行号|触发条件|修改建议|✅/.test(key)) return '无';
    if (/类型/.test(key)) return '功能开发';
    if (/规模/.test(key)) return 'S';
    if (/范围/.test(key)) return '门面集成';
    return '无';
  }).replace(/<在此填写[^>]*>/g, '无');
}

const expectCode = (code, fn) => assert.throws(fn, (error) => {
  assert.ok(error instanceof WorkflowError);
  assert.equal(error.code, code);
  return true;
});

function interruptFinalization(f, run, kind, input) {
  const rename = fs.renameSync;
  let commits = 0;
  fs.renameSync = (from, to) => {
    if (to === f.file && ++commits === 2) throw new Error('模拟 pending 中断');
    return rename(from, to);
  };
  try {
    assert.throws(() => f.finalize(run, kind, input), /模拟 pending 中断/);
  } finally {
    fs.renameSync = rename;
  }
  return JSON.parse(fs.readFileSync(f.file, 'utf8')).pending_finalization;
}

test('createWorkflow 要求绝对 root，构造本身不创建目录', (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-core-root-'));
  const root = path.join(parent, 'missing');
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));

  expectCode(WORKFLOW_ERROR_CODES.PROJECT_ROOT_INVALID, () => createWorkflow({ root: 'relative' }));
  const workflow = createWorkflow({ root });
  assert.equal(workflow.root, root);
  assert.equal(fs.existsSync(root), false);
});

test('项目配置绑定目标 root，并在多个非规范安装位置之间报告歧义', (t) => {
  const a = tempProject(t, 'a');
  const b = tempProject(t, 'b');
  installConfig(a.root, {
    main_branch: 'integration',
    artifacts: { project: 'service-a' },
    marker: 'A',
  });
  installConfig(b.root, {
    main_branch: 'develop',
    artifacts: { project: 'service-b' },
    marker: 'B',
  });

  assert.equal(readProfile(a.root).profile.marker, 'A');
  assert.equal(readProfile(b.root).profile.marker, 'B');
  assert.equal(artifactsConfig(a.root).project, 'service-a');
  assert.equal(artifactsConfig(b.root).project, 'service-b');

  setConfig(a.root, { project: 'service-a-next' });
  assert.equal(artifactsConfig(a.root).project, 'service-a-next');
  assert.equal(artifactsConfig(b.root).project, 'service-b');
  assert.equal(readProfile(b.root).profile.marker, 'B');

  const ambiguous = tempProject(t, 'ambiguous');
  put(ambiguous.root, '.claude/skills/workflow/profile.json', {
    artifacts: { project: 'claude' },
  });
  put(ambiguous.root, '.qwen/skills/workflow/profile.json', {
    artifacts: { project: 'qwen' },
  });
  assert.throws(() => artifactsConfig(ambiguous.root), (error) => {
    assert.equal(error.code, 'PROJECT_CONFIG_AMBIGUOUS');
    assert.deepEqual(error.details.paths.sort(), [
      '.claude/skills/workflow',
      '.qwen/skills/workflow',
    ]);
    return true;
  });

  put(ambiguous.root, '.agents/skills/workflow/profile.json', {
    artifacts: { project: 'canonical' },
  });
  assert.equal(artifactsConfig(ambiguous.root).project, 'canonical');
});

test('公共核心提供服务与脚本共用 run 的薄门面', (t) => {
  const project = tempProject(t);
  installConfig(project.root, {
    main_branch: 'main',
    artifacts: { project: 'svc' },
  });
  const workflow = createWorkflow({ root: project.root });

  assert.equal(workflow.requirements.which({ branch }).bound, false);
  const binding = workflow.requirements.bind({ name: '核心门面', branch, base: 'main' });
  assert.equal(binding.ok, true);
  const metaFile = path.join(project.root, binding.dir, 'meta.json');
  const beforeWhich = fs.readFileSync(metaFile, 'utf8');
  assert.equal(workflow.requirements.which({ branch }).name, '核心门面');
  assert.equal(fs.readFileSync(metaFile, 'utf8'), beforeWhich, 'which 不得刷新或改写元信息');
  assert.equal(workflow.maintenance.reindex({ branch }).artifacts, 0);

  const started = workflow.runs.start({
    branch,
    kind: 'feature',
    size: 'M',
    input: { context: { summary: '门面测试' } },
  });
  assert.equal(started.run.branch, branch);
  assert.equal(started.run.revision, 1);

  const saved = workflow.runs.save({
    branch,
    id: started.run.id,
    expectedRevision: started.run.revision,
    input: { context: { decisions: ['共用核心'] } },
  });
  assert.equal(saved.run.revision, 2);
  assert.deepEqual(saved.run.context.decisions, ['共用核心']);

  expectCode(WORKFLOW_ERROR_CODES.REVISION_CONFLICT, () => workflow.runs.save({
    branch,
    id: started.run.id,
    expectedRevision: 1,
    input: { context: { summary: '旧 revision' } },
  }));

  const got = workflow.runs.get({ branch, id: started.run.id });
  assert.equal(got.run.revision, 2);
  assert.equal(workflow.runs.status({ branch }).current.id, started.run.id);
  assert.equal(workflow.snapshots.capture({ branch, id: started.run.id }).snapshot.head, project.git('rev-parse', 'HEAD'));

  const cancelled = workflow.runs.cancel({
    branch,
    id: started.run.id,
    expectedRevision: got.run.revision,
    reason: '测试结束',
  });
  assert.equal(cancelled.run.status, 'cancelled');

  const script = spawnSync(
    process.execPath,
    [path.join(REPO, 'workflow/scripts/run.mjs'), 'show', '--root', project.root, '--branch', branch],
    { encoding: 'utf8' },
  );
  assert.equal(script.status, 0, script.stderr);
  assert.equal(JSON.parse(script.stdout).current.id, started.run.id);

  const example = spawnSync(
    process.execPath,
    [path.join(REPO, 'examples/workflow-core.mjs'), '--root', project.root, '--branch', branch],
    { encoding: 'utf8' },
  );
  assert.equal(example.status, 0, example.stderr);
  assert.equal(JSON.parse(example.stdout).run.current.id, started.run.id);
});

test('正式产物通过核心 finalize，缺少 policy 时明确拒绝', (t) => {
  const f = flowFixture(t);
  const run = f.start(BRANCH, 'feature', 'S');
  const noPolicy = createWorkflow({ root: f.root });
  expectCode(WORKFLOW_ERROR_CODES.INVALID_ARGUMENT, () => noPolicy.artifacts.finalize({
    branch: BRANCH,
    id: run.id,
    expectedRevision: run.revision,
    kind: 'requirement',
    text: f.text('requirement.md'),
    input: { steps: { F3: { status: 'completed' } } },
  }));

  const workflow = createWorkflow({
    root: f.root,
    documentPolicy: { validate: () => ({ ok: true, errors: [], warnings: [] }) },
  });
  const checkpoint = {
    steps: { F3: { status: 'completed' } },
    context: { alpha: 1, beta: 2 },
  };
  const finalized = workflow.artifacts.finalize({
    branch: BRANCH,
    id: run.id,
    expectedRevision: run.revision,
    kind: 'requirement',
    text: f.text('requirement.md'),
    input: checkpoint,
  });
  assert.equal(finalized.run.artifacts.requirement.version, 1);
  assert.equal(finalized.alreadyFinalized, false);
  const replay = workflow.artifacts.finalize({
    branch: BRANCH,
    id: run.id,
    expectedRevision: run.revision,
    kind: 'requirement',
    text: f.text('requirement.md'),
    input: {
      context: { beta: 2, alpha: 1 },
      steps: { F3: { status: 'completed' } },
    },
  });
  assert.equal(replay.alreadyFinalized, true);
  assert.equal(replay.run.revision, finalized.run.revision);
});

test('resume 以 STATUS.runRevision、operationId 和内部 baseRevision 核对 pending', (t) => {
  const f = flowFixture(t);
  const run = f.start();
  const pending = interruptFinalization(f, run, 'requirement', { steps: { F3: { status: 'completed' } } });
  const workflow = createWorkflow({ root: f.root });
  const state = workflow.runs.status({ branch: BRANCH, id: run.id });

  assert.equal(state.current.revision, run.revision, 'current 保留已提交运行快照');
  assert.equal(state.runRevision, run.revision + 1, 'status.runRevision 是 pending 操作的目标 revision');
  assert.deepEqual(state.pending, {
    operationId: pending.id,
    runId: run.id,
    kind: 'requirement',
    baseRevision: run.revision,
    runRevision: run.revision + 1,
    id: pending.id,
  });

  const request = {
    branch: BRANCH,
    id: run.id,
    expectedRevision: state.runRevision,
    operationId: state.pending.operationId,
  };
  expectCode(WORKFLOW_ERROR_CODES.REVISION_CONFLICT, () => workflow.artifacts.resume({
    ...request,
    expectedRevision: state.pending.baseRevision,
  }));
  expectCode(WORKFLOW_ERROR_CODES.PENDING_OPERATION_MISMATCH, () => workflow.artifacts.resume({
    ...request,
    operationId: 'stale-operation',
  }));

  const resumed = workflow.artifacts.resume(request);
  assert.equal(resumed.operationId, pending.id);
  assert.equal(resumed.baseRevision, run.revision);
  assert.equal(resumed.run.revision, state.runRevision);
  assert.equal(workflow.runs.status({ branch: BRANCH, id: run.id }).pending, undefined);
  expectCode(WORKFLOW_ERROR_CODES.PENDING_OPERATION_MISMATCH, () => workflow.artifacts.resume(request));
});

test('abort 后新 pending 不复用旧 operationId，旧请求不能误处理新事务', (t) => {
  const f = flowFixture(t);
  const run = f.start();
  const first = interruptFinalization(f, run, 'requirement', { steps: { F3: { status: 'completed' } } });
  const workflow = createWorkflow({ root: f.root });
  const firstState = workflow.runs.status({ branch: BRANCH, id: run.id });
  const aborted = workflow.artifacts.abort({
    branch: BRANCH,
    id: run.id,
    expectedRevision: firstState.runRevision,
    operationId: firstState.pending.operationId,
  });
  assert.equal(aborted.aborted, true);
  assert.equal(aborted.operationId, first.id);
  assert.equal(workflow.runs.status({ branch: BRANCH, id: run.id }).runRevision, run.revision);

  const second = interruptFinalization(f, run, 'requirement', { steps: { F3: { status: 'completed' } } });
  const secondState = workflow.runs.status({ branch: BRANCH, id: run.id });
  assert.notEqual(second.id, first.id);
  expectCode(WORKFLOW_ERROR_CODES.PENDING_OPERATION_MISMATCH, () => workflow.artifacts.abort({
    branch: BRANCH,
    id: run.id,
    expectedRevision: secondState.runRevision,
    operationId: first.id,
  }));
  assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).pending_finalization.id, second.id);
  const cli = spawnSync(process.execPath, [
    path.join(REPO, 'workflow/scripts/artifact.mjs'),
    'abort',
    '--root', f.root,
    '--branch', BRANCH,
    '--id', run.id,
  ], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).operationId, second.id);
});

test('Skills 入口不再导出可绕过核心的写操作或 run 命令', async () => {
  const requirements = await import('../workflow/scripts/requirement.mjs');
  const run = await import('../workflow/scripts/run.mjs');
  for (const name of ['path', 'nextPath', 'sync', 'bind', 'which', 'reindex', 'reindexRequirement']) assert.equal(requirements[name], undefined, name);
  for (const name of ['startRun', 'changeRun', 'runState']) assert.equal(run[name], undefined, name);
});

test('Skills 脚本不得导入或重新导出生命周期写入函数', () => {
  const lifecycle = new Set(['bind', 'reindex', 'reindexRequirement']);
  const violations = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(file); continue; }
      if (!entry.name.endsWith('.mjs')) continue;
      const text = fs.readFileSync(file, 'utf8');
      for (const match of text.matchAll(/(?:import|export)\s+\{([\s\S]*?)\}\s+from\s+['"]([^'"]*requirements\.mjs)['"]/g)) {
        const names = match[1].split(',').map((name) => name.trim().split(/\s+as\s+/)[0]).filter(Boolean);
        for (const name of names) {
          if (lifecycle.has(name)) violations.push(`${path.relative(REPO, file)}: ${name}`);
        }
      }
    }
  };
  walk(path.join(REPO, 'workflow/scripts'));
  assert.deepEqual(violations, [], '生命周期写入只能由 workflow/core/index.mjs 门面提供');
});

test('内部 API 与 run CLI 交替推进同一个 feature 运行（空策略单测）', (t) => {
  const f = flowFixture(t);
  const tmp = path.join(f.root, 'workflow-run/tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const workflow = createWorkflow({
    root: f.root,
    documentPolicy: { validate: () => ({ ok: true, errors: [], warnings: [] }) },
  });
  let run = workflow.runs.start({
    branch: BRANCH,
    kind: 'feature',
    size: 'M',
    input: {
      stage: 'F3',
      steps: Object.fromEntries(['Step0', 'F1', 'F2'].map((step) => [step, { status: 'completed' }])),
      context: { summary: '双入口', decisions: ['共用核心'], acceptance: ['流程完成'] },
    },
  }).run;

  const requirementText = f.text('requirement.md');
  const requirementReview = f.reviewDraft(run, 'requirement', requirementText);
  run = workflow.artifacts.finalize({
    branch: BRANCH,
    id: run.id,
    expectedRevision: run.revision,
    kind: 'requirement',
    text: requirementText,
    input: { steps: { F3: { status: 'completed' } } },
    ...requirementReview,
  }).run;

  run = runScript(f.root, tmp, ['save', '--id', run.id, '--expect-revision', String(run.revision)], {
    stage: 'F4',
  }).run;
  const planText = f.text('plan.md');
  const planReview = f.reviewDraft(run, 'plan', planText);
  run = workflow.artifacts.finalize({
    branch: BRANCH,
    id: run.id,
    expectedRevision: run.revision,
    kind: 'plan',
    text: planText,
    input: { steps: { F4: { status: 'completed' } } },
    ...planReview,
  }).run;

  run = runScript(f.root, tmp, ['save', '--id', run.id, '--expect-revision', String(run.revision)], {
    stage: 'F5',
    approval: { confirmed: true },
  }).run;
  fs.writeFileSync(path.join(f.root, 'app.js'), 'export const value = 2;\n');
  run = runScript(f.root, tmp, ['save', '--id', run.id, '--expect-revision', String(run.revision)], {
    steps: { F5: { status: 'completed' } },
    stage: 'F6',
  }).run;
  const snapshot = workflow.snapshots.capture({ branch: BRANCH, id: run.id }).snapshot;
  run = runScript(f.root, tmp, ['save', '--id', run.id, '--expect-revision', String(run.revision)], {
    validation: {
      snapshot,
      checks: [{ command: 'node --check app.js', result: 'passed' }],
    },
    steps: { F6: { status: 'completed' } },
  }).run;
  run = runScript(f.root, tmp, ['save', '--id', run.id, '--expect-revision', String(run.revision)], {
    stage: 'F7',
  }).run;

  const prepared = workflow.reviews.prepare({ branch: BRANCH, id: run.id, depth: '标准' });
  const packet = prepared.packet;
  const reviewResult = {
    run_id: packet.run_id,
    code: packet.snapshot.digest,
    inputs: packet.inputs,
    findings: [],
    coverage: {
      reviewed: packet.scope.review.map((file) => file.path),
      uncovered: [],
    },
  };
  run = workflow.artifacts.finalize({
    branch: BRANCH,
    id: run.id,
    expectedRevision: run.revision,
    kind: 'review',
    text: f.text('review.md'),
    input: { steps: { F7: { status: 'completed' } } },
    packet,
    result: reviewResult,
  }).run;
  run = runScript(f.root, tmp, ['save', '--id', run.id, '--expect-revision', String(run.revision)], {
    stage: 'F8',
    decision: { action: 'deliver', confirmed: true },
  }).run;
  run = workflow.artifacts.finalize({
    branch: BRANCH,
    id: run.id,
    expectedRevision: run.revision,
    kind: 'delivery',
    text: f.text('delivery.md'),
    input: { steps: { F8: { status: 'completed' } } },
  }).run;
  run = runScript(f.root, tmp, ['complete', '--id', run.id, '--expect-revision', String(run.revision)], {}).run;

  assert.equal(run.status, 'completed');
  assert.equal(workflow.runs.get({ branch: BRANCH, id: run.id }).run.status, 'completed');
});

test('安装后的 artifact / run Skills 通过真实模板策略推进同一完整 feature 运行', (t) => {
  const f = flowFixture(t);
  const install = spawnSync(process.execPath, [
    path.join(REPO, 'bin/workflow-run.mjs'),
    '--project-root', f.root,
    '--envs', 'codex',
    '--skills', 'dev',
    '--skip-db',
    '--yes',
  ], { encoding: 'utf8', env: { ...process.env, WORKFLOW_RUN_ADMIN: '1' } });
  assert.equal(install.status, 0, install.stdout + install.stderr);

  const scripts = path.join(f.root, '.agents/skills/workflow/scripts');
  const runScriptPath = path.join(scripts, 'run.mjs');
  const artifactScript = path.join(scripts, 'artifact.mjs');
  const handoffScript = path.join(scripts, 'review-handoff.mjs');
  const skillRun = (args, input = null, expectedStatus = 0) =>
    invokeScript(f.root, runScriptPath, args, input, expectedStatus);
  const artifact = (args, input = null, expectedStatus = 0) =>
    invokeScript(f.root, artifactScript, args, input, expectedStatus);
  const writeDraft = (name, repoRelative, values) => {
    const file = path.join(f.root, 'workflow-run/tmp', name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, fillTemplate(repoRelative, values));
    return file;
  };
  const nextRun = (result) => JSON.parse(result.stdout).run;

  let run = nextRun(skillRun([
    'start', '--kind', 'feature', '--size', 'S',
  ], {
    stage: 'F3',
    steps: Object.fromEntries(['Step0', 'F1', 'F2'].map((step) => [step, { status: 'completed' }])),
    context: { summary: '真实 Skills 双入口', decisions: ['复用核心门面'], acceptance: ['完整流程完成'] },
  }));
  const workflow = createWorkflow({ root: f.root });
  assert.equal(workflow.runs.get({ branch: BRANCH, id: run.id }).run.revision, run.revision);

  const requirementDraft = writeDraft('real-requirement.md', 'dev/references/requirement-template.md');
  const requirementArgs = [
    'finalize', '--id', run.id, '--expect-revision', String(run.revision),
    '--kind', 'requirement', '--draft', requirementDraft,
  ];
  const requirementInput = { steps: { F3: { status: 'completed' } } };
  const requirementResult = JSON.parse(artifact(requirementArgs, requirementInput).stdout);
  run = requirementResult.run;
  assert.equal(requirementResult.version, 1);
  const replay = JSON.parse(artifact(requirementArgs, requirementInput).stdout);
  assert.equal(replay.alreadyFinalized, true, '相同 Skills 请求必须命中成功重放');
  assert.equal(replay.run.revision, run.revision);

  run = nextRun(skillRun([
    'save', '--id', run.id, '--expect-revision', String(run.revision),
  ], { stage: 'F4' }));
  const badPlan = writeDraft('bad-plan.md', 'dev/references/plan-template.md');
  fs.appendFileSync(badPlan, '\n{{未填写}}\n');
  const bad = artifact([
    'finalize', '--id', run.id, '--expect-revision', String(run.revision),
    '--kind', 'plan', '--draft', badPlan,
  ], null, 1);
  assert.match(bad.stderr, /草稿自检失败/);
  assert.equal(fs.existsSync(path.join(f.root, f.req.dir, 'plan.md')), false);

  const planDraft = writeDraft('real-plan.md', 'dev/references/plan-template.md');
  const planInput = { steps: { F4: { status: 'completed' } } };
  const planPolicy = createSkillDocumentPolicy(f.root);
  const rename = fs.renameSync;
  let commits = 0;
  fs.renameSync = (from, to) => {
    if (to === f.file && ++commits === 2) throw new Error('模拟真实策略 pending 中断');
    return rename(from, to);
  };
  try {
    assert.throws(() => finalizeArtifact(f.root, {
      branch: BRANCH,
      id: run.id,
      revision: run.revision,
      kind: 'plan',
      text: fs.readFileSync(planDraft, 'utf8'),
      input: planInput,
    }, (candidate) => planPolicy.validate({ kind: 'plan', text: candidate })), /模拟真实策略 pending 中断/);
  } finally {
    fs.renameSync = rename;
  }
  const pendingState = workflow.runs.status({ branch: BRANCH, id: run.id });
  assert.ok(pendingState.pending);
  const resumed = JSON.parse(artifact([
    'resume', '--id', run.id,
  ]).stdout);
  assert.equal(resumed.operationId, pendingState.pending.operationId);
  run = resumed.run;

  run = nextRun(skillRun([
    'save', '--id', run.id, '--expect-revision', String(run.revision),
  ], { stage: 'F5' }));
  fs.writeFileSync(path.join(f.root, 'app.js'), 'export const value = 2;\n');
  run = nextRun(skillRun([
    'save', '--id', run.id, '--expect-revision', String(run.revision),
  ], { stage: 'F6', steps: { F5: { status: 'completed' } } }));
  const snapshot = JSON.parse(skillRun([
    'snapshot', '--id', run.id,
  ]).stdout).snapshot;
  run = nextRun(skillRun([
    'save', '--id', run.id, '--expect-revision', String(run.revision),
  ], {
    validation: { snapshot, checks: [{ command: 'node --check app.js', result: 'passed' }] },
    steps: { F6: { status: 'completed' } },
  }));
  run = nextRun(skillRun([
    'save', '--id', run.id, '--expect-revision', String(run.revision),
  ], { stage: 'F7' }));

  const prepared = JSON.parse(invokeScript(f.root, handoffScript, [
    '--id', run.id, '--depth', '标准',
  ]).stdout);
  const resultFile = path.join(f.root, 'workflow-run/tmp/real-review-result.json');
  const reviewResult = {
    run_id: prepared.packet.run_id,
    code: prepared.packet.snapshot.digest,
    inputs: prepared.packet.inputs,
    findings: [],
    coverage: { reviewed: prepared.packet.scope.review.map((file) => file.path), uncovered: [] },
  };
  fs.writeFileSync(resultFile, `${JSON.stringify(reviewResult, null, 2)}\n`);
  const reviewDraft = writeDraft('real-review.md', 'project-review/references/report.md.tpl');
  run = nextRun(artifact([
    'finalize', '--id', run.id, '--expect-revision', String(run.revision),
    '--kind', 'review', '--draft', reviewDraft,
    '--packet', prepared.path, '--result', resultFile,
  ], { steps: { F7: { status: 'completed' } } }));

  run = nextRun(skillRun([
    'save', '--id', run.id, '--expect-revision', String(run.revision),
  ], { stage: 'F8', decision: { action: 'deliver', confirmed: true } }));
  const deliveryDraft = writeDraft('real-delivery.md', 'dev/references/delivery-template.md');
  run = nextRun(artifact([
    'finalize', '--id', run.id, '--expect-revision', String(run.revision),
    '--kind', 'delivery', '--draft', deliveryDraft,
  ], { steps: { F8: { status: 'completed' } } }));
  run = nextRun(skillRun([
    'complete', '--id', run.id, '--expect-revision', String(run.revision),
  ]));

  assert.equal(run.status, 'completed');
  assert.equal(workflow.runs.get({ branch: BRANCH, id: run.id }).run.status, 'completed');
  for (const name of ['requirement.md', 'plan.md', 'review.md', 'delivery.md']) {
    assert.ok(fs.existsSync(path.join(f.root, f.req.dir, name)), name);
  }
});
