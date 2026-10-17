// workflow/scripts/view.mjs：按需求生成本地文档视图（单个静态 HTML，数据内嵌，只读）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { viewData, renderHtml } from '../workflow/scripts/view.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'view-'));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  const dir = 'skills-init/docs/requirements/订单导出';
  put(`${dir}/meta.json`, JSON.stringify({ name: '订单导出（按渠道）', named_by: 'user', branches: ['feature/export'] }));
  put(`${dir}/review.md`, '# 审查\n\n> 审查范围：分支对比 ｜ 日期：2026-10-15\n> 对比分支：`feature/export` ←→ `main`\n> DocNexus：未沉淀\n\n## 严重问题（CRITICAL / HIGH） *\n\n| # | 级别 | 位置 | 问题 | 触发条件 | 建议 | 复核 |\n|---|---|---|---|---|---|---|\n| 1 | HIGH | A.java:1 | 未分页 | 大渠道 | 分页 | ✅ |\n');
  put(`${dir}/delivery.md`, '# 交付\n\n> 类型：功能开发 ｜ 日期：2026-10-15\n> 对比分支：`feature/export` ←→ `main`\n> DocNexus：docnexus/library/dev-notes/export.md、docnexus/library/code-review/paging.md\n');
  put(`${dir}/review_v2.md`, '# 复审\n\n> 日期：2026-10-16\n> 对比分支：`feature/export` ←→ `main`\n> DocNexus：docnexus/library/code-review/paging.md\n\n## 与上次审查对比（如有）\n\n| 上次 # | 问题 | 状态 | 依据 |\n|---|---|---|---|\n| 1 | 未分页 | 已修复 | abc |\n');
  put(`${dir}/tech-doc.md`, '<!-- md-to-wiki: pageId=42 version=2 -->\n# 技术方案 </script><img src=x onerror=alert(1)>\n\n> 对比分支：`feature/export` ←→ `main`\n');
  return root;
}

test('viewData：按需求分组（用 meta.json 的名字）；审查带解析结果', () => {
  const root = project();
  const d = viewData(root);
  assert.equal(d.requirements.length, 1);
  const r = d.requirements[0];
  assert.equal(r.name, '订单导出（按渠道）');
  assert.deepEqual(r.branches, ['feature/export']);
  assert.deepEqual([r.stages.review, r.stages.tech, r.stages.plan], [2, 1, 0]);
  const [first, second] = r.artifacts.filter((a) => a.kind === 'review');
  assert.equal(first.review.levels.HIGH, 1);
  assert.equal(second.review.follow_up.fixed, 1);
  assert.equal(r.artifacts.find((a) => a.kind === 'tech').wiki.pageId, '42');
  assert.deepEqual(r.docnexus.map((k) => k.path), ['docnexus/library/dev-notes/export.md', 'docnexus/library/code-review/paging.md']);
  assert.deepEqual(r.docnexus[1].from.map((f) => f.file), ['delivery.md', 'review_v2.md'], '同一篇知识文档来自两份产物，去重后都列出');
  assert.deepEqual(d.knowledge.map((k) => k.path), ['docnexus/library/code-review/paging.md', 'docnexus/library/dev-notes/export.md']);
  assert.deepEqual(d.knowledge[0].sources.map((s) => [s.name, s.label]), [['订单导出（按渠道）', '交付说明'], ['订单导出（按渠道）', '审查报告']]);
  assert.equal(d.report.review.reports, 2);
  fs.rmSync(root, { recursive: true, force: true });
});

test('renderHtml：单文件、数据内嵌且转义（正文里的 </script> 不会截断页面）、带明暗主题', () => {
  const root = project();
  const html = renderHtml(viewData(root));
  assert.match(html, /^<!doctype html>/);
  assert.equal(html.match(/<\/script>/g).length, 2, '只有两个 script 结束标签');
  assert.ok(!html.includes('<img src=x'), '正文里的 HTML 在数据里被转义');
  assert.match(html, /prefers-color-scheme:dark/);
  assert.match(html, /<title>项目文档视图 · view-/);
  const json = /<script id="data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.equal(JSON.parse(json).requirements.length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('CLI：skills-init view 默认写到 skills-init/tmp/view/index.html，--out 指定位置；不改产物', () => {
  const root = project();
  const before = fs.readFileSync(path.join(root, 'skills-init/docs/requirements/订单导出/meta.json'), 'utf8');
  let r = spawnSync(process.execPath, [path.join(REPO, 'bin/skills-init.mjs'), 'view', '--project-root', root], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /已生成 skills-init\/tmp\/view\/index\.html（1 个需求，4 份产物）/);
  assert.ok(fs.existsSync(path.join(root, 'skills-init/tmp/view/index.html')));
  r = spawnSync(process.execPath, [path.join(REPO, 'workflow/scripts/view.mjs'), '--root', root, '--out', 'out/v.html'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.ok(fs.existsSync(path.join(root, 'out/v.html')));
  assert.equal(fs.readFileSync(path.join(root, 'skills-init/docs/requirements/订单导出/meta.json'), 'utf8'), before, '只读');
  assert.equal(spawnSync(process.execPath, [path.join(REPO, 'workflow/scripts/view.mjs'), '--bogus'], { encoding: 'utf8' }).status, 1);
  fs.rmSync(root, { recursive: true, force: true });
});
