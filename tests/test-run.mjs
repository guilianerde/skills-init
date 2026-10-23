import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bind, sync, which } from '../workflow/scripts/requirement.mjs';
import { startRun, changeRun, runState, FLOWS } from '../workflow/scripts/run.mjs';
import { branchView } from '../workflow/scripts/artifacts.mjs';
import { viewData, renderHtml } from '../workflow/scripts/view.mjs';
import { updateMeta } from '../workflow/scripts/meta-store.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const BRANCH = 'feature/order';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-run-state-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const req = bind(root, { name: '订单导出', branch: BRANCH });
  const file = path.join(root, req.dir, 'meta.json');
  const put = (name, branch = BRANCH) => fs.writeFileSync(path.join(root, req.dir, name), `# ${name}\n\n> 分支：${branch} ｜ 日期：2026-10-23\n\n内容\n`);
  const start = (branch = BRANCH, kind = 'feature') => startRun(root, { branch, kind, size: 'M', input: kind === 'feature' ? { stage: 'F4', steps: Object.fromEntries(['Step0', 'F1', 'F2', 'F3'].map((s) => [s, { status: 'completed' }])), context: { summary: '需求与验收已确认', decisions: ['使用分页'] } } : {} }).run;
  const save = (run, input, action = 'save') => changeRun(root, { branch: run.branch, id: run.id, revision: run.revision, input, action }).run;
  return { root, req, file, put, start, save };
}
const completed = (names) => Object.fromEntries(names.map((name) => [name, { status: 'completed' }]));

test('运行保存在同一 meta.json；sync / which / 重新 bind 均保留上下文、已完成步骤与其他扩展字段', (t) => {
  const f = fixture(t);
  let run = f.start();
  run = f.save(run, { stage: 'F5', steps: { F4: { status: 'completed', evidence: ['plan.md 自检通过'] } }, context: { remaining: ['实现分页'] } });
  updateMeta(f.file, (meta) => ({ ...meta, extension: { keep: true } }));
  f.put('plan.md');
  sync(f.root, f.req.dir);
  which(f.root, BRANCH);
  bind(f.root, { name: '订单导出', branch: 'fix/order' });
  const meta = JSON.parse(fs.readFileSync(f.file));
  assert.deepEqual(meta.runs[run.id], run);
  assert.equal(meta.runs[run.id].steps.F4.status, 'completed');
  assert.ok(meta.runs[run.id].steps.F4.completed_at);
  assert.deepEqual(meta.extension, { keep: true });
  assert.equal(meta.artifacts.length, 1);
  assert.deepEqual(fs.readdirSync(path.dirname(f.file)).sort(), ['meta.json', 'plan.md']);
});

test('等待修复 / 交付时不因报告存在而自动前进；修复回退重置后续完成标记并保留历史', (t) => {
  const f = fixture(t);
  let run = f.start();
  f.put('review.md');
  run = f.save(run, { stage: 'F7', status: 'waiting_user', waiting_for: '修复问题或交付', steps: completed(['F4', 'F5', 'F6', 'F7']) });
  assert.match(branchView(f.root, BRANCH).next[0], /等待用户/);
  const before = fs.readFileSync(f.file, 'utf8');
  assert.throws(() => f.save(run, {}, 'complete'), /未完成步骤/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), before, '失败的完成操作不能改变状态');
  run = f.save(run, { stage: 'F5', status: 'running', decision: { action: 'fix', confirmed: true }, context: { remaining: ['修复越界'] } });
  assert.equal(run.steps.F4.status, 'completed');
  assert.equal(run.steps.F5.status, 'in_progress');
  assert.equal(run.steps.F6.status, 'pending');
  assert.equal(run.steps.F7.status, 'pending');
  assert.ok(run.history.some((h) => h.status === 'waiting_user' && h.steps.F7.status === 'completed'));
  assert.equal(run.waiting_for, null);
});

test('完成必须有明确交付选择和当前分支产物，记录 completed 与完成时间；完成后的新运行不覆盖历史', (t) => {
  const f = fixture(t);
  let run = f.start();
  run = f.save(run, { stage: 'F8', steps: completed(FLOWS.feature) });
  assert.throws(() => f.save(run, {}, 'complete'), /用户已选择交付/);
  run = f.save(run, { decision: { action: 'deliver', confirmed: true } });
  assert.throws(() => f.save(run, {}, 'complete'), /缺少当前分支的产物/);
  for (const name of ['plan.md', 'review.md', 'delivery.md']) f.put(name);
  f.put('review.md', 'feature/other');
  assert.throws(() => f.save(run, {}, 'complete'), /review.md/);
  f.put('review.md');
  run = f.save(run, {}, 'complete');
  assert.equal(run.status, 'completed');
  assert.ok(run.completed_at);
  assert.equal(branchView(f.root, BRANCH).execution.current.status, 'completed');
  assert.throws(() => f.save(run, { context: { summary: '覆盖' } }), /运行已结束/);
  const second = f.start();
  assert.notEqual(second.id, run.id);
  assert.equal(JSON.parse(fs.readFileSync(f.file)).runs[run.id].status, 'completed');
});

test('同需求多分支的运行隔离；重复 start 恢复原运行，旧 revision 不得覆盖新状态', (t) => {
  const f = fixture(t);
  let first = f.start();
  bind(f.root, { name: '订单导出', branch: 'fix/order' });
  const second = f.start('fix/order', 'bug');
  const resume = startRun(f.root, { branch: BRANCH, kind: 'feature', size: 'M', input: { context: { summary: '不能覆盖' } } });
  assert.equal(resume.resumed, true);
  assert.deepEqual(resume.run, first);
  assert.throws(() => changeRun(f.root, { branch: 'fix/order', id: first.id, revision: first.revision, input: {} }), /其他分支/);
  first = f.save(first, { status: 'blocked', reason: '缺少测试环境' });
  assert.throws(() => changeRun(f.root, { branch: BRANCH, id: first.id, revision: 1, input: { status: 'running' } }), /版本冲突/);
  assert.equal(runState(f.root, 'fix/order').current.id, second.id);
  assert.equal(runState(f.root, BRANCH).current.reason, '缺少测试环境');
  const cancelled = f.save(first, { reason: '用户取消需求' }, 'cancel');
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.completed_at, null, '取消不是完成');
});

test('步骤 / 等待 / 阻塞校验拒绝不完整状态；不根据 Markdown 自动标记完成', (t) => {
  const f = fixture(t); const run = f.start();
  assert.throws(() => f.save(run, { steps: { F5: { status: 'skipped' } } }), /reason/);
  assert.throws(() => f.save(run, { status: 'waiting_user' }), /waiting_for/);
  assert.throws(() => f.save(run, { status: 'blocked' }), /reason/);
  assert.throws(() => f.save(run, { stage: 'invalid' }), /无效阶段/);
  assert.throws(() => f.save(run, { status: 'completed' }), /complete/);
  for (const name of ['plan.md', 'review.md', 'delivery.md']) f.put(name);
  sync(f.root, f.req.dir);
  assert.equal(runState(f.root, BRANCH).current.status, 'running');
  assert.equal(runState(f.root, BRANCH).current.steps.F8.status, 'pending');
});

test('无运行的读取不创建目录；只有 meta 状态也能在 view 中显示，完成状态进入页面数据', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-empty-state-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(runState(root, 'feature/fast').current, null);
  assert.deepEqual(fs.readdirSync(root), []);
  assert.throws(() => startRun(root, { branch: 'feature/fast', kind: 'feature', size: 'S' }), /尚未绑定/);
  assert.deepEqual(fs.readdirSync(root), []);
  const f = fixture(t); f.start();
  const data = viewData(f.root);
  assert.equal(data.requirements.length, 1);
  assert.equal(data.requirements[0].artifacts.length, 0);
  assert.equal(data.requirements[0].runs[0].stage, 'F4');
  const html = renderHtml(data);
  const embedded = JSON.parse(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.equal(embedded.requirements[0].runs[0].steps.F3.status, 'completed');
});

test('元信息锁阻止并发覆盖，异常释放锁；损坏 JSON 不会被重建为空索引', (t) => {
  const f = fixture(t);
  const original = fs.readFileSync(f.file, 'utf8');
  fs.writeFileSync(`${f.file}.lock`, '');
  assert.throws(() => sync(f.root, f.req.dir), /正在写入/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), original);
  fs.rmSync(`${f.file}.lock`);
  fs.writeFileSync(f.file, '{invalid');
  assert.throws(() => sync(f.root, f.req.dir));
  assert.equal(fs.readFileSync(f.file, 'utf8'), '{invalid');
  assert.equal(fs.existsSync(`${f.file}.lock`), false);
});

test('CLI 在安装后的 skills 中支持 start / show / save / cancel，并以 JSON 文件提交 checkpoint', (t) => {
  const f = fixture(t);
  const installed = spawnSync(process.execPath, [path.join(REPO, 'bin/workflow-run.mjs'), '--project-root', f.root, '--envs', 'codex', '--skills', 'dev', '--skip-db', '--yes'], { encoding: 'utf8', env: { ...process.env, WORKFLOW_RUN_ADMIN: '1' } });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  const script = path.join(f.root, '.agents/skills/workflow/scripts/run.mjs');
  const cli = (...args) => spawnSync(process.execPath, [script, ...args, '--branch', BRANCH], { cwd: f.root, encoding: 'utf8' });
  const started = cli('start', '--kind', 'feature', '--size', 'M');
  assert.equal(started.status, 0, started.stderr);
  let run = JSON.parse(started.stdout).run;
  const input = path.join(f.root, 'checkpoint.json');
  fs.writeFileSync(input, JSON.stringify({ stage: 'F4', steps: completed(['Step0', 'F1', 'F2', 'F3']), context: { summary: '从对话补入前置进度' } }));
  const saved = cli('save', '--id', run.id, '--expect-revision', String(run.revision), '--input', input);
  assert.equal(saved.status, 0, saved.stderr);
  run = JSON.parse(saved.stdout).run;
  assert.equal(JSON.parse(cli('show').stdout).current.context.summary, '从对话补入前置进度');
  fs.writeFileSync(input, JSON.stringify({ reason: '用户取消' }));
  assert.equal(cli('cancel', '--id', run.id, '--expect-revision', String(run.revision), '--input', input).status, 0);
  assert.equal(cli('save', '--id', run.id, '--expect-revision', String(run.revision)).status, 1);
});
