import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { bind } from '../../workflow/lib/requirements.mjs';
import { startRun, changeRun } from '../../workflow/lib/runs.mjs';
import { codeSnapshot } from '../../workflow/lib/code-snapshot.mjs';
import { finalizeArtifact } from '../../workflow/lib/artifact-finalize.mjs';
import { documentHandoff, handoff } from '../../workflow/scripts/review-handoff.mjs';
import { requiresDocumentReview } from '../../workflow/lib/document-review.mjs';

export const BRANCH = 'feature/order';
export function flowFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-run-state-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => {
    const p = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(p.status, 0, p.stderr); return p.stdout.trim();
  };
  git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  fs.writeFileSync(path.join(root, 'app.js'), 'export const value = 1;\n');
  git('add', 'app.js'); git('commit', '-m', 'baseline'); git('switch', '-c', BRANCH);
  const req = bind(root, { name: '订单导出', branch: BRANCH, base: 'main' });
  const file = path.join(root, req.dir, 'meta.json');
  const text = (name, branch = BRANCH) => `# ${name}\n\n> 分支：${branch} ｜ 日期：2026-10-23\n${name === 'plan.md' ? '> 需求文档：requirement.md（v1）\n' : ''}\n内容\n`;
  const put = (name, branch = BRANCH) => fs.writeFileSync(path.join(root, req.dir, name), text(name, branch));
  const start = (branch = BRANCH, kind = 'feature', size = 'M') => startRun(root, { branch, kind, size,
    input: ['feature', 'bug'].includes(kind) ? { stage: kind === 'feature' ? 'F3' : 'B3',
      steps: Object.fromEntries((kind === 'feature' ? ['Step0', 'F1', 'F2'] : ['Step0', 'B1', 'B2']).map((s) => [s, { status: 'completed' }])),
      context: { summary: '需求与验收已确认', decisions: ['使用分页'], acceptance: ['返回分页结果'] } } : {} }).run;
  const save = (run, input, action = 'save') => changeRun(root, { branch: run.branch, id: run.id, revision: run.revision, input, action }).run;
  const reviewDraft = (run, kind, draft) => {
    const packet = documentHandoff(root, { branch: run.branch, id: run.id, kind, text: draft });
    return { packet, result: { run_id: run.id, inputs: packet.inputs, mode: 'independent', confirmed: true, reviewer: 'test-reviewer', summary: '审查通过', findings: [] } };
  };
  const finalize = (run, kind, input = {}, extra = {}) => {
    const draft = extra.text ?? text(`${kind}.md`, run.branch);
    const evidence = requiresDocumentReview(run, kind) && !Object.hasOwn(extra, 'packet') ? reviewDraft(run, kind, draft) : {};
    return finalizeArtifact(root, { branch: run.branch, id: run.id, revision: run.revision, kind, text: draft, input, ...evidence, ...extra }, () => ({ ok: true })).run;
  };
  const requirement = (run) => finalize(run, 'requirement', { steps: { [run.kind === 'feature' ? 'F3' : 'B3']: { status: 'completed' } } });
  const enterPlan = (run) => save(run, run.kind === 'feature'
    ? { stage: 'F4', status: 'running', requirement_approval: { confirmed: true } }
    : { stage: 'B4' });
  const plan = (run) => {
    if (!run.artifacts.requirement) run = requirement(run);
    if (run.stage === 'F3' || run.stage === 'B3') run = enterPlan(run);
    return finalize(run, 'plan', run.kind === 'feature' ? { steps: { F4: { status: 'completed' } } } : {});
  };
  const implement = (run) => save(run, { approval: { confirmed: true }, ...(run.kind === 'feature' ? { stage: 'F5' } : { implement: true }) });
  const verify = (run) => {
    if (run.kind === 'feature') {
      const steps = { F5: { status: 'completed' } };
      run = run.history.some((event) => event.stage === 'F6')
        ? save(save(run, { steps }), { stage: 'F6', advance: { confirmed: true } })
        : save(run, { stage: 'F6', steps });
    }
    const snapshot = codeSnapshot(root, run);
    run = save(run, { validation: { snapshot, checks: [{ command: 'node --check app.js', result: 'passed' }] },
      steps: { [run.kind === 'feature' ? 'F6' : 'B4']: { status: 'completed' } } });
    return save(run, run.kind === 'feature' ? { stage: 'F7', advance: { confirmed: true } } : { stage: 'B5' });
  };
  const review = (run, findings = []) => {
    const packet = handoff(root, { branch: run.branch, id: run.id });
    const result = { run_id: packet.run_id, code: packet.snapshot.digest, inputs: packet.inputs, mode: 'independent', confirmed: true, findings, coverage: { reviewed: packet.scope.review.map((f) => f.path), uncovered: [] } };
    return finalize(run, 'review', run.kind === 'feature' ? { steps: { F7: { status: 'completed' } } } : {}, { packet, result });
  };
  const ready = (kind = 'feature', findings = []) => review(verify(implement(plan(start(BRANCH, kind)))), findings);
  return { root, req, file, text, put, start, save, finalize, reviewDraft, requirement, enterPlan, plan, implement, verify, review, ready, git };
}
