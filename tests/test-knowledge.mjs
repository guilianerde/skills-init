// workflow/scripts/knowledge.mjs：按 skill.json 的 docnexus.readFrom 分类列出知识库文档（用假的 docnexus CLI）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { useLocalDocNexus, resetDocNexus } from './helpers/docnexus-pkg.mjs';

// 必装组件 DocNexus 用本地夹具接入：不依赖 npm registry，也不写用户的 ~/.npm。
useLocalDocNexus();

const REPO = fileURLToPath(new URL('..', import.meta.url));
const skip = process.platform === 'win32' ? '假 CLI 用 shebang 脚本实现，Windows 跳过' : false;

// 假 docnexus：document query --category 从 docs.json 里按分类返回；分类 broken 模拟查询失败
const FAKE = `#!/usr/bin/env node
const fs = require('fs');
const [cmd, sub, ...rest] = process.argv.slice(2);
const cat = rest[rest.indexOf('--category') + 1];
if (cmd === 'recall') {
  const all = JSON.parse(fs.readFileSync('docs.json', 'utf8')).filter((d) => d.category === cat && d.body.includes(sub));
  console.log(JSON.stringify({ query: sub, context_groups: all.map((d) => ({ id: d.id, path: 'workflow-run/docnexus/library/' + d.file_path })) }));
  process.exit(0);
}
if (cmd !== 'document' || sub !== 'query') process.exit(1);
if (cat === 'broken') { console.error('engine_unavailable'); process.exit(1); }
const docs = JSON.parse(fs.readFileSync('docs.json', 'utf8')).filter((d) => d.category === cat);
console.log(JSON.stringify({ documents: docs.map((d) => ({ ...d, library_path: 'workflow-run/docnexus/library/' + d.file_path, document: '正文不应输出' })) }));
`;

function project({ connect = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-'));
  const r = spawnSync(process.execPath, [path.join(REPO, 'bin', 'workflow-run.mjs'), '--project-root', root, '--envs', 'codex', '--skip-db', '--yes'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  // 安装一定会接入 DocNexus；本文件用假 CLI，先清掉再按 connect 需要搭。
  resetDocNexus(root);
  if (connect) {
    fs.mkdirSync(path.join(root, '.docnexus'), { recursive: true });
    fs.writeFileSync(path.join(root, '.docnexus', 'project.json'), '{"format_version":7,"output_dir":"workflow-run"}');
    // format 7：内部状态与 CLI 在 .docnexus/
    fs.mkdirSync(path.join(root, '.docnexus', 'node_modules', '.bin'), { recursive: true });
    fs.writeFileSync(path.join(root, '.docnexus', 'node_modules', '.bin', 'docnexus'), FAKE, { mode: 0o755 });
  }
  const doc = (id, category, title, updated_at, extra = {}) => ({ id, category, title, summary: `${title} 摘要`, file_path: `notes/${id}.md`, updated_at, tags: [], body: `${title} 正文`, ...extra });
  fs.mkdirSync(path.join(root, 'workflow-run'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs.json'), JSON.stringify([
    doc('a', 'dev-notes', '订单幂等约定', '2026-10-01'),
    doc('b', 'dev-notes', '缓存击穿处理', '2026-10-03', { body: '缓存失效时订单查询走互斥锁' }),
    doc('c', 'code-review', '金额精度', '2026-10-02', { tags: ['订单'] }),
    doc('d', 'tech-design', '支付重构', '2026-09-01'),
    doc('e', 'release-plan', '上线回滚', '2026-09-01'),
  ]));
  const run = (...args) => {
    const res = spawnSync(process.execPath, [path.join(root, '.agents', 'skills', 'workflow', 'scripts', 'knowledge.mjs'), ...args], { cwd: root, encoding: 'utf8' });
    return { status: res.status, out: res.stdout ? JSON.parse(res.stdout) : null, raw: res.stdout };
  };
  return { root, run };
}

test('按 readFrom 顺序列出各分类，按更新时间倒序，不含正文', { skip }, () => {
  const { root, run } = project();
  const r = run('dev');
  assert.equal(r.status, 0);
  assert.deepEqual(r.out.categories.map((c) => [c.category, c.from]), [['dev-notes', 'dev'], ['tech-design', 'create-tech-md-doc'], ['code-review', 'project-review']]);
  assert.deepEqual(r.out.categories[0].documents.map((d) => d.id), ['b', 'a']);
  assert.equal(r.out.categories[0].documents[0].path, 'workflow-run/docnexus/library/notes/b.md');
  assert.doesNotMatch(r.raw, /正文不应输出/);
  assert.ok(!r.out.categories.some((c) => c.category === 'release-plan'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('--match 按标题 / 摘要 / 标签过滤，--limit 截断但 total 保留', { skip }, () => {
  const { root, run } = project();
  const r = run('dev', '--match', '订单,不存在');
  assert.deepEqual(r.out.categories.map((c) => c.documents.map((d) => d.id)), [['a'], [], ['c']]);
  const l = run('dev', '--limit', '1');
  assert.deepEqual([l.out.categories[0].total, l.out.categories[0].documents.length], [2, 1]);
  assert.equal(run('dev', '--limit', '0').status, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('项目画像改了分类名时跟随；单个分类查询失败不影响其他分类', { skip }, () => {
  const { root, run } = project();
  const profile = path.join(root, '.agents/skills/workflow/profile.json');
  const p = JSON.parse(fs.readFileSync(profile, 'utf8'));
  fs.writeFileSync(profile, JSON.stringify({ ...p, docnexus_categories: { 'create-tech-md-doc': 'broken', 'project-review': 'dev-notes' } }));
  const r = run('dev');
  assert.deepEqual(r.out.categories.map((c) => [c.category, c.ok]), [['dev-notes', true], ['broken', false]]);
  assert.match(r.out.categories[1].error, /engine_unavailable/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('未接入 DocNexus 退出 2；未知 skill 退出 1', () => {
  const { root, run } = project({ connect: false });
  assert.deepEqual([run('dev').status, run('dev').out.error], [2, 'no_docnexus']);
  assert.equal(run('nope').status, 1);
  assert.equal(run().status, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('--query：每个分类内 recall 按正文检索', { skip }, () => {
  const { root, run } = project();
  let r = run('dev', '--query', '订单');
  assert.equal(r.status, 0);
  assert.equal(r.out.recall_by_category, true);
  // b 的标题不含「订单」，正文含，--match 找不到而 recall 能找到
  assert.deepEqual(r.out.categories.map((c) => [c.category, c.recall.context_groups.map((g) => g.id)]), [['dev-notes', ['a', 'b']], ['tech-design', []], ['code-review', []]]);
  assert.equal(run('dev').out.recall_by_category, undefined, '不给 --query 不 recall');
  assert.equal(run('dev', '--query', 'x', '--recall-limit', '0').status, 1);
  fs.rmSync(root, { recursive: true, force: true });
});
