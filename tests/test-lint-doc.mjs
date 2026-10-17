// workflow/scripts/lint-doc.mjs：章节、占位符、元信息检查；模板来源跟随 resolve 规则
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lint, headingKey, extractRefs, checkRefs, diffRange } from '../workflow/scripts/lint-doc.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const TPL = `# 【技术方案】<在此填写需求标题>
> **自动生成** by x | 生成时间：{{t}}
## 1. 需求背景 *
## 2. 影响范围 *
### 2.1 接口
### 2.2 Redis 变更（如有）
\`\`\`
## 不是标题
\`\`\`
## 3. 兼容问题
### 3.x PRD 对齐缺口（如有 PRD，Step 2b 校验）
`;

test('headingKey 去掉编号、必填与可选标记', () => {
  assert.equal(headingKey('1. 需求背景 *'), '需求背景');
  assert.equal(headingKey('一、开发部分'), '开发部分');
  assert.equal(headingKey('4.1 HTTP 接口'), 'HTTP接口');
  assert.equal(headingKey('8.x PRD 对齐缺口（如有 PRD，Step 2b 校验）'), 'PRD对齐缺口');
});

test('完整文档通过；可选章节缺失不报', () => {
  const doc = `# 【技术方案】订单导出\n> **自动生成** by x\n> 模板来源：skill 默认\n## 1. 需求背景\n待补充\n## 2. 影响范围\n### 2.1 接口\n## 3. 兼容问题\n无\n`;
  const r = lint(doc, TPL, { requiredMeta: ['自动生成', '模板来源'] });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.todos.map((t) => t.line), [5]);
});

test('缺必填章节、残留占位符、缺元信息为错误；缺普通章节与顺序错乱为警告', () => {
  const doc = `# 【技术方案】<在此填写需求标题>\n## 3. 兼容问题\n## 2. 影响范围\n值：{{value}}\n\`\`\`sql\n-- {{ddl}}\n\`\`\`\n`;
  const r = lint(doc, TPL, { requiredMeta: ['模板来源'] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('缺少必填章节「1. 需求背景」')));
  assert.ok(r.errors.some((e) => e.includes('第 1 行未替换')));
  assert.ok(r.errors.some((e) => e.includes('第 4 行残留模板占位符')));
  assert.ok(r.errors.some((e) => e.includes('第 6 行残留模板占位符')), '代码块里的占位符也要报');
  assert.ok(r.errors.some((e) => e.includes('缺少元信息行「> 模板来源')));
  assert.ok(r.warnings.some((w) => w.includes('2.1 接口')));
  assert.ok(r.warnings.some((w) => w.includes('章节顺序')));
  assert.ok(!r.warnings.some((w) => w.includes('不是标题')));
});

test('CLI：按项目模板检查，原样的骨架报错；技术方案没有模板时退出 2；已接入 DocNexus 时改用知识库模板', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lintdoc-'));
  assert.equal(spawnSync(process.execPath, [path.join(REPO, 'bin/workflow-run.mjs'), '--project-root', root, '--envs', 'codex', '--skip-db', '--yes'], { encoding: 'utf8' }).status, 0);
  const cli = (...a) => spawnSync(process.execPath, [path.join(root, '.agents/skills/workflow/scripts/lint-doc.mjs'), ...a], { cwd: root, encoding: 'utf8' });
  const TEAM = '# 【技术方案】{{文档标题}}\n\n## 1. 需求背景 *\n\n{{需求背景}}\n\n## 2. 影响范围 *\n\n{{影响范围}}\n';
  fs.writeFileSync(path.join(root, 'raw.md'), TEAM);
  let r = cli('raw.md', '--skill', 'create-tech-md-doc', '--json');
  assert.equal(r.status, 2, '技术方案模板不随 skills 提供，没创建时停下');
  fs.mkdirSync(path.join(root, 'workflow-run/templates/create-tech-md-doc'), { recursive: true });
  fs.writeFileSync(path.join(root, 'workflow-run/templates/create-tech-md-doc/template.md'), TEAM);
  r = cli('raw.md', '--skill', 'create-tech-md-doc', '--json');
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.source, 'project');
  assert.ok(out.errors.some((e) => e.includes('模板来源')));
  assert.equal(cli('raw.md', '--skill', 'database-query').status, 3, '没有带 lint 的模板');
  // 审查报告：原样的模板报占位符；按模板写完的报告通过，缺元信息行与必填章节报错
  fs.copyFileSync(path.join(REPO, 'project-review/references/report.md.tpl'), path.join(root, 'review-raw.md'));
  r = cli('review-raw.md', '--skill', 'project-review', '--json');
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(r.stdout).template, '.agents/skills/project-review/references/report.md');
  const review = ['# 代码审查报告 — feature-x', '> 审查范围：分支对比 ｜ 日期：2026-10-15', '> 对比分支：`feature-x` ←→ `main`', '> 审查方式：全量精读 ｜ 清单来源：skill 默认',
    '## 结论摘要', '可合并。', '## 严重问题（CRITICAL / HIGH）', '无', '## 一般问题（MEDIUM）', '无', '## 优化建议（LOW）', '无', '## 影响面', '无', '## 未覆盖与待确认', '无', ''].join('\n');
  fs.writeFileSync(path.join(root, 'review.md'), review);
  r = cli('review.md', '--skill', 'project-review', '--json');
  assert.equal(r.status, 0, r.stdout);
  assert.deepEqual(JSON.parse(r.stdout).warnings, [], '首次审查、没有方案时省略「与上次审查对比」「需求对照」不算缺章节');
  fs.writeFileSync(path.join(root, 'review.md'), review.replace(/> 审查方式.*\n/, '').replace('## 未覆盖与待确认\n无\n', ''));
  r = cli('review.md', '--skill', 'project-review', '--json');
  assert.equal(r.status, 1);
  const errs = JSON.parse(r.stdout).errors;
  assert.ok(errs.some((e) => e.includes('审查方式')) && errs.some((e) => e.includes('未覆盖与待确认')), errs.join('\n'));
  fs.mkdirSync(path.join(root, 'workflow-run/docnexus/library/templates/create-tech-md-doc'), { recursive: true });
  fs.mkdirSync(path.join(root, 'workflow-run/docnexus/node_modules/.bin'), { recursive: true });
  for (const f of ['project.json', 'node_modules/.bin/docnexus', 'node_modules/.bin/docnexus.cmd']) fs.writeFileSync(path.join(root, 'workflow-run/docnexus', f), '{}');
  r = cli('raw.md', '--skill', 'create-tech-md-doc');
  assert.equal(r.status, 2, '缺知识库模板时不回退默认模板');
  fs.writeFileSync(path.join(root, 'workflow-run/docnexus/library/templates/create-tech-md-doc/template.md'), '# 团队模板\n## 背景 *\n## 方案 *\n');
  fs.writeFileSync(path.join(root, 'doc.md'), '# 订单导出\n> **自动生成** by x\n> 对比分支：a\n> diff 概览：1 file\n> 模板来源：DocNexus\n## 背景\n## 方案\n');
  r = cli('doc.md', '--skill', 'create-tech-md-doc');
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /docnexus/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('--facts：类名 / 文件 / 接口 / 表名在 diff 或 head 代码里找不到的记为未核实', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'facts-'));
  const g = (...a) => { const r = spawnSync('git', a, { cwd: root, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
  const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 't');
  w('src/order/OrderService.java', 'class OrderService { /* select * from T_ORDER */ }\n');
  g('add', '.'); g('commit', '-qm', 'base');
  g('checkout', '-qb', 'feature/pay');
  w('src/pay/PayService.java', 'class PayService { @PostMapping("/pay/notify/{id}") void notify() {} /* insert into t_pay_record */ }\n');
  g('add', '.'); g('commit', '-qm', 'pay');
  const doc = '# 技术方案\n> 对比分支：`feature/pay` ←→ `main`\n\n新增 `PayService.notify()`（`src/pay/PayService.java`），调用方 `OrderService` 不变。\n'
    + '接口 `POST /pay/notify/{id}`；表 `t_pay_record`、`t_order`。\n编造的：`RefundService`、`t_refund_log`、`/refund/apply`、`src/refund/Refund.java`。\n';
  assert.equal(diffRange(doc), 'main...feature/pay');
  const r = checkRefs(root, extractRefs(doc), diffRange(doc));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.unverified.map((u) => u.ref).sort(), ['/refund/apply', 'RefundService', 'src/refund/Refund.java', 't_refund_log']);
  assert.equal(checkRefs(root, [], 'main...nope').ok, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('交付说明模板：原样报占位符与缺元信息；按模板写完的小改动交付通过且无警告', () => {
  const tpl = fs.readFileSync(path.join(REPO, 'dev/references/delivery-template.md'), 'utf8');
  const meta = JSON.parse(fs.readFileSync(path.join(REPO, 'dev/skill.json'), 'utf8')).templates.find((t) => t.id === 'delivery-template.md').lint;
  assert.equal(lint(tpl, tpl, meta).ok, false, '原样模板有占位符');
  const doc = ['# 开发交付 — 订单列表按创建时间筛选', '', '> 类型：功能开发 ｜ 规模：S ｜ 日期：2026-10-15', '> 对比分支：`feature/order-filter` ←→ `main`', '> 参考产物：无', '> DocNexus：未沉淀',
    '## 结果', '已完成。', '## 改动', '| 文件 | 改动说明 |', '|---|---|', '| OrderController.java | 加参数 |', '## 验证', '- 测试：mvn test → 通过 12 个',
    '## 配置清单', '无', '## SQL 脚本（未执行）', '无', '## 自审', '无问题', '## 范围外发现', '无', '## 建议下一步', '提交', ''].join('\n');
  const r = lint(doc, tpl, meta);
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.deepEqual(r.warnings, [], '省略「已确认的决定」「根因」（如有）不算缺章节');
  const bad = lint(doc.replace(/> 对比分支.*\n/, '').replace('## 验证', '## 验收'), tpl, meta);
  assert.ok(bad.errors.some((e) => e.includes('对比分支')) && bad.errors.some((e) => e.includes('验证')), bad.errors.join('\n'));
});
