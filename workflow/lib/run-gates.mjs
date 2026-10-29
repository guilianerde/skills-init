// dev 的关键门禁与证据约束；不执行测试，也不代替用户作确认。
import fs from 'node:fs';
import path from 'node:path';
import { FILES, parseBranch } from './artifact-model.mjs';
import { hash, assertSnapshot, assertWorkingBranch, snapshotReader } from './code-snapshot.mjs';

export const isDev = (run) => ['feature', 'bug'].includes(run.kind);
export const coreSteps = (run) => run.kind === 'feature' ? ['F3', 'F4', 'F5', 'F6', 'F7', 'F8'] : ['B3', 'B4', 'B5'];

export function receipt(root, req, run, kind, contents = {}) {
  const record = run.artifacts?.[kind];
  const file = path.join(req.abs, `${FILES[kind]}.md`);
  const text = contents[kind] ?? (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
  if (!record || text === null || record.hash !== hash(text) || parseBranch(text) !== run.branch) throw new Error(`缺少本次运行已收尾的当前分支产物，或内容已变化：${FILES[kind]}.md；请运行 artifact.mjs finalize`);
  return record;
}

export function assertRequirement(root, req, run, contents) {
  return receipt(root, req, run, 'requirement', contents);
}

export function assertPlanBasis(root, req, run, contents) {
  const requirement = assertRequirement(root, req, run, contents);
  const plan = receipt(root, req, run, 'plan', contents);
  if (plan.requirement?.hash !== requirement.hash || plan.requirement.version !== requirement.version) throw new Error('方案依据的需求版本已变化，请根据当前 requirement.md 重新收尾方案');
  return plan;
}

export function assertPlan(root, req, run, contents) {
  assertWorkingBranch(root, run);
  const plan = assertPlanBasis(root, req, run, contents);
  if (run.size !== 'S' && (run.plan_approval?.hash !== plan.hash || run.plan_approval.version !== plan.version)) throw new Error('M / L 方案尚未由用户确认，或确认后方案已变化；先记录 approval.confirmed');
  return plan;
}

export function assertValidation(root, req, run, contents, getSnapshot = snapshotReader(root, run)) {
  const plan = assertPlan(root, req, run, contents);
  if (run.implementation?.plan !== plan.hash) throw new Error('尚未通过方案门禁进入实现，请先进入 F5；bug 保存 implement: true');
  assertSnapshot(root, run, run.validation?.snapshot, getSnapshot);
  return run.validation;
}

export function assertReview(root, req, run, contents, getSnapshot = snapshotReader(root, run)) {
  const validation = isDev(run) ? assertValidation(root, req, run, contents, getSnapshot) : null;
  const report = receipt(root, req, run, 'review', contents);
  if (!run.review || run.review.report_hash !== report.hash || run.review.report_version !== report.version
    || run.review.inputs !== hash(JSON.stringify(reviewInputs(run)))
    || (validation && run.review.snapshot.digest !== validation.snapshot.digest)) throw new Error('缺少对应本轮验证和报告版本的审查证据，请重新审查');
  if (!validation) assertSnapshot(root, run, run.review.snapshot, getSnapshot);
  return run.review;
}

export function assertDelivery(root, req, run, contents, getSnapshot = snapshotReader(root, run)) {
  const review = assertReview(root, req, run, contents, getSnapshot);
  const decision = run.decision;
  if (decision?.action !== 'deliver' || decision.confirmed !== true || decision.report_hash !== review.report_hash
    || decision.report_version !== review.report_version || decision.code !== review.snapshot.digest) throw new Error('进入交付前必须由用户明确选择本轮报告的交付；旧交付选择不再有效');
  const serious = review.result.findings.filter((f) => f.scope !== 'outside' && ['CRITICAL', 'HIGH'].includes(f.severity) && f.verification === 'confirmed');
  if (serious.some((f) => !decision.accepted_risks?.includes(f.id))) throw new Error('严重遗留风险必须逐项说明并取得用户明确接受，记录 accepted_risks 中的问题 id');
}

export function applyDevEvidence(root, req, run, patch, at, contents = {}, getSnapshot = snapshotReader(root, run)) {
  if (!isDev(run)) return;
  for (const step of coreSteps(run)) if (run.steps[step].status === 'skipped') throw new Error(`完整 dev 核心步骤不能跳过：${step}`);
  if (patch.approval !== undefined) {
    if (patch.approval?.confirmed !== true) throw new Error('approval 必须记录用户明确确认：confirmed: true');
    const plan = assertPlanBasis(root, req, run, contents);
    run.plan_approval = { hash: plan.hash, version: plan.version, at };
  }
  const implementing = patch.implement === true || (run.kind === 'feature' && patch.stage === 'F5');
  if (patch.implement !== undefined && patch.implement !== true) throw new Error('implement 只接受 true');
  if (implementing) {
    if (run.kind === 'feature' && run.steps.F4.status !== 'completed') throw new Error('方案步骤 F4 尚未完成，不能进入实现');
    if (run.kind === 'bug' && run.stage !== 'B4') throw new Error('bug 只能在 B4 进入实现');
    const plan = assertPlan(root, req, run, contents);
    run.implementation = { plan: plan.hash, at };
  }
  if (patch.validation !== undefined) {
    if (run.stage !== (run.kind === 'feature' ? 'F6' : 'B4')) throw new Error('请在 F6／B4 验证阶段记录 validation');
    const plan = assertPlan(root, req, run, contents);
    if (run.implementation?.plan !== plan.hash) throw new Error('先通过方案门禁进入实现，再记录验证');
    const v = patch.validation;
    if (!Array.isArray(v?.checks) || !v.checks.length || v.checks.some((c) => !c.command?.trim()
      || !['passed', 'failed', 'unverified'].includes(c.result) || (c.result !== 'passed' && !c.reason?.trim()))) throw new Error('validation.checks 需要命令／操作、passed / failed / unverified；失败或未验证须写 reason');
    const snapshot = assertSnapshot(root, run, v.snapshot, getSnapshot);
    run.validation = { snapshot, checks: v.checks, at };
    run.review = null; run.decision = null;
    if (run.kind === 'feature') for (const step of ['F7', 'F8']) run.steps[step] = { status: 'pending' };
  }
  if (patch.decision?.action === 'deliver') {
    if (run.kind === 'feature' && run.steps.F7.status !== 'completed') throw new Error('审查步骤 F7 尚未完成，不能选择交付');
    const review = assertReview(root, req, run, contents, getSnapshot);
    run.decision = { ...run.decision, code: review.snapshot.digest, report_hash: review.report_hash, report_version: review.report_version };
    assertDelivery(root, req, run, contents, getSnapshot);
  }
  const completed = (s) => patch.steps?.[s]?.status === 'completed';
  const requirementStep = run.kind === 'feature' ? 'F3' : 'B3';
  if (completed(requirementStep)) assertRequirement(root, req, run, contents);
  if (patch.stage === (run.kind === 'feature' ? 'F4' : 'B4')) {
    assertRequirement(root, req, run, contents);
    if (run.steps[requirementStep].status !== 'completed') throw new Error('需求文档尚未完成，不能进入方案／修复阶段');
  }
  if (run.kind === 'feature') {
    if (completed('F4')) receipt(root, req, run, 'plan', contents);
    if (patch.stage === 'F6' || completed('F5')) {
      const plan = assertPlan(root, req, run, contents);
      if (run.implementation?.plan !== plan.hash) throw new Error('尚未通过方案门禁进入实现');
    }
    if (patch.stage === 'F7' || completed('F6')) {
      if (run.steps.F5.status !== 'completed') throw new Error('实现步骤 F5 尚未完成');
      assertValidation(root, req, run, contents, getSnapshot);
      if (patch.stage === 'F7' && run.steps.F6.status !== 'completed') throw new Error('验证步骤 F6 尚未完成');
    }
    if (completed('F7')) assertReview(root, req, run, contents, getSnapshot);
    if (patch.stage === 'F8' || completed('F8')) assertDelivery(root, req, run, contents, getSnapshot);
    if (completed('F8')) receipt(root, req, run, 'delivery', contents);
  } else {
    if (completed('B4') || patch.stage === 'B5') {
      assertValidation(root, req, run, contents, getSnapshot);
      if (patch.stage === 'B5' && run.steps.B4.status !== 'completed') throw new Error('修复与验证步骤 B4 尚未完成');
    }
    if (completed('B5')) { assertDelivery(root, req, run, contents, getSnapshot); receipt(root, req, run, 'delivery', contents); }
  }
  const event = run.history.at(-1);
  if (patch.approval) event.approval = run.plan_approval;
  if (patch.validation) event.validation = run.validation;
  if (patch.decision) event.decision = run.decision;
}

export function reviewInputs(run) {
  const facts = Object.fromEntries(['summary', 'acceptance', 'decisions', 'scope', 'baseline'].filter((k) => run.context[k] !== undefined).map((k) => [k, run.context[k]]));
  return { facts, requirement: run.artifacts?.requirement ?? null, scope: run.scope, plan: run.artifacts?.plan ?? null, validation: run.validation ?? null };
}

export function reviewEvidence(root, req, run, packet, result, contents, getSnapshot = snapshotReader(root, run)) {
  if (!packet || packet.run_id !== run.id || packet.revision > run.revision || packet.inputs !== hash(JSON.stringify(reviewInputs(run)))) throw new Error('审查交接材料不属于当前运行内容，请重新生成 handoff');
  const snapshot = assertSnapshot(root, run, packet.snapshot, getSnapshot);
  if (isDev(run)) assertValidation(root, req, run, contents, getSnapshot);
  if (result?.run_id !== run.id || result.code !== snapshot.digest || result.inputs !== packet.inputs) throw new Error('审查结果的运行、代码版本或交接内容不匹配，请返回本轮审查结果');
  if (!Array.isArray(result?.findings) || !Array.isArray(result?.coverage?.reviewed) || !Array.isArray(result?.coverage?.uncovered)) throw new Error('审查结果需要 findings 和 coverage.reviewed / uncovered');
  const covered = [...result.coverage.reviewed, ...result.coverage.uncovered];
  const expected = packet.scope.review.map((f) => f.path);
  if (new Set(covered).size !== covered.length || expected.length !== covered.length || expected.some((p) => !covered.includes(p))) throw new Error('审查覆盖范围必须逐文件对应交接材料，未审完的放入 uncovered');
  const ids = new Set();
  for (const f of result.findings) {
    if (!f.id || ids.has(f.id) || !['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(f.severity) || !['confirmed', 'pending'].includes(f.verification)
      || (f.scope !== undefined && !['in_scope', 'outside'].includes(f.scope))
      || !f.file || !Number.isInteger(f.line) || f.line < 1 || !f.summary?.trim()) throw new Error('审查问题需要唯一 id、severity、verification、file、正整数 line 与 summary');
    ids.add(f.id);
  }
  const report = receipt(root, req, run, 'review', contents);
  return { snapshot, inputs: packet.inputs, report_hash: report.hash, report_version: report.version, result, at: new Date().toISOString() };
}
