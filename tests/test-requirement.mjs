// workflow/scripts/requirement.mjs：产物按需求归档（绑定分支、落盘路径与版本、meta.json、.ignore）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { useLocalDocNexus } from './helpers/docnexus-pkg.mjs';
import { dirName, parseFile, ensureIgnore, list } from '../workflow/scripts/requirement.mjs';
import { which, bind, reindex, reindexRequirement } from '../workflow/lib/requirements.mjs';
import { collect, branchView } from '../workflow/scripts/artifacts.mjs';

useLocalDocNexus();

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = path.join(REPO, 'workflow/scripts/requirement.mjs');

function repo(branch = 'feature/order-export') {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'req-')), 'svc'); fs.mkdirSync(root); // 目录名 svc = 自动取的项目名
  const git = (...a) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: root, encoding: 'utf8' });
  git('init', '-q'); git('commit', '-q', '--allow-empty', '-m', 'init'); git('branch', '-M', 'main'); git('checkout', '-q', '-b', branch);
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  const cli = (...a) => { const r = spawnSync(process.execPath, [SCRIPT, '--root', root, ...a], { encoding: 'utf8' }); return { code: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr }; };
  return { root, git, put, cli };
}
const doc = (title, branch, extra = '') => `${extra}# ${title}\n\n> 日期：2026-10-15\n> 对比分支：\`${branch}\` ←→ \`main\`\n\n## 结果\n\nok\n`;

test('dirName：保留中文，去掉路径与非法字符；parseFile 认出种类与版本', () => {
  assert.equal(dirName('订单导出 / 按渠道筛选'), '订单导出-按渠道筛选');
  assert.equal(dirName('  a:b*c?  '), 'a-b-c');
  assert.equal(dirName('...'), 'unnamed');
  assert.equal([...dirName('长'.repeat(100))].length, 60);
  assert.deepEqual(parseFile('review_v3.md'), { kind: 'review', version: 3 });
  assert.deepEqual(parseFile('tech-doc.md'), { kind: 'tech', version: 1 });
  assert.equal(parseFile('meta.json'), null);
  assert.equal(parseFile('notes.md'), null);
});

test('没绑定时给出建议名；bind 后返回同一需求目录，同名需求可绑定多个分支', () => {
  const { root, put } = repo();
  const b = 'feature/order-export';
  let w = which(root, b);
  assert.equal(w.bound, false);
  assert.equal(w.suggested_name, 'feature-order-export');

  const r = bind(root, { name: '订单导出支持按渠道筛选', branch: b, base: 'main' });
  assert.deepEqual([r.ok, r.created, r.dir, r.named_by], [true, true, 'workflow-run/docs/requirements/订单导出支持按渠道筛选/svc', 'user']);
  assert.equal(which(root, b).dir, r.dir);

  // 同一个名字在另一个分支上 bind：挂到同一需求
  const r2 = bind(root, { name: '订单导出支持按渠道筛选', branch: 'fix/export-npe' });
  assert.equal(r2.created, false);
  assert.deepEqual(r2.branches, ['feature/order-export', 'fix/export-npe']);
  assert.equal(which(root, 'fix/export-npe').dir, r.dir);
  // 不给名字按分支名生成
  const r3 = bind(root, { branch: 'feature/coupon' });
  assert.deepEqual([r3.name, r3.named_by, r3.dir], ['feature-coupon', 'branch', 'workflow-run/docs/requirements/feature-coupon/svc']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('reindex：meta.json 汇总产物、wiki 与 DocNexus；只刷新派生索引', () => {
  const { root, put } = repo();
  const b = 'feature/order-export';
  const { dir } = bind(root, { name: '订单导出', branch: b });
  put(`${dir}/delivery.md`, doc('交付', b).replace('## 结果', '> DocNexus：docnexus/library/dev/order.md\n\n## 结果'));
  put(`${dir}/review.md`, doc('审查', b));
  put(`${dir}/review_v2.md`, doc('审查', b));
  put(`${dir}/tech-doc.md`, doc('技术', b, '<!-- md-to-wiki: pageId=42 version=3 url=https://wiki/x -->\n'));
  put(`${dir}/notes.md`, '随手记\n');
  const m = reindexRequirement(root, dir);
  assert.deepEqual(m.latest, { clarification: null, requirement: null, plan: null, delivery: 'delivery.md', review: 'review_v2.md', tech: 'tech-doc.md', release: null });
  assert.equal(m.artifacts.length, 4, 'notes.md 不是产物');
  assert.deepEqual(m.artifacts.find((a) => a.kind === 'tech').wiki, { pageId: '42', version: 3, url: 'https://wiki/x', at: null });
  assert.deepEqual(m.artifacts.find((a) => a.kind === 'delivery').docnexus, ['docnexus/library/dev/order.md']);
  assert.equal(m.artifacts[0].date, '2026-10-15');
  assert.deepEqual(m.unregistered.map(({ kind }) => kind).sort(), ['delivery', 'review', 'tech']);
  assert.ok(m.indexed_at);
  const f = path.join(root, dir, 'meta.json');
  const before = fs.readFileSync(f, 'utf8');
  const t = fs.statSync(f).mtimeMs;
  reindexRequirement(root, dir);
  assert.equal(fs.readFileSync(f, 'utf8'), before);
  assert.equal(fs.statSync(f).mtimeMs, t, '没变化不写文件');
  assert.equal(list(root)[0].artifacts, 4);
  fs.rmSync(root, { recursive: true, force: true });
});

test('artifacts.mjs 识别需求目录：按分支归组、标出需求、按日期与版本排序', () => {
  const { root, put } = repo();
  const b = 'feature/order-export';
  const { dir } = bind(root, { name: '订单导出', branch: b });
  put(`${dir}/review.md`, doc('审查', b));
  put(`${dir}/review_v2.md`, doc('审查', b));
  put(`${dir}/delivery.md`, doc('交付', b));
  put(`${dir}/tech-doc.md`, doc('技术方案', b));
  const v = branchView(root, b);
  assert.equal(v.latest.review.path, `${dir}/review_v2.md`);
  assert.equal(v.latest.review.requirement, '订单导出');
  assert.equal(v.latest.tech.path, `${dir}/tech-doc.md`);
  assert.equal(collect(root).length, 4);
  fs.rmSync(root, { recursive: true, force: true });
});

test('ensureIgnore：创建或追加一次，不重复', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ign-'));
  assert.equal(ensureIgnore(root), true);
  assert.equal(ensureIgnore(root), false);
  assert.equal(fs.readFileSync(path.join(root, '.ignore'), 'utf8').match(/^workflow-run\/docs\/$/gm).length, 1);
  fs.writeFileSync(path.join(root, '.ignore'), 'node_modules/\n');
  assert.equal(ensureIgnore(root), true);
  assert.match(fs.readFileSync(path.join(root, '.ignore'), 'utf8'), /^node_modules\/\n\n# workflow-run/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('CLI：which / bind / reindex；旧 path / sync 入口已删除并安装 .ignore', () => {
  const { root, put, cli } = repo();
  assert.equal(cli('which').out.bound, false);
  assert.equal(cli('path', 'delivery').code, 1);
  assert.equal(cli('sync').code, 1);
  assert.equal(cli('bind', '--name', '订单导出').code, 0);
  const p = 'workflow-run/docs/requirements/订单导出/svc/delivery.md';
  put(p, doc('交付', 'feature/order-export'));
  const indexed = cli('reindex').out;
  assert.equal(indexed.artifacts, 1);
  assert.deepEqual(indexed.unregistered, [{ kind: 'delivery', file: 'delivery.md' }]);
  assert.equal(cli('bogus').code, 1);

  const r = spawnSync(process.execPath, [path.join(REPO, 'bin/workflow-run.mjs'), '--project-root', root, '--envs', 'codex', '--skip-db', '--yes'], { cwd: root, encoding: 'utf8', env: { ...process.env, WORKFLOW_RUN_ADMIN: '1' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\.ignore 已加上 workflow-run\/docs\//);
  assert.ok(fs.existsSync(path.join(root, '.agents/skills/workflow/scripts/requirement.mjs')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('日期取文档头，跳过第一行 md-to-wiki 发布记录里的 at=（meta.json 与 artifacts.mjs 一致）', () => {
  const { root, put } = repo();
  const b = 'feature/order-export';
  const { dir } = bind(root, { name: '订单导出', branch: b });
  put(`${dir}/tech-doc.md`, doc('技术', b, '<!-- md-to-wiki: pageId=42 version=3 at=2026-10-20T08:00:00Z -->\n'));
  assert.equal(reindexRequirement(root, dir).artifacts[0].date, '2026-10-15');
  assert.match(collect(root)[0].date, /^2026-10-15#/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('reindex：不提升权威版本、不改运行和证据，未知版本只报告为未登记', () => {
  const { root, put, cli } = repo();
  assert.equal(cli('bind', '--name', '订单导出').code, 0);
  const b = 'feature/order-export';
  const dir = 'workflow-run/docs/requirements/订单导出/svc';
  put(`${dir}/review.md`, doc('审查 2', b));
  const file = path.join(root, dir, 'meta.json');
  const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
  meta.versions = { review: 2 };
  meta.runs = { keep: { id: 'keep', revision: 7, evidence: { digest: 'abc' } } };
  meta.approval = { confirmed: true };
  meta.updated = '2026-10-01T00:00:00.000Z';
  fs.writeFileSync(file, `${JSON.stringify(meta, null, 2)}\n`);

  const first = cli('reindex').out;
  assert.deepEqual(first.versions, { review: 2 });
  assert.equal(first.artifacts, 1);
  assert.equal(first.unregistered.length, 0);
  const indexed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(indexed.runs, meta.runs);
  assert.deepEqual(indexed.approval, meta.approval);
  assert.equal(indexed.updated, meta.updated, 'reindex 不覆盖正文更新时间');
  assert.ok(indexed.indexed_at);
  assert.equal(fs.existsSync(path.join(root, 'workflow-run/tmp/old-artifacts')), false);

  put(`${dir}/review.md`, doc('审查 3', b).replace('2026-10-15', '2026-10-16'));
  const second = cli('reindex').out;
  assert.deepEqual(second.versions, { review: 2 }, 'reindex 不能提升版本');
  assert.equal(fs.existsSync(path.join(root, 'workflow-run/tmp/old-artifacts')), false, 'reindex 不归档');
  assert.equal(branchView(root, b).latest.review.version, 2);
  fs.rmSync(root, { recursive: true, force: true });
});

test('旧结构迁移入口已删除，不再由新版本自动移动用户历史目录', async () => {
  const module = await import('../workflow/scripts/requirement.mjs');
  assert.equal(module.legacyRequirements, undefined);
  assert.equal(module.migrateLayout, undefined);
});
