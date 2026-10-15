// workflow/scripts/lint-doc.mjs：章节、占位符、元信息检查；模板来源跟随 resolve 规则
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lint, headingKey } from '../workflow/scripts/lint-doc.mjs';

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

test('CLI：自带模板生成的骨架报错；已接入 DocNexus 时改用知识库模板', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lintdoc-'));
  assert.equal(spawnSync(process.execPath, [path.join(REPO, 'bin/skills-init.mjs'), '--project-root', root, '--envs', 'codex', '--skip-db', '--yes'], { encoding: 'utf8' }).status, 0);
  const cli = (...a) => spawnSync(process.execPath, [path.join(root, '.agents/skills/workflow/scripts/lint-doc.mjs'), ...a], { cwd: root, encoding: 'utf8' });
  fs.copyFileSync(path.join(REPO, 'create-tech-md-doc/template.md'), path.join(root, 'raw.md'));
  let r = cli('raw.md', '--skill', 'create-tech-md-doc', '--json');
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.source, 'default');
  assert.ok(out.errors.some((e) => e.includes('模板来源')));
  assert.equal(cli('raw.md', '--skill', 'project-review').status, 3);
  fs.mkdirSync(path.join(root, 'docnexus/library/templates/create-tech-md-doc'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules/.bin'), { recursive: true });
  for (const f of ['docnexus/project.json', 'node_modules/.bin/docnexus', 'node_modules/.bin/docnexus.cmd']) fs.writeFileSync(path.join(root, f), '{}');
  r = cli('raw.md', '--skill', 'create-tech-md-doc');
  assert.equal(r.status, 2, '缺知识库模板时不回退默认模板');
  fs.writeFileSync(path.join(root, 'docnexus/library/templates/create-tech-md-doc/template.md'), '# 团队模板\n## 背景 *\n## 方案 *\n');
  fs.writeFileSync(path.join(root, 'doc.md'), '# 订单导出\n> **自动生成** by x\n> 对比分支：a\n> diff 概览：1 file\n> 模板来源：DocNexus\n## 背景\n## 方案\n');
  r = cli('doc.md', '--skill', 'create-tech-md-doc');
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /docnexus/);
  fs.rmSync(root, { recursive: true, force: true });
});
