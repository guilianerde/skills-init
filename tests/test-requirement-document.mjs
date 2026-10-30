import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { BRANCH, flowFixture } from './helpers/run-flow.mjs';
import { finalizeArtifact, resumeFinalization } from '../workflow/lib/artifact-finalize.mjs';
import { branchView } from '../workflow/scripts/artifacts.mjs';
import { viewData } from '../workflow/scripts/view.mjs';
import { buildReport } from '../workflow/scripts/report.mjs';
import { buildDescription } from '../workflow/scripts/pr-desc.mjs';
import { handoff } from '../workflow/scripts/review-handoff.mjs';

test('无需清单时需求文档是首个正式产物；未收尾不能进入方案，不能伪造完成或跳过澄清', (t) => {
  const f = flowFixture(t); let run = f.start();
  const before = fs.readFileSync(f.file, 'utf8');
  assert.throws(() => f.save(run, { stage: 'F4' }), /requirement.md/);
  assert.throws(() => f.save(run, { steps: { F3: { status: 'completed' } } }), /requirement.md/);
  assert.throws(() => f.save(run, { steps: { F3: { status: 'skipped', reason: '省略' } } }), /核心步骤不能跳过/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
  run = f.requirement(run);
  assert.equal(run.steps.F3.status, 'completed');
  assert.deepEqual(fs.readdirSync(path.dirname(f.file)).sort(), ['meta.json', 'requirement.md']);
  assert.equal(branchView(f.root, BRANCH).latest.requirement.path, `${f.req.dir}/requirement.md`);
  assert.equal(viewData(f.root).requirements[0].stages.requirement, 1);
  assert.equal(buildReport(f.root).counts.requirement, 1);
  assert.match(buildDescription(f.root, BRANCH, 'main').markdown, /需求文档.*requirement.md/);
  assert.equal(f.save(run, { stage: 'F4' }).stage, 'F4');
});

test('方案独立更新不修改需求文档，审查交接带上对应需求版本', (t) => {
  const f = flowFixture(t); let run = f.plan(f.start());
  const requirement = structuredClone(run.artifacts.requirement);
  run = f.finalize(run, 'plan', {}, { text: f.text('plan.md') + '\n技术设计调整' });
  assert.deepEqual(run.artifacts.requirement, requirement);
  assert.equal(run.artifacts.plan.version, 2);
  assert.deepEqual(run.artifacts.plan.requirement, { hash: requirement.hash, version: requirement.version });
  run = f.verify(f.implement(run));
  assert.deepEqual(handoff(f.root, { branch: BRANCH, id: run.id }).requirement_document, requirement);
});

test('需求变更归档旧版、清除下游证据，旧方案不能重新批准或继续实现', (t) => {
  const f = flowFixture(t); let run = f.ready();
  run = f.save(run, { stage: 'F8', decision: { action: 'deliver', confirmed: true } });
  run = f.save(run, { stage: 'F3' });
  run = f.finalize(run, 'requirement', { steps: { F3: { status: 'completed' } } }, { text: f.text('requirement.md') + '\n新增验收标准' });
  assert.equal(run.artifacts.requirement.version, 2);
  assert.equal(fs.readFileSync(path.join(f.root, run.artifacts.requirement.previous), 'utf8'), f.text('requirement.md'));
  for (const key of ['plan_approval', 'implementation', 'validation', 'review', 'decision']) assert.equal(run[key], null, key);
  assert.equal(run.steps.F4.status, 'pending');
  assert.throws(() => f.save(run, { approval: { confirmed: true } }), /需求版本已变化/);
  assert.throws(() => f.save(run, { stage: 'F5' }), /F4 尚未完成/);
  run = f.plan(run);
  assert.equal(run.artifacts.plan.requirement.version, 2);
  assert.equal(f.implement(run).stage, 'F5');
});

test('需求文件被直接修改时，旧验证与审查结果不可用于交付', (t) => {
  const f = flowFixture(t); const run = f.ready();
  fs.appendFileSync(path.join(f.root, f.req.dir, 'requirement.md'), '\n未收尾的需求变更');
  assert.throws(() => f.save(run, { stage: 'F8', decision: { action: 'deliver', confirmed: true } }), /requirement.md/);
  assert.throws(() => handoff(f.root, { branch: BRANCH, id: run.id }), /requirement.md/);
});

test('bug 在 B3 收尾修复目标和验收文档，B4 方案引用该版本', (t) => {
  const f = flowFixture(t); let run = f.start(BRANCH, 'bug');
  assert.throws(() => f.save(run, { stage: 'B4' }), /requirement.md/);
  run = f.plan(run);
  assert.equal(run.steps.B3.status, 'completed');
  assert.equal(run.artifacts.plan.requirement.hash, run.artifacts.requirement.hash);
  assert.equal(f.verify(f.implement(run)).stage, 'B5');
});

test('方案收尾中断后恢复仍核对需求正文，不能发布依据已失效的方案', (t) => {
  const f = flowFixture(t); let run = f.requirement(f.start());
  run = f.save(run, { stage: 'F4' });
  const rename = fs.renameSync; let commits = 0;
  fs.renameSync = (from, to) => {
    if (to === f.file && ++commits === 2) throw new Error('模拟中断');
    return rename(from, to);
  };
  try {
    assert.throws(() => finalizeArtifact(f.root, { branch: BRANCH, id: run.id, revision: run.revision, kind: 'plan', text: f.text('plan.md') }, () => ({ ok: true })), /模拟中断/);
  } finally { fs.renameSync = rename; }
  const file = path.join(f.root, f.req.dir, 'requirement.md');
  fs.appendFileSync(file, '\n变更');
  assert.throws(() => resumeFinalization(f.root, { branch: BRANCH, id: run.id }), /requirement.md/);
  fs.writeFileSync(file, f.text('requirement.md'));
  assert.equal(resumeFinalization(f.root, { branch: BRANCH, id: run.id }).run.artifacts.plan.requirement.version, 1);
});
