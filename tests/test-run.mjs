import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { useLocalDocNexus } from './helpers/docnexus-pkg.mjs';
import vm from 'node:vm';
import { bind, sync, which } from '../workflow/scripts/requirement.mjs';
import { startRun, changeRun, runState, FLOWS } from '../workflow/scripts/run.mjs';
import { branchView } from '../workflow/scripts/artifacts.mjs';
import { viewData, renderHtml } from '../workflow/scripts/view.mjs';
import { readMeta, updateMeta } from '../workflow/scripts/meta-store.mjs';

useLocalDocNexus();

const REPO = fileURLToPath(new URL('..', import.meta.url));
import { BRANCH, flowFixture as fixture } from './helpers/run-flow.mjs';
const completed = (names) => Object.fromEntries(names.map((name) => [name, { status: 'completed' }]));
const lockOf = (root, file) => {
  const target = path.join(fs.realpathSync.native(path.dirname(file)), path.basename(file));
  const rel = path.relative(fs.realpathSync.native(root), target).split(path.sep).join('/');
  return path.join(root, 'workflow-run/tmp/locks', `${createHash('sha256').update(rel).digest('hex')}.lock`);
};
function seedLock(lock, pid, old = false) {
  fs.mkdirSync(lock, { recursive: true });
  const owner = path.join(lock, `${pid}-${randomUUID()}.json`);
  fs.writeFileSync(owner, JSON.stringify({ pid }));
  if (old) {
    const time = Date.now() / 1000 - 3600;
    fs.utimesSync(owner, time, time);
    fs.utimesSync(lock, time, time);
  }
  return owner;
}

test('运行保存在同一 meta.json；sync / which / 重新 bind 均保留上下文、已完成步骤与其他扩展字段', (t) => {
  const f = fixture(t);
  let run = f.plan(f.start());
  run = f.save(run, { approval: { confirmed: true }, stage: 'F5', steps: { F4: { status: 'completed', evidence: ['plan.md 自检通过'] } }, context: { remaining: ['实现分页'] } });
  updateMeta(f.file, (meta) => ({ ...meta, extension: { keep: true } }), { root: f.root });
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
  let run = f.ready();
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
  let run = f.ready();
  assert.throws(() => f.save(run, { stage: 'F8' }), /用户明确选择/);
  run = f.save(run, { stage: 'F8', decision: { action: 'deliver', confirmed: true } });
  assert.throws(() => f.save(run, {}, 'complete'), /未完成步骤/);
  run = f.finalize(run, 'delivery', { steps: { F8: { status: 'completed' } } });
  f.put('review.md', 'feature/other');
  assert.throws(() => f.save(run, {}, 'complete'), /review.md/);
  f.put('review.md');
  run = f.save(run, {}, 'complete');
  assert.equal(run.status, 'completed');
  assert.ok(run.completed_at);
  assert.equal(branchView(f.root, BRANCH).execution.current.status, 'completed');
  assert.equal(viewData(f.root).requirements[0].runs[0].status, 'completed');
  assert.equal(viewData(f.root).requirements[0].runs[0].completed_at, run.completed_at);
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
  for (const status of ['', null, 0]) assert.throws(() => f.save(run, { status }), /状态只支持/);
  for (const name of ['plan.md', 'review.md', 'delivery.md']) f.put(name);
  sync(f.root, f.req.dir);
  assert.equal(runState(f.root, BRANCH).current.status, 'running');
  assert.equal(runState(f.root, BRANCH).current.steps.F8.status, 'pending');
});

test('无运行的读取不创建目录；只有 meta 状态也能在 view 中显示步骤进度', (t) => {
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
  const all = spawnSync(process.execPath, [path.join(REPO, 'workflow/scripts/artifacts.mjs'), '--root', f.root, '--all'], { encoding: 'utf8' });
  assert.equal(all.status, 0, all.stderr);
  assert.equal(JSON.parse(all.stdout).branches[0].execution.current.branch, BRANCH);
  const html = renderHtml(data);
  const embedded = JSON.parse(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.equal(embedded.requirements[0].runs[0].steps.F3.status, 'completed');
  const nodes = new Map();
  const document = {
    documentElement: { dataset: {} },
    getElementById: () => ({ textContent: JSON.stringify(embedded) }),
    querySelector: (id) => { if (!nodes.has(id)) nodes.set(id, { value: '', innerHTML: '' }); return nodes.get(id); },
    querySelectorAll: () => [],
  };
  vm.runInNewContext(/<script>([\s\S]*?)<\/script>/.exec(html)[1], { document, localStorage: { getItem: () => null }, history: { replaceState() {} }, location: { hash: '' } });
  assert.match(nodes.get('#main').innerHTML, /流程运行状态/);
  assert.match(nodes.get('#main').innerHTML, /F3：已完成/);
  assert.match(nodes.get('#doc').innerHTML, /尚未生成文档/);
});

test('独立审查、技术／上线方案、wiki 和 bug 的步骤与完成标识一致', (t) => {
  const f = fixture(t);
  for (const name of ['plan.md', 'review.md', 'delivery.md', 'tech-doc.md', 'release-doc.md']) f.put(name);
  for (const kind of ['review', 'tech', 'release', 'wiki']) {
    const steps = FLOWS[kind];
    const input = { stage: steps.at(-1), steps: completed(steps), ...(kind === 'bug' ? { decision: { action: 'deliver', confirmed: true } } : {}) };
    let run = startRun(f.root, { branch: BRANCH, kind, size: 'M', input }).run;
    if (kind === 'review') run = f.review(run);
    run = f.save(run, {}, 'complete');
    assert.equal(run.status, 'completed', kind);
    assert.ok(run.completed_at, kind);
  }
  let bug = f.ready('bug');
  bug = f.save(bug, { decision: { action: 'deliver', confirmed: true } });
  bug = f.finalize(bug, 'delivery', { steps: { B5: { status: 'completed' } } });
  assert.equal(f.save(bug, {}, 'complete').status, 'completed');
  assert.equal(runState(f.root, BRANCH).runs.length, 5);
});

test('元信息写入自动创建不存在的父目录；只读不创建，后续更新保留已有字段', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-meta-create-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'new-project');
  const file = path.join(root, 'workflow-run/docs/requirements/新需求/service/meta.json');
  assert.deepEqual(readMeta(file), {});
  assert.equal(fs.existsSync(root), false, '读取不存在的元信息不创建目录');
  const first = updateMeta(file, (meta) => ({ ...meta, counter: 1, extension: { keep: true } }), { root });
  assert.deepEqual(readMeta(file), first);
  const second = updateMeta(file, (meta) => ({ ...meta, counter: meta.counter + 1 }), { root });
  assert.equal(second.counter, 2);
  assert.deepEqual(second.extension, { keep: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), second);
  assert.deepEqual(fs.readdirSync(path.join(root, 'workflow-run/tmp/locks')), [], '锁与临时文件已释放');
});

test('元信息锁阻止并发覆盖，异常释放锁；损坏 JSON 不会被重建为空索引', (t) => {
  const f = fixture(t);
  const original = fs.readFileSync(f.file, 'utf8');
  const lock = lockOf(f.root, f.file);
  seedLock(lock, process.pid);
  assert.throws(() => sync(f.root, f.req.dir), /正在写入/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), original);
  fs.rmSync(lock, { recursive: true });
  fs.writeFileSync(f.file, '{invalid');
  assert.throws(() => sync(f.root, f.req.dir), /不是合法 JSON/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), '{invalid');
  assert.equal(fs.existsSync(lock), false);
});

test('写锁不落在需求目录：崩溃残留不会随产物提交；陈旧锁自动清理，活锁仍拒绝', (t) => {
  const f = fixture(t);
  const lock = lockOf(f.root, f.file);
  // 正常写入后需求目录只剩 meta.json，锁和临时文件都在 workflow-run/tmp/ 下
  sync(f.root, f.req.dir);
  assert.deepEqual(fs.readdirSync(path.dirname(f.file)), ['meta.json']);
  assert.ok(lock.startsWith(path.join(f.root, 'workflow-run/tmp/')), lock);
  // 写入进程已死且锁过期 → 清理后继续，不再永久卡死
  seedLock(lock, 999999, true);
  const meta = updateMeta(f.file, (cur) => ({ ...cur, healed: true }), { root: f.root });
  assert.equal(meta.healed, true);
  assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).healed, true);
  assert.equal(fs.existsSync(lock), false, '陈旧锁已清理');
  // 锁很旧但写入进程仍活着 → 不能抢，避免覆盖正在写的进度
  seedLock(lock, process.pid, true);
  assert.throws(() => updateMeta(f.file, (cur) => cur, { root: f.root }), /正在写入/);
  fs.rmSync(lock, { recursive: true });
  // mkdir 后还没写入标记就崩溃的空锁也能在过期后恢复。
  fs.mkdirSync(lock);
  const old = Date.now() / 1000 - 3600;
  fs.utimesSync(lock, old, old);
  updateMeta(f.file, (cur) => cur, { root: f.root });
  assert.equal(fs.existsSync(lock), false);
});

test('长中文需求名的锁名固定长度，路径分隔符与双下划线不会碰撞', (t) => {
  const f = fixture(t);
  const files = [path.join('需'.repeat(60), 'p'.repeat(60)), 'a__b/c', 'a/b__c'];
  const locks = [];
  for (const dir of files) {
    const file = path.join(f.root, 'workflow-run/docs/requirements', dir, 'meta.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    updateMeta(file, () => {
      const entries = fs.readdirSync(path.join(f.root, 'workflow-run/tmp/locks'));
      assert.equal(entries.length, 1);
      assert.match(entries[0], /^[a-f0-9]{64}\.lock$/);
      assert.equal(Buffer.byteLength(entries[0]), 69);
      locks.push(entries[0]);
      return { saved: true };
    }, { root: f.root });
    assert.equal(JSON.parse(fs.readFileSync(file)).saved, true);
  }
  assert.equal(new Set(locks).size, files.length);
});

test('两个进程同时回收陈旧锁：不能删除新持有者的活锁，重试后保留双方更新', { timeout: 15000 }, async (t) => {
  const f = fixture(t);
  const lock = lockOf(f.root, f.file);
  const stale = seedLock(lock, 999999, true);
  const worker = path.join(f.root, 'lock-worker.mjs');
  fs.writeFileSync(worker, `
import fs from 'node:fs';
import path from 'node:path';
import { updateMeta } from ${JSON.stringify(new URL('../workflow/scripts/meta-store.mjs', import.meta.url).href)};
const [role, root, file, stale] = process.argv.slice(2);
const wait = (gate) => {
  const end = Date.now() + 10000;
  while (!fs.existsSync(path.join(root, gate))) {
    if (Date.now() > end) throw new Error('gate timeout: ' + gate);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
};
if (role === 'B') {
  const unlink = fs.unlinkSync;
  let paused = false;
  fs.unlinkSync = function (file, ...args) {
    if (file === stale && !paused) { paused = true; process.send('stale-decided'); wait('allow-B'); }
    return unlink.call(this, file, ...args);
  };
  try { updateMeta(file, (meta) => ({ ...meta, B: true }), { root }); process.send('unexpected-write'); }
  catch (e) { process.send(e.message.includes('正在写入') ? 'blocked' : e.message); }
  process.once('message', () => {
    updateMeta(file, (meta) => ({ ...meta, B: true }), { root });
    process.send('saved-B'); process.disconnect();
  });
} else {
  updateMeta(file, (meta) => { process.send('A-holding-lock'); wait('allow-A'); return { ...meta, A: true }; }, { root });
  process.send('saved-A'); process.disconnect();
}
`);
  const start = (role) => {
    const child = fork(worker, [role, f.root, f.file, stale], { execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    t.after(() => child.kill());
    return child;
  };
  const b = start('B');
  assert.equal((await once(b, 'message'))[0], 'stale-decided');
  const a = start('A');
  assert.equal((await once(a, 'message'))[0], 'A-holding-lock');
  fs.writeFileSync(path.join(f.root, 'allow-B'), '');
  assert.equal((await once(b, 'message'))[0], 'blocked');
  assert.ok(fs.existsSync(lock), '另一个进程仍持有活锁');
  fs.writeFileSync(path.join(f.root, 'allow-A'), '');
  assert.equal((await once(a, 'message'))[0], 'saved-A');
  const savedB = once(b, 'message');
  b.send('retry');
  assert.equal((await savedB)[0], 'saved-B');
  const meta = JSON.parse(fs.readFileSync(f.file));
  assert.equal(meta.A, true);
  assert.equal(meta.B, true);
  assert.equal(fs.existsSync(lock), false);
});

test('同一需求目录的路径别名共用写锁；空目录恢复期间也不能删除新持有者标记', (t) => {
  const f = fixture(t);
  const lock = lockOf(f.root, f.file);
  updateMeta(f.file, (meta) => {
    // Windows / 默认 macOS 文件系统：同一目录的大小写别名不能产生另一把锁。
    const alias = path.join(path.dirname(f.file).toUpperCase(), 'meta.json');
    if (fs.existsSync(alias)) assert.throws(() => updateMeta(alias, (cur) => cur, { root: f.root }), /正在写入/);
    assert.throws(() => updateMeta(path.join(path.dirname(f.file), '..', path.basename(path.dirname(f.file)), 'meta.json'), (cur) => cur, { root: f.root }), /正在写入/);
    return meta;
  }, { root: f.root });
  // 模拟 mkdir 后停顿，空目录已被回收且另一个写入者取得了同名目录。
  const write = fs.writeFileSync;
  let replacement;
  let replaced = false;
  fs.writeFileSync = function (file, ...args) {
    if (!replaced && path.dirname(file) === lock) {
      replaced = true;
      fs.rmdirSync(lock);
      replacement = seedLock(lock, process.pid);
    }
    return write.call(this, file, ...args);
  };
  try {
    assert.throws(() => updateMeta(f.file, (cur) => cur, { root: f.root }), /正在写入/);
    assert.deepEqual(fs.readdirSync(lock), [path.basename(replacement)], '失败的写入只清理自身标记');
  } finally {
    fs.writeFileSync = write;
    fs.rmSync(lock, { recursive: true, force: true });
  }
});

test('发布已有产物按来源需求与分支记录，不跟随当前 checkout 或同分支最新绑定串到其他需求', (t) => {
  const f = fixture(t);
  bind(f.root, { name: '另一个需求', branch: BRANCH });
  bind(f.root, { name: '主分支任务', branch: 'main' });
  const run = startRun(f.root, { branch: BRANCH, kind: 'wiki', dir: f.req.dir, input: { context: { document: `${f.req.dir}/tech-doc.md`, pageId: '42' } } });
  assert.equal(run.dir, f.req.dir);
  assert.equal(run.run.branch, BRANCH);
  assert.equal(runState(f.root, 'main').current, null);
  assert.equal(JSON.parse(fs.readFileSync(f.file)).runs[run.run.id].context.pageId, '42');
  assert.throws(() => startRun(f.root, { branch: 'main', kind: 'wiki', dir: f.req.dir }), /尚未绑定指定需求/);
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
