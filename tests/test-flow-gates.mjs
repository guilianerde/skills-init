import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import childProcess, { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { BRANCH, flowFixture } from './helpers/run-flow.mjs';
import { codeSnapshot, snapshotReader, assertSnapshot } from '../workflow/lib/code-snapshot.mjs';
import { finalizeArtifact, resumeFinalization, abortFinalization } from '../workflow/lib/artifact-finalize.mjs';
import { runState } from '../workflow/lib/runs.mjs';
import { sync, which, nextPath } from '../workflow/lib/requirements.mjs';
import { handoff } from '../workflow/scripts/review-handoff.mjs';
import { useLocalDocNexus } from './helpers/docnexus-pkg.mjs';

useLocalDocNexus();
const REPO = fileURLToPath(new URL('..', import.meta.url));
const done = (step) => ({ steps: { [step]: { status: 'completed' } } });
const changeCode = (f, value = 2) => fs.writeFileSync(path.join(f.root, 'app.js'), `export const value = ${value};\n`);
function reviewed(f, findings = []) {
  let run = f.implement(f.plan(f.start())); changeCode(f);
  return f.review(f.verify(run), findings);
}

test('快照按需读取并在本轮复用；每份证据仍校验，新一轮读取最新代码', (t) => {
  const f = flowFixture(t); const run = f.start();
  const snapshot = codeSnapshot(f.root, run);
  const read = fs.readFileSync; let reads = 0;
  fs.readFileSync = (file, ...args) => {
    if (file === path.join(f.root, 'app.js')) reads++;
    return read(file, ...args);
  };
  try {
    const getSnapshot = snapshotReader(f.root, run);
    assert.equal(reads, 0);
    assertSnapshot(f.root, run, snapshot, getSnapshot);
    assertSnapshot(f.root, run, snapshot, getSnapshot);
    assert.throws(() => assertSnapshot(f.root, run, { ...snapshot, digest: 'stale' }, getSnapshot), /已变化/);
    assert.equal(reads, 1);
    changeCode(f);
    assert.throws(() => assertSnapshot(f.root, run, snapshot, snapshotReader(f.root, run)), /已变化/);
    assert.equal(reads, 2);
  } finally { fs.readFileSync = read; }
});

test('审查交接与收尾共扫描四次；保存和完成在各自校验阶段复用快照', (t) => {
  const f = flowFixture(t); let run = f.verify(f.implement(f.plan(f.start())));
  const spawn = childProcess.spawnSync; let scans = 0;
  childProcess.spawnSync = (cmd, args, options) => {
    if (cmd === 'git' && args[0] === 'ls-files' && args.includes('--cached')) scans++;
    return spawn(cmd, args, options);
  };
  syncBuiltinESMExports();
  try {
    const packet = handoff(f.root, { branch: BRANCH, id: run.id });
    assert.equal(scans, 2, '交接前后各扫描一次');
    const result = { run_id: run.id, code: packet.snapshot.digest, inputs: packet.inputs, findings: [],
      coverage: { reviewed: packet.scope.review.map((f) => f.path), uncovered: [] } };
    run = f.finalize(run, 'review', done('F7'), { packet, result });
    assert.equal(scans, 4, '收尾准备和发布阶段各扫描一次');
    scans = 0;
    run = f.save(run, { stage: 'F8', decision: { action: 'deliver', confirmed: true } });
    assert.equal(scans, 1);
    scans = 0;
    run = f.finalize(run, 'delivery', done('F8'));
    assert.equal(scans, 2);
    scans = 0;
    assert.equal(f.save(run, done('F8'), 'complete').status, 'completed');
    assert.equal(scans, 1);
  } finally {
    childProcess.spawnSync = spawn;
    syncBuiltinESMExports();
  }
});

test('关键门禁拒绝跳过方案、未确认进入实现、未验证进入审查和未选择进入交付；失败不写状态', (t) => {
  const f = flowFixture(t); let run = f.start();
  const reject = (input, re) => {
    const before = fs.readFileSync(f.file, 'utf8');
    assert.throws(() => f.save(run, input), re);
    assert.equal(fs.readFileSync(f.file, 'utf8'), before);
  };
  reject({ stage: 'F5', ...done('F4') }, /已收尾/);
  reject({ steps: { F4: { status: 'skipped', reason: '想跳过' } } }, /核心步骤不能跳过/);
  run = f.plan(run);
  reject({ stage: 'F5' }, /方案尚未由用户确认/);
  run = f.implement(run);
  reject({ stage: 'F7', ...done('F5') }, /代码或基线已变化/);
  run = f.verify(run);
  reject({ stage: 'F8' }, /交付|审查步骤|review.md/);
  reject(done('F7'), /已收尾/);
});

test('方案确认绑定具体版本；完整 S 无需方案确认，M/L 更新方案须重新确认', (t) => {
  const f = flowFixture(t); let run = f.plan(f.start());
  run = f.save(run, { approval: { confirmed: true } });
  const approval = run.plan_approval.hash;
  run = f.finalize(run, 'plan', {}, { text: f.text('plan.md') + '\n更新后的方案\n' });
  assert.notEqual(run.artifacts.plan.hash, approval);
  assert.equal(run.plan_approval, null);
  assert.throws(() => f.save(run, { stage: 'F5' }), /方案尚未由用户确认/);
  run = f.save(run, { approval: { confirmed: true }, stage: 'F5' });
  assert.equal(run.implementation.plan, run.plan_approval.hash);
  f.save(run, { reason: '结束测试' }, 'cancel');
  const small = f.plan(f.start(BRANCH, 'feature', 'S'));
  assert.equal(f.save(small, { stage: 'F5' }).stage, 'F5');
});

test('验证使用执行前快照；期间的未提交修改使登记失败，未验证项必须说明原因', (t) => {
  const f = flowFixture(t); let run = f.implement(f.plan(f.start()));
  run = f.save(run, { stage: 'F6', ...done('F5') });
  const snapshot = codeSnapshot(f.root, run); changeCode(f);
  assert.throws(() => f.save(run, { validation: { snapshot, checks: [{ command: 'test', result: 'passed' }] } }), /已变化/);
  const fresh = codeSnapshot(f.root, run);
  assert.throws(() => f.save(run, { validation: { snapshot: fresh, checks: [{ command: 'test', result: 'unverified' }] } }), /reason/);
  run = f.save(run, { validation: { snapshot: fresh, checks: [{ command: 'test', result: 'unverified', reason: '没有测试环境' }] }, ...done('F6') });
  assert.equal(f.save(run, { stage: 'F7' }).stage, 'F7', '允许如实记录未验证，不能伪造通过');
});

test('快照覆盖新增、删除、暂存及未暂存内容；排除本工具产物，不因写报告反复失效', (t) => {
  const f = flowFixture(t); const run = f.start();
  const baseline = codeSnapshot(f.root, run).digest;
  fs.mkdirSync(path.join(f.root, 'workflow-run/tmp'), { recursive: true });
  fs.writeFileSync(path.join(f.root, 'workflow-run/tmp/one.json'), '{}'); f.put('review.md');
  assert.equal(codeSnapshot(f.root, run).digest, baseline);
  fs.writeFileSync(path.join(f.root, '新文件.js'), 'export const fresh = 1;');
  const added = codeSnapshot(f.root, run).digest; assert.notEqual(added, baseline);
  f.git('add', '新文件.js');
  assert.equal(codeSnapshot(f.root, run).digest, added, '单纯暂存不改变被验证的代码内容');
  fs.appendFileSync(path.join(f.root, '新文件.js'), '\n// changed');
  assert.notEqual(codeSnapshot(f.root, run).digest, added);
  f.git('reset', '--', '新文件.js'); fs.unlinkSync(path.join(f.root, '新文件.js'));
  fs.unlinkSync(path.join(f.root, 'app.js'));
  assert.notEqual(codeSnapshot(f.root, run).digest, baseline);
});

test('排除范围使用与审查一致的 glob；不能拿其他实际 checkout 的代码给原分支作证', (t) => {
  const f = flowFixture(t); let run = f.start();
  run = f.save(run, { scope: { base: 'main', exclude: ['unrelated/**'] } });
  const before = codeSnapshot(f.root, run).digest;
  fs.mkdirSync(path.join(f.root, 'unrelated')); fs.writeFileSync(path.join(f.root, 'unrelated/x.js'), 'const x = 1;');
  assert.equal(codeSnapshot(f.root, run).digest, before);
  f.git('switch', 'main');
  assert.throws(() => codeSnapshot(f.root, run), /实际工作分支/);
});

test('代码或基线变化后，旧报告与交付选择不能用于生成交付文档', (t) => {
  const f = flowFixture(t); let run = reviewed(f);
  run = f.save(run, { stage: 'F8', decision: { action: 'deliver', confirmed: true } });
  changeCode(f, 3);
  assert.equal(runState(f.root, BRANCH).freshness.validation, false);
  assert.throws(() => f.finalize(run, 'delivery'), /已变化/);
  assert.equal(fs.existsSync(path.join(f.root, f.req.dir, 'delivery.md')), false);
  changeCode(f);
  f.git('branch', '-f', 'main', f.git('commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'new base'));
  assert.throws(() => f.finalize(run, 'delivery'), /已变化/);
});

test('严重问题需要逐项明确接受；交付选择绑定报告 hash 与版本，手工修改报告会失效', (t) => {
  const f = flowFixture(t); let run = reviewed(f, [
    { id: 'H1', severity: 'HIGH', verification: 'confirmed', file: 'app.js', line: 1, summary: '特定输入导致错误' },
    { id: 'H2', severity: 'HIGH', verification: 'confirmed', scope: 'outside', file: 'other.js', line: 1, summary: '范围外已有问题' },
  ]);
  assert.throws(() => f.save(run, { stage: 'F8', decision: { action: 'deliver', confirmed: true } }), /严重遗留风险/);
  assert.throws(() => f.save(run, { stage: 'F8', decision: { action: 'deliver', confirmed: true, accepted_risks: 'H1' } }), /id 数组/);
  run = f.save(run, { stage: 'F8', decision: { action: 'deliver', confirmed: true, accepted_risks: ['H1'] } });
  assert.equal(run.decision.report_hash, run.artifacts.review.hash);
  assert.equal(run.decision.report_version, run.artifacts.review.version);
  fs.appendFileSync(path.join(f.root, f.req.dir, 'review.md'), '\n被修改的报告');
  assert.throws(() => f.finalize(run, 'delivery'), /review.md/);
});

test('修复回退清除旧验证、审查与交付选择；复审后必须重新选择', (t) => {
  const f = flowFixture(t); let run = reviewed(f);
  run = f.save(run, { stage: 'F8', decision: { action: 'deliver', confirmed: true } });
  run = f.save(run, { stage: 'F5', decision: { action: 'fix', confirmed: true } });
  assert.equal(run.validation, null); assert.equal(run.review, null); assert.equal(run.steps.F8.status, 'pending');
  run = f.review(f.verify(run));
  assert.equal(run.decision, null);
  assert.throws(() => f.save(run, { stage: 'F8' }), /用户明确选择/);
});

test('bug 同样要求方案确认、实现、验证、审查和交付选择，不能用 B4/B5 合并阶段绕过', (t) => {
  const f = flowFixture(t); let run = f.plan(f.start(BRANCH, 'bug'));
  assert.throws(() => f.save(run, { implement: true }), /方案尚未由用户确认/);
  assert.throws(() => f.save(run, { stage: 'B5' }), /方案尚未由用户确认/);
  run = f.review(f.verify(f.implement(run)));
  assert.throws(() => f.finalize(run, 'delivery'), /用户明确选择/);
  run = f.save(run, { decision: { action: 'deliver', confirmed: true } });
  run = f.finalize(run, 'delivery', done('B5'));
  assert.equal(f.save(run, {}, 'complete').status, 'completed');
});

test('交接材料只带需求事实；覆盖必须逐文件登记，旧运行版本／变动后的代码拒绝收尾', (t) => {
  const f = flowFixture(t); let run = f.implement(f.plan(f.start())); changeCode(f);
  run = f.save(run, { context: { self_review: '实现者认为全部正确', remaining: ['自审结论不传'] } });
  run = f.verify(run);
  const packet = handoff(f.root, { branch: BRANCH, id: run.id });
  assert.deepEqual(packet.facts.acceptance, ['返回分页结果']);
  assert.equal(JSON.stringify(packet).includes('实现者认为全部正确'), false);
  assert.equal(packet.scope.review[0].path, 'app.js');
  const result = { run_id: packet.run_id, code: packet.snapshot.digest, inputs: packet.inputs, findings: [], coverage: { reviewed: [], uncovered: [] } };
  assert.throws(() => f.finalize(run, 'review', {}, { packet, result }), /覆盖范围/);
  result.coverage.uncovered = ['app.js'];
  assert.throws(() => f.finalize(run, 'review', {}, { packet, result: { ...result, code: '旧代码摘要' } }), /审查结果的运行、代码版本/);
  assert.throws(() => f.finalize(run, 'review', { context: { acceptance: ['收尾时改动验收'] } }, { packet, result }), /交接材料不属于当前运行内容/);
  assert.equal(JSON.parse(fs.readFileSync(f.file)).pending_finalization, undefined, '冲突在准备待办前被拒绝');
  changeCode(f, 3);
  assert.throws(() => f.finalize(run, 'review', {}, { packet, result }), /已变化/);
  changeCode(f);
  run = f.save(run, { context: { acceptance: ['改变后的验收标准'] } });
  assert.throws(() => f.finalize(run, 'review', {}, { packet, result }), /交接材料不属于当前运行内容/);
});

test('草稿自检、分支或 revision 失败不覆盖正式文件、不推进状态', (t) => {
  const f = flowFixture(t); const run = f.plan(f.start());
  const before = fs.readFileSync(f.file, 'utf8');
  const opts = { branch: BRANCH, id: run.id, revision: run.revision, kind: 'plan', text: f.text('plan.md') + '\nnew' };
  assert.throws(() => finalizeArtifact(f.root, opts, () => ({ ok: false, errors: ['缺少章节'] })), /草稿自检失败/);
  assert.throws(() => finalizeArtifact(f.root, { ...opts, revision: 1 }, () => ({ ok: true })), /版本冲突/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
  assert.equal(fs.readFileSync(path.join(f.root, f.req.dir, 'plan.md'), 'utf8'), f.text('plan.md'));
});

test('同一方案更新只升一次版本并保留旧正文与 wiki 页面；重试不重复归档', (t) => {
  const f = flowFixture(t); let run = f.plan(f.start());
  const wiki = '<!-- md-to-wiki: pageId=42 -->';
  fs.writeFileSync(path.join(f.root, f.req.dir, 'plan.md'), `${wiki}\n${f.text('plan.md')}`);
  const opts = { branch: BRANCH, id: run.id, revision: run.revision, kind: 'plan', text: f.text('plan.md') + '\n新版正文' };
  const updated = finalizeArtifact(f.root, opts, () => ({ ok: true, warnings: ['示例提醒'], todos: [] }));
  assert.equal(updated.version, 2);
  assert.equal(fs.readFileSync(path.join(f.root, f.req.dir, 'plan.md'), 'utf8'), `${wiki}\n${opts.text}`);
  assert.equal(fs.readFileSync(path.join(f.root, updated.previous), 'utf8'), `${wiki}\n${f.text('plan.md')}`);
  assert.deepEqual(updated.lint.warnings, ['示例提醒']);
  const repeated = finalizeArtifact(f.root, opts, () => ({ ok: true }));
  assert.equal(repeated.already_finalized, true);
  assert.equal(JSON.parse(fs.readFileSync(f.file)).versions.plan, 2);
});

test('独立 review 的快照跨进度保存仍有效，代码变化后不能 complete', (t) => {
  const f = flowFixture(t); let run = f.start(BRANCH, 'review'); changeCode(f);
  const packet = handoff(f.root, { branch: BRANCH, id: run.id });
  run = f.save(run, { stage: 'R7', steps: Object.fromEntries(['R1', 'R2', 'R3', 'R4', 'R5', 'R6'].map((s) => [s, { status: 'completed' }])) });
  const result = { run_id: packet.run_id, code: packet.snapshot.digest, inputs: packet.inputs, findings: [], coverage: { reviewed: ['app.js'], uncovered: [] } };
  run = f.finalize(run, 'review', done('R7'), { packet, result });
  changeCode(f, 3);
  assert.equal(runState(f.root, BRANCH).freshness.review, false);
  assert.throws(() => f.save(run, {}, 'complete'), /已变化/);
  changeCode(f);
  assert.equal(f.save(run, {}, 'complete').status, 'completed');
});

test('发布文件后、meta 提交前中断：待办可见、其他写入受阻，恢复和重复命令不会重复加版本', (t) => {
  const f = flowFixture(t); let run = reviewed(f);
  run = f.save(run, { stage: 'F8', decision: { action: 'deliver', confirmed: true } });
  const opts = { branch: BRANCH, id: run.id, revision: run.revision, kind: 'delivery', text: f.text('delivery.md'), input: done('F8') };
  const rename = fs.renameSync; let commits = 0;
  fs.renameSync = (from, to) => {
    if (to === f.file && ++commits === 2) throw new Error('模拟 meta 提交前崩溃');
    return rename(from, to);
  };
  try { assert.throws(() => finalizeArtifact(f.root, opts, () => ({ ok: true })), /模拟/); }
  finally { fs.renameSync = rename; }
  const pending = JSON.parse(fs.readFileSync(f.file));
  assert.ok(pending.pending_finalization); assert.equal(pending.runs[run.id].revision, run.revision);
  assert.equal(which(f.root, BRANCH).meta.pending_finalization.run_id, run.id, '开工读取可找到恢复入口');
  assert.equal(nextPath(f.root, 'delivery', BRANCH).code, 1, '旧归档接口不能绕过收尾保护');
  assert.match(runState(f.root, BRANCH).next, /恢复产物收尾/);
  const shown = spawnSync(process.execPath, [path.join(REPO, 'workflow/scripts/run.mjs'), 'show', '--root', f.root, '--id', run.id], { encoding: 'utf8' });
  assert.equal(shown.status, 0, shown.stderr);
  assert.match(JSON.parse(shown.stdout).next, /恢复产物收尾/, '指定 id 读取仍显示恢复动作');
  assert.throws(() => f.save(run, { context: { x: true } }), /收尾尚未完成/);
  assert.throws(() => sync(f.root, f.req.dir), /收尾尚未完成/);
  const resumed = resumeFinalization(f.root, { branch: BRANCH, id: run.id });
  assert.equal(resumed.version, 1); assert.equal(resumed.run.revision, run.revision + 1);
  const repeated = finalizeArtifact(f.root, opts, () => ({ ok: true }));
  assert.equal(repeated.already_finalized, true); assert.equal(repeated.run.revision, resumed.run.revision);
  assert.equal(JSON.parse(fs.readFileSync(f.file)).pending_finalization, undefined);
  assert.equal(f.save(resumed.run, {}, 'complete').status, 'completed');
});

test('中断后代码变化会拒绝恢复；可安全取消收尾再回到验证，保留原产物', (t) => {
  const f = flowFixture(t); let run = reviewed(f);
  run = f.save(run, { stage: 'F8', decision: { action: 'deliver', confirmed: true } });
  f.put('delivery.md');
  const original = fs.readFileSync(path.join(f.root, f.req.dir, 'delivery.md'), 'utf8');
  const rename = fs.renameSync; let commits = 0;
  fs.renameSync = (from, to) => { if (to === f.file && ++commits === 2) throw new Error('模拟中断'); return rename(from, to); };
  try { assert.throws(() => f.finalize(run, 'delivery', {}, { text: original + '\nnew' }), /模拟/); }
  finally { fs.renameSync = rename; }
  changeCode(f, 3);
  assert.throws(() => resumeFinalization(f.root, { branch: BRANCH, id: run.id }), /已变化/);
  assert.equal(abortFinalization(f.root, { branch: BRANCH, id: run.id }).aborted, true);
  assert.equal(fs.readFileSync(path.join(f.root, f.req.dir, 'delivery.md'), 'utf8'), original);
  assert.equal(f.save(run, { stage: 'F6' }).stage, 'F6');
});

test('安装后的新 CLI 使用知识模板检查草稿，并生成审查交接 JSON', (t) => {
  const f = flowFixture(t);
  const install = spawnSync(process.execPath, [path.join(REPO, 'bin/workflow-run.mjs'), '--project-root', f.root, '--envs', 'codex', '--skills', 'dev', '--skip-db', '--yes'], { encoding: 'utf8', env: { ...process.env, WORKFLOW_RUN_ADMIN: '1' } });
  assert.equal(install.status, 0, install.stdout + install.stderr);
  let run = f.start();
  const scripts = path.join(f.root, '.agents/skills/workflow/scripts');
  const reqDraft = path.join(f.root, 'workflow-run/tmp/requirement.md');
  fs.mkdirSync(path.dirname(reqDraft), { recursive: true });
  const reqTemplate = fs.readFileSync(path.join(REPO, 'dev/references/requirement-template.md'), 'utf8');
  fs.writeFileSync(reqDraft, reqTemplate.replace(/\{\{([^}]+)\}\}/g, (_, key) => key === 'dev分支' ? BRANCH : key === 'YYYY-MM-DD' ? '2026-10-28' : key === 'S / M / L' ? 'M' : '已确认'));
  const reqInput = path.join(f.root, 'workflow-run/tmp/requirement-checkpoint.json');
  fs.writeFileSync(reqInput, JSON.stringify(done('F3')));
  const reqResult = spawnSync(process.execPath, [path.join(scripts, 'artifact.mjs'), 'finalize', '--id', run.id, '--expect-revision', String(run.revision), '--kind', 'requirement', '--draft', reqDraft, '--input', reqInput], { cwd: f.root, encoding: 'utf8' });
  assert.equal(reqResult.status, 0, reqResult.stderr);
  run = JSON.parse(reqResult.stdout).run;
  assert.equal(run.steps.F3.status, 'completed');
  assert.equal(fs.existsSync(path.join(f.root, f.req.dir, 'plan.md')), false);
  run = f.save(run, { stage: 'F4' });
  const draft = path.join(f.root, 'workflow-run/tmp/plan.md'); fs.mkdirSync(path.dirname(draft), { recursive: true });
  fs.writeFileSync(draft, f.text('plan.md') + '\n{{未填写}}');
  const args = ['finalize', '--id', run.id, '--expect-revision', String(run.revision), '--kind', 'plan', '--draft', draft];
  const bad = spawnSync(process.execPath, [path.join(scripts, 'artifact.mjs'), ...args], { cwd: f.root, encoding: 'utf8' });
  assert.equal(bad.status, 1); assert.match(bad.stderr, /草稿自检失败/);
  fs.writeFileSync(draft, f.text('plan.md'));
  const good = spawnSync(process.execPath, [path.join(scripts, 'artifact.mjs'), ...args], { cwd: f.root, encoding: 'utf8' });
  assert.equal(good.status, 0, good.stderr); run = JSON.parse(good.stdout).run;
  run = f.save(run, done('F4')); run = f.verify(f.implement(run));
  const packet = spawnSync(process.execPath, [path.join(scripts, 'review-handoff.mjs'), '--id', run.id], { cwd: f.root, encoding: 'utf8' });
  assert.equal(packet.status, 0, packet.stderr);
  assert.equal(JSON.parse(packet.stdout).packet.run_id, run.id);
  const snap = spawnSync(process.execPath, [path.join(scripts, 'run.mjs'), 'snapshot', '--id', run.id], { cwd: f.root, encoding: 'utf8' });
  assert.equal(snap.status, 0, snap.stderr); assert.equal(JSON.parse(snap.stdout).snapshot.digest, run.validation.snapshot.digest);
});
