// workflow/scripts/requirement.mjs：产物按需求归档（绑定分支、落盘路径与版本、meta.json、.ignore）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirName, parseFile, which, bind, nextPath, sync, ensureIgnore, list } from '../workflow/scripts/requirement.mjs';
import { collect, branchView } from '../workflow/scripts/artifacts.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = path.join(REPO, 'workflow/scripts/requirement.mjs');

function repo(branch = 'feature/order-export') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'req-'));
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

test('没绑定时 path 退出码 2 并给出建议名；bind 后给出路径，已有版本不覆盖，带上一版的 wiki 记录', () => {
  const { root, put } = repo();
  const b = 'feature/order-export';
  let w = which(root, b);
  assert.equal(w.bound, false);
  assert.equal(w.suggested_name, 'feature-order-export');
  assert.equal(nextPath(root, 'tech', b).code, 2);

  const r = bind(root, { name: '订单导出支持按渠道筛选', branch: b, base: 'main' });
  assert.deepEqual([r.ok, r.created, r.dir, r.named_by], [true, true, 'skills-init/docs/requirements/订单导出支持按渠道筛选', 'user']);
  let p = nextPath(root, 'tech', b).out;
  assert.equal(p.path, `${r.dir}/tech-doc.md`);
  put(p.path, doc('技术方案', b, '<!-- md-to-wiki: pageId=42 version=3 -->\n'));
  p = nextPath(root, 'tech', b).out;
  assert.equal(p.path, `${r.dir}/tech-doc_v2.md`);
  assert.equal(p.previous, `${r.dir}/tech-doc.md`);
  assert.equal(p.wiki_record, '<!-- md-to-wiki: pageId=42 version=3 -->');
  assert.equal(nextPath(root, 'nope', b).code, 1);

  // 同一个名字在另一个分支上 bind：挂到同一需求
  const r2 = bind(root, { name: '订单导出支持按渠道筛选', branch: 'fix/export-npe' });
  assert.equal(r2.created, false);
  assert.deepEqual(r2.branches, ['feature/order-export', 'fix/export-npe']);
  assert.equal(which(root, 'fix/export-npe').dir, r.dir);
  // 不给名字按分支名生成
  const r3 = bind(root, { branch: 'feature/coupon' });
  assert.deepEqual([r3.name, r3.named_by, r3.dir], ['feature-coupon', 'branch', 'skills-init/docs/requirements/feature-coupon']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('sync：meta.json 汇总产物、最新版本、wiki 与 DocNexus；内容不变时不重写', () => {
  const { root, put } = repo();
  const b = 'feature/order-export';
  const { dir } = bind(root, { name: '订单导出', branch: b });
  put(`${dir}/delivery.md`, doc('交付', b).replace('## 结果', '> DocNexus：docnexus/library/dev/order.md\n\n## 结果'));
  put(`${dir}/review.md`, doc('审查', b));
  put(`${dir}/review_v2.md`, doc('审查', b));
  put(`${dir}/tech-doc.md`, doc('技术', b, '<!-- md-to-wiki: pageId=42 version=3 url=https://wiki/x -->\n'));
  put(`${dir}/notes.md`, '随手记\n');
  const m = sync(root, dir);
  assert.deepEqual(m.latest, { plan: null, delivery: 'delivery.md', review: 'review_v2.md', tech: 'tech-doc.md', release: null });
  assert.equal(m.artifacts.length, 4, 'notes.md 不是产物');
  assert.deepEqual(m.artifacts.find((a) => a.kind === 'tech').wiki, { pageId: '42', version: 3, url: 'https://wiki/x', at: null });
  assert.deepEqual(m.artifacts.find((a) => a.kind === 'delivery').docnexus, ['docnexus/library/dev/order.md']);
  assert.equal(m.artifacts[0].date, '2026-10-15');
  const f = path.join(root, dir, 'meta.json');
  const before = fs.readFileSync(f, 'utf8');
  const t = fs.statSync(f).mtimeMs;
  sync(root, dir);
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
  assert.equal(fs.readFileSync(path.join(root, '.ignore'), 'utf8').match(/^skills-init\/docs\/$/gm).length, 1);
  fs.writeFileSync(path.join(root, '.ignore'), 'node_modules/\n');
  assert.equal(ensureIgnore(root), true);
  assert.match(fs.readFileSync(path.join(root, '.ignore'), 'utf8'), /^node_modules\/\n\n# skills-init/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('CLI：which / bind / path / sync；安装时写 .ignore', () => {
  const { root, put, cli } = repo();
  assert.equal(cli('which').out.bound, false);
  assert.equal(cli('path', 'delivery').code, 2);
  assert.equal(cli('bind', '--name', '订单导出').code, 0);
  const p = cli('path', 'delivery').out.path;
  put(p, doc('交付', 'feature/order-export'));
  assert.equal(cli('sync', p).out.artifacts, 1);
  assert.equal(cli('sync', 'README.md').code, 1);
  assert.equal(cli('bogus').code, 1);

  const r = spawnSync(process.execPath, [path.join(REPO, 'bin/skills-init.mjs'), '--project-root', root, '--envs', 'codex', '--skip-db', '--yes'], { cwd: root, encoding: 'utf8', env: { ...process.env, SKILLS_INIT_ADMIN: '1' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\.ignore 已加上 skills-init\/docs\//);
  assert.ok(fs.existsSync(path.join(root, '.agents/skills/workflow/scripts/requirement.mjs')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('日期取文档头，跳过第一行 md-to-wiki 发布记录里的 at=（meta.json 与 artifacts.mjs 一致）', () => {
  const { root, put } = repo();
  const b = 'feature/order-export';
  const { dir } = bind(root, { name: '订单导出', branch: b });
  put(`${dir}/tech-doc.md`, doc('技术', b, '<!-- md-to-wiki: pageId=42 version=3 at=2026-10-20T08:00:00Z -->\n'));
  assert.equal(sync(root, dir).artifacts[0].date, '2026-10-15');
  assert.match(collect(root)[0].date, /^2026-10-15#/);
  fs.rmSync(root, { recursive: true, force: true });
});
