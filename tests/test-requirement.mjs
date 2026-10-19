// workflow/scripts/requirement.mjs：产物按需求归档（绑定分支、落盘路径与版本、meta.json、.ignore）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirName, parseFile, which, bind, nextPath, sync, ensureIgnore, list, legacyRequirements, migrateLayout } from '../workflow/scripts/requirement.mjs';
import { collect, branchView } from '../workflow/scripts/artifacts.mjs';

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

test('没绑定时 path 退出码 2 并给出建议名；bind 后给出路径，已有版本不覆盖，带上一版的 wiki 记录', () => {
  const { root, put } = repo();
  const b = 'feature/order-export';
  let w = which(root, b);
  assert.equal(w.bound, false);
  assert.equal(w.suggested_name, 'feature-order-export');
  assert.equal(nextPath(root, 'tech', b).code, 2);

  const r = bind(root, { name: '订单导出支持按渠道筛选', branch: b, base: 'main' });
  assert.deepEqual([r.ok, r.created, r.dir, r.named_by], [true, true, 'workflow-run/docs/requirements/订单导出支持按渠道筛选/svc', 'user']);
  let p = nextPath(root, 'tech', b).out;
  assert.equal(p.path, `${r.dir}/tech-doc.md`);
  put(p.path, doc('技术方案', b, '<!-- md-to-wiki: pageId=42 version=3 -->\n'));
  p = nextPath(root, 'tech', b).out;
  assert.deepEqual([p.path, p.version], [`${r.dir}/tech-doc.md`, 2], '文件名固定，版本号加一');
  assert.equal(p.previous, 'workflow-run/tmp/old-artifacts/订单导出支持按渠道筛选/svc/tech-doc_v1.md');
  assert.equal(fs.readFileSync(path.join(root, p.previous), 'utf8'), fs.readFileSync(path.join(root, p.path), 'utf8'), '上一版先复制一份');
  assert.equal(p.wiki_record, '<!-- md-to-wiki: pageId=42 version=3 -->');
  assert.equal(nextPath(root, 'nope', b).code, 1);

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
  assert.equal(fs.readFileSync(path.join(root, '.ignore'), 'utf8').match(/^workflow-run\/docs\/$/gm).length, 1);
  fs.writeFileSync(path.join(root, '.ignore'), 'node_modules/\n');
  assert.equal(ensureIgnore(root), true);
  assert.match(fs.readFileSync(path.join(root, '.ignore'), 'utf8'), /^node_modules\/\n\n# workflow-run/);
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
  assert.equal(sync(root, dir).artifacts[0].date, '2026-10-15');
  assert.match(collect(root)[0].date, /^2026-10-15#/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('sync <path>：文件名固定、只留最新版；上一版归档为 <种类>_v<N>.md 并提示；没写新内容不算新版本', () => {
  const { root, put, cli } = repo();
  assert.equal(cli('bind', '--name', '订单导出').code, 0);
  const b = 'feature/order-export';
  const OLD = 'workflow-run/tmp/old-artifacts/订单导出/svc';
  const write = (kind, title) => { const p = cli('path', kind).out; put(p.path, doc(title, b)); return p; };
  let p = write('review', '审查 1');
  let s = cli('sync', p.path).out;
  assert.equal(s.archived, undefined, '第一版不归档');
  assert.deepEqual(s.versions, {});
  write('tech', '技术方案');
  p = write('review', '审查 2');
  assert.deepEqual([p.path, p.version, p.previous], [`${s.dir}/review.md`, 2, `${OLD}/review_v1.md`]);
  assert.match(fs.readFileSync(path.join(root, p.previous), 'utf8'), /审查 1/, 'previous 是上次报告，复审对照它');
  s = cli('sync', p.path).out;
  assert.deepEqual(s.archived.files, [{ kind: 'review', version: 1, file: `${OLD}/review_v1.md` }]);
  assert.equal(s.archived.dir, OLD);
  assert.match(s.archived.hint, /不要替用户删/);
  assert.deepEqual(s.versions, { review: 2 });
  assert.deepEqual(fs.readdirSync(path.join(root, s.dir)).sort(), ['meta.json', 'review.md', 'tech-doc.md']);
  assert.equal(cli('sync', p.path).out.archived, undefined, '再 sync 不重复归档');

  // 拿了路径却没写：版本号不变，下次照样从 v2 归档
  cli('path', 'review');
  s = cli('sync', p.path).out;
  assert.deepEqual([s.archived, s.versions.review], [undefined, 2]);
  p = write('review', '审查 3');
  assert.equal(p.previous, `${OLD}/review_v2.md`);
  s = cli('sync', p.path).out;
  assert.deepEqual([s.versions.review, s.archived.files[0].file], [3, `${OLD}/review_v2.md`]);
  assert.deepEqual(fs.readdirSync(path.join(root, OLD)).sort(), ['review_v1.md', 'review_v2.md']);
  // 视图与链路读到的是目录里的最新版和它的版本号
  const v = branchView(root, b);
  assert.deepEqual([v.latest.review.path, v.latest.review.version], [`${s.dir}/review.md`, 3]);
  fs.rmSync(root, { recursive: true, force: true });
});

test('旧结构迁移：<需求>/ 下直接放的文件挪到 <需求>/<项目名>/，被跟踪的用 git mv，归档的上一版一起挪；目标里有同名文件时跳过', () => {
  const { root, put, git } = repo();
  const REQ = 'workflow-run/docs/requirements';
  put(`${REQ}/订单导出/review.md`, doc('审查', 'feature/order-export'));
  put(`${REQ}/订单导出/meta.json`, JSON.stringify({ name: '订单导出', branches: ['feature/order-export'] }));
  put('workflow-run/tmp/old-artifacts/订单导出/review_v1.md', '旧版');
  put(`${REQ}/支付/plan.md`, doc('方案', 'feature/pay'));
  put(`${REQ}/支付/svc/plan.md`, '已有');
  put(`${REQ}/新结构/svc/plan.md`, '新');
  git('add', '-A'); git('commit', '-q', '-m', 'old layout');
  assert.deepEqual(legacyRequirements(root).sort(), ['支付', '订单导出']);

  const r = migrateLayout(root);
  assert.equal(r.project, 'svc');
  assert.deepEqual(r.moved.map((m) => m.to).sort(), [`${REQ}/订单导出/svc/meta.json`, `${REQ}/订单导出/svc/review.md`]);
  assert.deepEqual(r.skipped.map((x) => x.dir), [`${REQ}/支付`], '目标里已有 plan.md');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, REQ, '订单导出/svc/meta.json'), 'utf8')).project, 'svc');
  assert.ok(fs.existsSync(path.join(root, 'workflow-run/tmp/old-artifacts/订单导出/svc/review_v1.md')), '归档跟着挪');
  assert.match(git('-c', 'core.quotePath=false', 'status', '--porcelain').stdout, /^R  .*订单导出\/review\.md -> .*订单导出\/svc\/review\.md$/m, 'git mv 保留历史');
  assert.equal(which(root, 'feature/order-export').dir, `${REQ}/订单导出/svc`, '迁移后照常找到');
  assert.deepEqual(legacyRequirements(root), ['支付']);
  assert.deepEqual(migrateLayout(root).moved, [], '再跑不重复');
  fs.rmSync(path.dirname(root), { recursive: true, force: true });
});
