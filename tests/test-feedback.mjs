// workflow/scripts/feedback.mjs：运行反馈的记录、汇总，以及装新版本时清掉旧版本记录
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseAdd, add, readAll, rotate, summarize, installedVersion, ensureUnionMerge } from '../workflow/scripts/feedback.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const PKG = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
const node = (args, cwd) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });

function repo(user = 'Li Lei') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-'));
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['config', 'user.name', user], { cwd: root });
  spawnSync('git', ['remote', 'add', 'origin', 'git@example.com:team/pay-service.git'], { cwd: root });
  return root;
}

test('parseAdd：校验取值，--skipped / --unclear / --feedback 可重复', () => {
  const r = parseAdd(['--skill', 'dev', '--size', 'M', '--fast', 'no', '--rounds', '2', '--acceptance', '3/4', '--unclear', 'F4: a', '--unclear', 'F7: b']);
  assert.deepEqual(r, { skill: 'dev', size: 'M', fast: 'no', rounds: 2, acceptance: '3/4', unclear: ['F4: a', 'F7: b'] });
  assert.throws(() => parseAdd(['--size', 'M']), /缺少 --skill/);
  assert.throws(() => parseAdd(['--skill', 'dev', '--size', 'XL']), /S \/ M \/ L/);
  assert.throws(() => parseAdd(['--skill', 'dev', '--rounds', 'two']), /非负整数/);
  assert.throws(() => parseAdd(['--skill', 'dev', '--findings', '1/2']), /格式不对/);
  assert.throws(() => parseAdd(['--skill', 'dev', '--code', 'x']), /未知参数/);
  assert.throws(() => parseAdd(['--skill', 'dev', '--model']), /缺少值/);
});

test('add：每人一个文件，带时间、版本、项目名；汇总按 skill 归类，规则按章节分组', () => {
  const root = repo();
  const r = add(root, parseAdd(['--skill', 'dev', '--model', 'm1', '--mode', 'feature', '--size', 'S', '--fast', 'yes', '--rounds', '0', '--acceptance', '2/2', '--unclear', 'F4: 条件重复']));
  assert.equal(r.file, 'workflow-run/feedback/Li-Lei.jsonl');
  assert.deepEqual([r.record.version, r.record.project], [installedVersion(), 'pay-service']);
  add(root, parseAdd(['--skill', 'dev', '--model', 'm2', '--mode', 'bug', '--size', 'M', '--fast', 'no', '--rounds', '3', '--corrections', '1', '--acceptance', '1/3', '--baseline-failures', '2', '--unclear', 'F4: S 判定不清', '--skipped', 'F6: 缺 Redis', '--feedback', '问得太多']));
  add(root, parseAdd(['--skill', 'project-review', '--mode', 'review', '--depth', '标准', '--findings', '0/1/2/0', '--unclear', '第 3 步: 规模怎么量']));
  const s = summarize(readAll(root));
  assert.equal(s.records, 3);
  assert.equal(s.users, 1);
  const dev = s.skills.dev;
  assert.deepEqual([dev.runs, dev.fast_path, dev.avg_rounds, dev.runs_with_corrections, dev.runs_with_baseline_failures], [2, 1, 1.5, 1, 1]);
  assert.deepEqual(dev.acceptance, { verified: 3, total: 5 });
  assert.deepEqual(dev.unclear, { F4: ['F4: 条件重复', 'F4: S 判定不清'] });
  assert.deepEqual(Object.keys(dev.skipped), ['F6']);
  assert.deepEqual(s.skills['project-review'].findings, { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 0 });
  assert.deepEqual(Object.keys(s.skills['project-review'].unclear), ['第3步']);
});

test('rotate：只删本项目旧版本的记录，当前版本和其他项目的保留', () => {
  const root = repo();
  const f = path.join(root, 'workflow-run', 'feedback', 'a.jsonl');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const line = (version, project) => JSON.stringify({ skill: 'dev', version, project });
  fs.writeFileSync(f, [line('0.1.0', 'pay-service'), line('0.2.0', 'pay-service'), line('0.1.0', 'order-service')].join('\n') + '\n');
  assert.equal(rotate(root, '0.2.0'), 1);
  assert.deepEqual(fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l).version + JSON.parse(l).project), ['0.2.0pay-service', '0.1.0order-service']);
  assert.equal(rotate(root, '0.2.0'), 0, '重跑不再删');
  fs.writeFileSync(f, line('0.1.0', 'pay-service') + '\n');
  assert.equal(rotate(root, '0.2.0'), 1);
  assert.equal(fs.readFileSync(f, 'utf8'), '', '全是旧记录时清空文件');
});

test('CLI：init 清掉旧版本记录；feedback 命令输出汇总', () => {
  const root = repo();
  const f = path.join(root, 'workflow-run', 'feedback', 'Li-Lei.jsonl');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `${JSON.stringify({ skill: 'dev', version: '0.0.1', project: 'pay-service' })}\n`);
  const inst = node([path.join(REPO, 'bin', 'workflow-run.mjs'), '--project-root', root, '--envs', 'codex', '--yes', '--skip-db'], root);
  assert.equal(inst.status, 0, inst.stderr);
  assert.match(inst.stdout, /运行反馈：已清空旧版本的 1 条记录/);
  assert.equal(fs.readFileSync(f, 'utf8'), '');
  assert.ok(!fs.existsSync(path.join(root, '.gitattributes')), '随代码提交时不改代码仓库的 .gitattributes');
  const add1 = node([path.join(root, '.agents', 'skills', 'workflow', 'scripts', 'feedback.mjs'), 'add', '--skill', 'dev', '--size', 'L', '--unclear', 'F8: 交付太长'], root);
  assert.equal(add1.status, 0, add1.stderr);
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).version, PKG.version, '安装后从清单取版本');
  const sum = node([path.join(REPO, 'bin', 'workflow-run.mjs'), 'feedback', '--project-root', root], root);
  assert.equal(sum.status, 0, sum.stderr);
  assert.match(sum.stdout, /## dev（1 次）/);
  assert.match(sum.stdout, /\*\*F8\*\*（1）\n  - F8: 交付太长/);
  const bad = node([path.join(REPO, 'workflow', 'scripts', 'feedback.mjs'), '--root', root, 'add', '--skill', 'dev', '--size', 'XL'], root);
  assert.equal(bad.status, 1);
});

test('ensureUnionMerge：随代码提交时去掉 0.22.0 加的那行，其他规则保留，只剩这行时删文件', () => {
  const root = repo();
  const attr = path.join(root, '.gitattributes');
  fs.writeFileSync(attr, '*.sh text eol=lf\nworkflow-run/feedback/*.jsonl merge=union\n');
  assert.equal(ensureUnionMerge(root).action, 'removed');
  assert.equal(fs.readFileSync(attr, 'utf8'), '*.sh text eol=lf\n');
  assert.equal(ensureUnionMerge(root), null);
  fs.writeFileSync(attr, 'workflow-run/feedback/*.jsonl merge=union\n');
  ensureUnionMerge(root);
  assert.ok(!fs.existsSync(attr));
});

test('ensureUnionMerge：独立文档仓库里加在文档仓库的 .gitattributes，两个分支各追加一行，合并不冲突、两行都在', () => {
  const root = repo();
  const home = path.join(root, 'workflow-run');
  fs.mkdirSync(home);
  const g = (...a) => { const r = spawnSync('git', a, { cwd: home, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  g('init', '-q'); g('config', 'user.name', 'Li Lei'); g('config', 'user.email', 'li@example.com');
  assert.deepEqual(ensureUnionMerge(root), { action: 'added', file: 'workflow-run/.gitattributes', rule: 'feedback/*.jsonl merge=union' });
  assert.equal(ensureUnionMerge(root), null);
  assert.ok(!fs.existsSync(path.join(root, '.gitattributes')));
  add(root, { skill: 'dev', size: 'S' });
  g('add', '-A'); g('commit', '-qm', 'base'); g('branch', '-M', 'main');
  g('checkout', '-qb', 'a'); add(root, { skill: 'dev', size: 'M' }); g('commit', '-qam', 'a');
  g('checkout', '-q', 'main'); g('checkout', '-qb', 'b'); add(root, { skill: 'dev', size: 'L' }); g('commit', '-qam', 'b');
  g('merge', '-q', 'a', '-m', 'merge a');
  assert.deepEqual(readAll(root).map((r) => r.size).sort(), ['L', 'M', 'S']);
});
