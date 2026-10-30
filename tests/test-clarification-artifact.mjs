import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BRANCH, flowFixture } from './helpers/run-flow.mjs';
import { finalizeArtifact } from '../workflow/lib/artifact-finalize.mjs';
import { startRun } from '../workflow/lib/runs.mjs';
import { branchView } from '../workflow/scripts/artifacts.mjs';
import { viewData } from '../workflow/scripts/view.mjs';
import { buildReport } from '../workflow/scripts/report.mjs';
import { buildDescription } from '../workflow/scripts/pr-desc.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const checklist = (stage = 'F2') => `# 业务场景待确认清单 — 订单导出

> 阶段：${stage} ｜ 状态：待产品反馈 ｜ 轮次：1 ｜ 更新日期：2026-10-30
> 分支：${BRANCH} ｜ 需求来源：对话 ｜ 下一步：产品确认导出范围

## 当前需求理解
按渠道导出订单。
## 业务场景
| 场景编号 | 角色 | 前置条件 / 触发操作 | 预期业务结果 | 异常或边界处理 | 关联问题 |
|---|---|---|---|---|---|
| SC-1 | 运营 | 选择渠道并导出 | 获取该渠道的有效订单 | 无数据时导出空文件 | Q1 |
## 待确认清单
| 编号 | 问题与场景 | 为什么要确认 / 影响 | 推荐答案与依据 | 产品 / 用户答复及来源 | 状态 |
|---|---|---|---|---|---|
| Q1 | 是否包含已取消订单 | 决定导出范围 | 建议排除，报表仅统计有效订单 | 未答复 | 待确认 |
## 本轮核对摘要
- 仍待确认：Q1
## 产品方案 / PRD 调整建议
补充导出范围的业务规则。
## 当前验收标准草案
| 编号 | 场景 / 条件 | 预期行为 | 确认情况 / 关联问题 |
|---|---|---|---|
| AC-1 | 按渠道导出 | 返回该渠道的有效订单 | 待 Q1 确认 |
## 反馈记录
- 第 1 轮：等待产品反馈。
`;

test('F3 前在 F2 发布业务清单；多轮更新归档并展示，业务明确后经 F3 技术澄清进入 F4', (t) => {
  const f = flowFixture(t);
  let run = startRun(f.root, { branch: BRANCH, kind: 'feature', size: 'M', input: { stage: 'F2',
    steps: { Step0: { status: 'completed' }, F1: { status: 'completed' } } } }).run;
  for (const [file, content] of [
    ['.docnexus/project.json', '{"format_version":7,"output_dir":"workflow-run"}'],
    [`.docnexus/node_modules/.bin/${process.platform === 'win32' ? 'docnexus.cmd' : 'docnexus'}`, ''],
    ['workflow-run/docnexus/library/templates/dev/clarification-template.md', fs.readFileSync(path.join(REPO, 'dev/references/clarification-template.md'), 'utf8')],
  ]) {
    fs.mkdirSync(path.dirname(path.join(f.root, file)), { recursive: true });
    fs.writeFileSync(path.join(f.root, file), content);
  }
  const draft = 'workflow-run/tmp/clarification.md';
  const checkpoint = 'workflow-run/tmp/checkpoint.json';
  const publish = (text, input) => {
    fs.mkdirSync(path.join(f.root, 'workflow-run/tmp'), { recursive: true });
    fs.writeFileSync(path.join(f.root, draft), text);
    fs.writeFileSync(path.join(f.root, checkpoint), JSON.stringify(input));
    const r = spawnSync(process.execPath, [path.join(REPO, 'workflow/scripts/artifact.mjs'), 'finalize', '--id', run.id,
      '--expect-revision', String(run.revision), '--kind', 'clarification', '--draft', draft, '--input', checkpoint], { cwd: f.root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout); run = out.run; return out;
  };
  const first = publish(checklist(), { status: 'waiting_user', waiting_for: '产品确认 Q1', steps: { F2: { status: 'in_progress' } } });
  assert.equal(first.path, `${f.req.dir}/clarification.md`);
  assert.equal(first.version, 1);
  assert.equal(first.lint.ok, true);
  assert.equal(run.stage, 'F2');
  assert.equal(run.status, 'waiting_user');
  assert.equal(run.steps.F2.status, 'in_progress');
  assert.equal(run.steps.F3.status, 'pending');
  assert.equal(run.artifacts.requirement, undefined);
  assert.equal(branchView(f.root, BRANCH).latest.clarification.path, first.path);
  assert.equal(viewData(f.root).requirements[0].stages.clarification, 1);
  assert.equal(buildReport(f.root).counts.clarification, 1);
  assert.match(buildDescription(f.root, BRANCH, 'main').markdown, /澄清清单.*clarification.md/);
  assert.throws(() => f.save(run, { stage: 'F4' }), /requirement.md/);
  assert.throws(() => finalizeArtifact(f.root, { branch: BRANCH, id: run.id, revision: run.revision, kind: 'clarification',
    text: checklist(), input: { steps: { F2: { status: 'completed' } } } }, () => ({ ok: true })), /清单发布不能代替阶段完成/);
  assert.throws(() => f.requirement(run), /F3 收尾/);

  const second = publish(checklist().replace('轮次：1', '轮次：2').replace('状态：待产品反馈', '状态：业务已明确')
    .replace('| 未答复 | 待确认 |', '| 用户转述产品答复：排除已取消订单 | 已确认 |')
    .replace('仍待确认：Q1', '已确认：Q1；仍待确认：无').replace('待 Q1 确认', '已确认 / Q1')
    + '\n- 第 2 轮：产品确认排除已取消订单，业务范围已明确。\n', { status: 'running' });
  assert.equal(second.version, 2);
  assert.equal(fs.readFileSync(path.join(f.root, second.previous), 'utf8'), checklist());
  assert.equal(run.steps.F2.status, 'in_progress');
  assert.equal(run.steps.F3.status, 'pending');
  assert.equal(buildReport(f.root).counts.clarification, 1);
  run = f.save(run, { stage: 'F3', steps: { F2: { status: 'completed' } } });
  assert.equal(run.steps.F3.status, 'in_progress');
  assert.equal(run.artifacts.requirement, undefined);
  assert.throws(() => finalizeArtifact(f.root, { branch: BRANCH, id: run.id, revision: run.revision,
    kind: 'clarification', text: checklist() }, () => ({ ok: true })), /F2 收尾/);
  run = f.requirement(run);
  assert.equal(run.steps.F3.status, 'completed');
  assert.deepEqual(fs.readdirSync(path.dirname(f.file)).sort(), ['clarification.md', 'meta.json', 'requirement.md']);
  run = f.save(run, { stage: 'F4' });
  assert.throws(() => finalizeArtifact(f.root, { branch: BRANCH, id: run.id, revision: run.revision,
    kind: 'clarification', text: checklist() }, () => ({ ok: true })), /F2 收尾/);
});

test('bug 清单在 B3 发布，不能替代需求文档进入 B4', (t) => {
  const f = flowFixture(t); let run = f.start(BRANCH, 'bug');
  run = finalizeArtifact(f.root, { branch: BRANCH, id: run.id, revision: run.revision, kind: 'clarification',
    text: checklist('B3'), input: { status: 'waiting_user', waiting_for: '产品核对预期行为' } }, () => ({ ok: true })).run;
  assert.equal(run.stage, 'B3');
  assert.equal(run.steps.B3.status, 'in_progress');
  assert.equal(run.artifacts.clarification.version, 1);
  assert.throws(() => f.save(run, { stage: 'B4' }), /requirement.md/);
});

for (const kind of ['feature', 'bug']) test(`${kind} 回退更新业务清单后旧需求和方案凭据失效，重新收尾后须重新确认方案`, (t) => {
  const f = flowFixture(t);
  const businessStep = kind === 'feature' ? 'F2' : 'B3';
  const requirementStep = kind === 'feature' ? 'F3' : 'B3';
  const planStep = kind === 'feature' ? 'F4' : 'B4';
  const source = checklist(businessStep);
  const publish = (run, text) => finalizeArtifact(f.root, { branch: BRANCH, id: run.id, revision: run.revision,
    kind: 'clarification', text }, () => ({ ok: true })).run;
  let run = f.start(BRANCH, kind);
  if (kind === 'feature') run = f.save(run, { stage: businessStep });
  run = publish(run, source);
  if (kind === 'feature') run = f.save(run, { stage: requirementStep, steps: { F2: { status: 'completed' } } });
  run = f.review(f.verify(f.implement(f.plan(run))));
  run = f.save(run, { ...(kind === 'feature' ? { stage: 'F8' } : {}), decision: { action: 'deliver', confirmed: true } });
  const previous = structuredClone({ requirement: run.artifacts.requirement, plan: run.artifacts.plan, approval: run.plan_approval });
  run = f.save(run, { stage: businessStep });

  // 相同内容重新发布不丢失仍然有效的需求、方案与确认。
  run = publish(run, source);
  assert.deepEqual(run.artifacts.requirement, previous.requirement);
  assert.deepEqual(run.artifacts.plan, previous.plan);
  assert.deepEqual(run.plan_approval, previous.approval);

  run = publish(run, source + '\n- 产品变更：必须包含已取消订单。\n');
  assert.equal(run.artifacts.requirement, undefined);
  assert.equal(run.artifacts.plan, undefined);
  for (const key of ['plan_approval', 'implementation', 'validation', 'review', 'decision']) assert.equal(run[key], null, key);
  assert.equal(run.steps[requirementStep].status, kind === 'feature' ? 'pending' : 'in_progress');
  assert.equal(run.steps[planStep].status, 'pending');
  assert.equal(fs.readFileSync(path.join(f.root, previous.requirement.path), 'utf8'), f.text('requirement.md'));
  assert.equal(fs.readFileSync(path.join(f.root, previous.plan.path), 'utf8'), f.text('plan.md'));
  assert.throws(() => f.save(run, { steps: { [requirementStep]: { status: 'completed' } } }), /requirement.md/);
  assert.throws(() => f.save(run, { stage: planStep }), /requirement.md/);
  assert.throws(() => f.save(run, { approval: { confirmed: true } }), /requirement.md/);

  if (kind === 'feature') run = f.save(run, { stage: requirementStep, steps: { F2: { status: 'completed' } } });
  run = f.requirement(run);
  run = f.save(run, { stage: planStep });
  // 即便重新收尾的需求正文相同，也不能复用旧方案凭据与确认。
  assert.equal(run.artifacts.requirement.hash, previous.requirement.hash);
  assert.throws(() => f.save(run, { approval: { confirmed: true } }), /plan.md/);
  run = f.plan(run);
  assert.throws(() => f.save(run, kind === 'feature' ? { stage: 'F5' } : { implement: true }), /方案尚未由用户确认/);
  assert.equal(f.implement(run).stage, kind === 'feature' ? 'F5' : 'B4');
});
