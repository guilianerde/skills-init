// workflow/scripts/requirement.mjs：产物按需求归档（绑定分支、落盘路径与版本、meta.json、旧布局迁移、.ignore）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirName, parseFile, which, bind, nextPath, sync, migrate, ensureIgnore, list } from '../workflow/scripts/requirement.mjs';
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
  assert.deepEqual([r.ok, r.created, r.dir, r.named_by], [true, true, 'docs/skills/requirements/订单导出支持按渠道筛选', 'user']);
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
  assert.deepEqual([r3.name, r3.named_by, r3.dir], ['feature-coupon', 'branch', 'docs/skills/requirements/feature-coupon']);
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
  put('docs/skills/create-tech-md-doc/tech-doc_feature-order-export_20261001.md', doc('旧技术方案', b));
  const v = branchView(root, b);
  assert.equal(v.latest.review.path, `${dir}/review_v2.md`);
  assert.equal(v.latest.review.requirement, '订单导出');
  assert.equal(v.latest.tech.path, 'docs/skills/create-tech-md-doc/tech-doc_feature-order-export_20261001.md', '旧布局照常识别');
  assert.equal(collect(root).length, 4);
  fs.rmSync(root, { recursive: true, force: true });
});

test('migrate：旧布局按分支搬进需求目录（git mv 保留历史），需求名取交付 / 方案短名，没分支的留在原处', () => {
  const { root, git, put, cli } = repo();
  put('docs/skills/dev/plan-order-export-20261014.md', '# 方案\n\n> 规模：L ｜ 分支：feature/order-export ｜ 日期：2026-10-14\n');
  put('docs/skills/dev/delivery-order-export-20261015.md', doc('交付', 'feature/order-export'));
  put('docs/skills/project-review/review-feature-order-export-20261015.md', doc('审查', 'feature/order-export'));
  put('docs/skills/project-review/review-feature-order-export-20261016.md', doc('复审', 'feature/order-export'));
  put('docs/skills/create-tech-md-doc/tech-doc_feature-x_20261001.md', doc('技术', 'feature/x'));
  put('docs/skills/dev/plan-orphan-20261001.md', '# 没有分支\n');
  put('docs/skills/templates/dev/plan-template.md', '# 项目模板\n');
  git('add', '-A'); git('commit', '-q', '-m', 'docs');

  const dry = cli('migrate', '--dry-run').out;
  assert.equal(dry.moved, 0);
  assert.ok(fs.existsSync(path.join(root, 'docs/skills/dev/delivery-order-export-20261015.md')), 'dry-run 不动文件');

  const r = migrate(root);
  assert.equal(r.moved, 5);
  assert.deepEqual(r.left_in_place, ['docs/skills/dev/plan-orphan-20261001.md']);
  const dir = 'docs/skills/requirements/order-export';
  for (const f of ['plan.md', 'delivery.md', 'review.md', 'review_v2.md', 'meta.json']) assert.ok(fs.existsSync(path.join(root, dir, f)), f);
  assert.match(fs.readFileSync(path.join(root, dir, 'review_v2.md'), 'utf8'), /复审/, '按日期排版本');
  assert.ok(fs.existsSync(path.join(root, 'docs/skills/requirements/feature-x/tech-doc.md')));
  assert.ok(!fs.existsSync(path.join(root, 'docs/skills/project-review')), '搬空的旧目录删掉');
  assert.ok(fs.existsSync(path.join(root, 'docs/skills/templates/dev/plan-template.md')), '模板目录不动');
  assert.match(git('status', '--short').stdout, /^R {2}docs\/skills\/dev\/delivery-order-export-20261015\.md -> docs\/skills\/requirements\/order-export\/delivery\.md/m);
  const meta = JSON.parse(fs.readFileSync(path.join(root, dir, 'meta.json'), 'utf8'));
  assert.deepEqual([meta.name, meta.named_by, meta.branches], ['order-export', 'migrated', ['feature/order-export']]);
  assert.equal(migrate(root).moved, 0, '再跑一次没有可搬的');
  fs.rmSync(root, { recursive: true, force: true });
});

test('ensureIgnore：创建或追加一次，不重复', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ign-'));
  assert.equal(ensureIgnore(root), true);
  assert.equal(ensureIgnore(root), false);
  assert.equal(fs.readFileSync(path.join(root, '.ignore'), 'utf8').match(/docs\/skills\/requirements\//g).length, 1);
  fs.writeFileSync(path.join(root, '.ignore'), 'node_modules/\n');
  assert.equal(ensureIgnore(root), true);
  assert.match(fs.readFileSync(path.join(root, '.ignore'), 'utf8'), /^node_modules\/\n\n# skills-init/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('CLI：which / bind / path / sync；安装与升级时迁移旧产物并写 .ignore', () => {
  const { root, put, cli } = repo();
  assert.equal(cli('which').out.bound, false);
  assert.equal(cli('path', 'delivery').code, 2);
  assert.equal(cli('bind', '--name', '订单导出').code, 0);
  const p = cli('path', 'delivery').out.path;
  put(p, doc('交付', 'feature/order-export'));
  assert.equal(cli('sync', p).out.artifacts, 1);
  assert.equal(cli('sync', 'README.md').code, 1);
  assert.equal(cli('bogus').code, 1);

  put('docs/skills/project-review/review-feature-y-20261015.md', doc('审查', 'feature/y'));
  const r = spawnSync(process.execPath, [path.join(REPO, 'bin/skills-init.mjs'), '--project-root', root, '--envs', 'codex', '--skip-db', '--yes'], { cwd: root, encoding: 'utf8', env: { ...process.env, SKILLS_INIT_ADMIN: '1' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /产物已按需求归档：1 份 → docs\/skills\/requirements\/feature-y\//);
  assert.match(r.stdout, /\.ignore 已加上 docs\/skills\/requirements\//);
  assert.ok(fs.existsSync(path.join(root, 'docs/skills/requirements/feature-y/review.md')));
  assert.ok(fs.existsSync(path.join(root, '.agents/skills/workflow/scripts/requirement.mjs')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('migrate：文档里引用的旧路径改成新路径（含 dry-run 预告、之后合进来的文档按 meta.json 记录补改）', () => {
  const { root, put } = repo();
  const oldDelivery = 'docs/skills/dev/delivery-order-export-20261015.md';
  const oldPlan = 'docs/skills/dev/plan-order-export-20261014.md';
  put(oldPlan, '# 方案\n\n> 分支：feature/order-export ｜ 日期：2026-10-14\n');
  put(oldDelivery, doc('交付', 'feature/order-export').replace('## 结果', `> 参考产物：${oldPlan}\n\n## 结果`));
  put('docs/skills/project-review/review-feature-order-export-20261015.md', doc('审查', 'feature/order-export').replace('## 结果', `> 参考产物：${oldDelivery}、${oldPlan}\n\n## 结果`));
  put('docs/skills/dev/plan-orphan-20261001.md', `# 没有分支\n\n见 ${oldDelivery}\n`);

  const dry = migrate(root, { dryRun: true });
  assert.deepEqual(dry.rewritten.sort(), [oldDelivery, 'docs/skills/dev/plan-orphan-20261001.md', 'docs/skills/project-review/review-feature-order-export-20261015.md'].sort());
  assert.match(fs.readFileSync(path.join(root, oldDelivery), 'utf8'), /参考产物：docs\/skills\/dev\/plan-/, 'dry-run 不改文件');

  const r = migrate(root);
  const dir = 'docs/skills/requirements/order-export';
  assert.equal(r.rewritten.length, 3);
  assert.match(fs.readFileSync(path.join(root, dir, 'review.md'), 'utf8'), new RegExp(`参考产物：${dir}/delivery\\.md、${dir}/plan\\.md`));
  assert.match(fs.readFileSync(path.join(root, dir, 'delivery.md'), 'utf8'), new RegExp(`参考产物：${dir}/plan\\.md`));
  assert.match(fs.readFileSync(path.join(root, 'docs/skills/dev/plan-orphan-20261001.md'), 'utf8'), new RegExp(`见 ${dir}/delivery\\.md`), '留在原处的文档也改');
  const meta = JSON.parse(fs.readFileSync(path.join(root, dir, 'meta.json'), 'utf8'));
  assert.equal(meta.migrated_from['delivery.md'], oldDelivery);
  assert.equal(meta.artifacts.length, 3, 'sync 保留 migrated_from 的同时照常汇总');

  // 另一个分支后来合进来的新文档还引用旧路径：再跑一次 migrate 按 meta.json 的记录补改
  put(`${dir}/tech-doc.md`, doc('技术', 'feature/order-export').replace('## 结果', `> 参考产物：${oldDelivery}\n\n## 结果`));
  const again = migrate(root);
  assert.equal(again.moved, 0);
  assert.deepEqual(again.rewritten, [`${dir}/tech-doc.md`]);
  assert.match(fs.readFileSync(path.join(root, dir, 'tech-doc.md'), 'utf8'), new RegExp(`参考产物：${dir}/delivery\\.md`));
  assert.deepEqual(migrate(root).rewritten, [], '改完不再重复改');
  fs.rmSync(root, { recursive: true, force: true });
});
