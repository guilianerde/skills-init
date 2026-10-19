// workflow/scripts/artifacts.mjs：从 workflow-run/docs/requirements/ 下的产物按分支归组，给出最新一份、wiki 记录与下一步
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseBranch } from '../workflow/scripts/artifacts.mjs';

const SCRIPT = fileURLToPath(new URL('../workflow/scripts/artifacts.mjs', import.meta.url));

function project() {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-')), 'svc'); fs.mkdirSync(root); // 目录名 svc = 自动取的项目名
  spawnSync('git', ['init', '-q', '-b', 'feature/pay'], { cwd: root });
  const put = (rel, text, mtime) => {
    const [req, ...rest] = rel.split('/');
    const f = path.join(root, 'workflow-run', 'docs', 'requirements', req, 'svc', ...rest);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
    if (mtime) fs.utimesSync(f, mtime / 1000, mtime / 1000);
  };
  const run = (...args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8' }); return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr }; };
  return { root, put, run };
}

test('parseBranch：对比分支取开发分支，模板占位符不算', () => {
  assert.equal(parseBranch('# 技术方案\n> 对比分支：`feature/a` ←→ `main`'), 'feature/a');
  assert.equal(parseBranch('# 方案\n> 规模：M ｜ 分支：feature/b ｜ 日期：2026-10-15'), 'feature/b');
  assert.equal(parseBranch('> 规模：{{M / L}} ｜ 分支：{{dev分支}}'), null);
  assert.equal(parseBranch('<!-- md-to-wiki: pageId=1 -->\n# 报告\n> 审查范围：x ｜ 分支：`fix/c` ←→ `main`'), 'fix/c');
});

test('按当前分支归组：最新一份、wiki 记录、下一步建议；其他分支不混入', () => {
  const { root, put, run } = project();
  const t0 = Date.parse('2026-10-15T00:00:00Z');
  put('pay/plan.md', '# 方案\n> 规模：L ｜ 分支：feature/pay ｜ 日期：2026-10-14\n');
  put('pay/tech-doc.md', '# 技术方案\n> 对比分支：`feature/pay` ←→ `main`\n', t0);
  put('pay/tech-doc_v2.md', '<!-- md-to-wiki: pageId=99 version=3 at=2026-10-15T01:00:00Z -->\n# 技术方案\n> 对比分支：`feature/pay` ←→ `main`\n', t0);
  put('other/tech-doc.md', '# 技术方案\n> 对比分支：`feature/other` ←→ `main`\n');
  let r = run();
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out.branch, 'feature/pay');
  assert.equal(r.out.artifacts.length, 3);
  assert.equal(r.out.latest.tech.path, 'workflow-run/docs/requirements/pay/svc/tech-doc_v2.md');
  assert.deepEqual([r.out.latest.tech.wiki.pageId, r.out.latest.tech.wiki.version], ['99', 3]);
  assert.equal(r.out.latest.review, null);
  assert.ok(r.out.next.some((s) => s.startsWith('project-review')));
  assert.ok(r.out.next.some((s) => s.includes('自动引用 workflow-run/docs/requirements/pay/svc/tech-doc_v2.md')));
  assert.ok(!r.out.next.some((s) => s.startsWith('create-tech-md-doc')));
  assert.ok(!r.out.next.some((s) => s.includes('tech-doc') && s.startsWith('md-to-wiki')));
  assert.ok(!r.out.next.some((s) => s.includes('pr-desc')), '没有交付说明和审查报告时不建议提 PR');
  // 发布后又改过 → 建议重新发布到同一页面
  put('pay/tech-doc_v2.md', fs.readFileSync(path.join(root, 'workflow-run/docs/requirements/pay/svc/tech-doc_v2.md'), 'utf8'), Date.parse('2026-10-15T02:00:00Z'));
  assert.ok(run().out.next.some((s) => s.includes('重新发布到 pageId 99')));
  r = run('--all');
  assert.deepEqual(r.out.branches.map((b) => b.branch), ['feature/other', 'feature/pay']);
  assert.equal(run('--branch', 'feature/other').out.artifacts.length, 1);
  assert.equal(run('--bogus').status, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('审查报告模板的元信息：取对比分支里的开发分支，不被「审查范围：分支对比」误导', () => {
  const head = '# 代码审查报告 — feature-x\n\n> 审查范围：分支对比：feature/x 合并前 ｜ 日期：2026-10-15\n> 对比分支：`feature/x` ←→ `main`\n> 审查方式：全量精读\n> 参考产物：无\n';
  assert.equal(parseBranch(head), 'feature/x');
  const tpl = fs.readFileSync(fileURLToPath(new URL('../project-review/references/report.md.tpl', import.meta.url)), 'utf8');
  assert.equal(parseBranch(tpl), null, '未填写的模板不算任何分支');
});

test('交付说明按对比分支归到 latest.delivery，与开发方案分开', () => {
  const { root, put, run } = project();
  put('pay/plan.md', '# 方案\n> 规模：L ｜ 分支：feature/pay ｜ 日期：2026-10-14\n');
  put('pay/delivery.md', '# 开发交付 — 支付回调幂等\n\n> 类型：功能开发 ｜ 规模：L ｜ 日期：2026-10-15\n> 对比分支：`feature/pay` ←→ `main`\n> 参考产物：workflow-run/docs/requirements/pay/svc/plan.md\n> DocNexus：未沉淀\n');
  put('other/delivery.md', '# 开发交付 — 别的需求\n\n> 类型：缺陷修复 ｜ 规模：S ｜ 日期：2026-10-15\n> 对比分支：`fix/other` ←→ `main`\n');
  const r = run();
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out.latest.delivery.path, 'workflow-run/docs/requirements/pay/svc/delivery.md');
  assert.equal(r.out.latest.delivery.label, '交付说明');
  assert.equal(r.out.latest.plan.path, 'workflow-run/docs/requirements/pay/svc/plan.md');
  assert.ok(r.out.next.some((s) => s.startsWith('提 PR / MR') && s.includes('pr-desc.mjs')));
  const tpl = fs.readFileSync(fileURLToPath(new URL('../dev/references/delivery-template.md', import.meta.url)), 'utf8');
  assert.equal(parseBranch(tpl), null, '未填写的交付模板不算任何分支');
  fs.rmSync(root, { recursive: true, force: true });
});
