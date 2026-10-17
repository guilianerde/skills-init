// 技术方案 / 上线方案模板改为按样例创建：make-template.mjs 抽骨架；老项目升级时保留原来在用的默认模板
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { skeleton } from '../workflow/scripts/make-template.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = path.join(REPO, 'workflow/scripts/make-template.mjs');
const node = (args, opts = {}) => spawnSync(process.execPath, args, { encoding: 'utf8', ...opts });

const SAMPLE = `<!-- md-to-wiki: pageId=12 version=3 -->
# 【技术方案】订单导出支持按渠道筛选

> **自动生成** by \`create-tech-md-doc\` skill | 生成时间：2026-10-01
> 对比分支：\`feature/export\` ←→ \`main\`

## 一、需求背景 *

运营需要按渠道导出订单，见 PRD 12345。
第二段说明。

## 二、接口变更

| 接口 | 方法 | 说明 |
|---|---|---|
| /order/export | GET | 新增 channel 参数 |
| /order/list | GET | 不变 |

\`\`\`json
{"channel": "app"}
\`\`\`

### 2.1 配置（如有）

- order.export.max-rows = 50000

## 三、回滚方案
`;

test('skeleton：保留标题与表格列，正文换成填写提示，去掉发布记录、元信息与业务内容', () => {
  const r = skeleton(SAMPLE);
  assert.equal(r.headings, 5);
  const t = r.template;
  assert.match(t, /^# 【技术方案】\{\{文档标题\}\}\n/);
  assert.match(t, /## 一、需求背景 \*\n\n\{\{需求背景：按样例的写法填写\}\}/);
  assert.match(t, /\| 接口 \| 方法 \| 说明 \|\n\|---\|---\|---\|\n\| \{\{接口\}\} \| \{\{方法\}\} \| \{\{说明\}\} \|/);
  assert.match(t, /```json\n\{\{接口变更示例\}\}\n```/);
  assert.match(t, /### 2\.1 配置（如有）\n\n\{\{配置：按样例的写法填写\}\}/);
  assert.match(t, /## 三、回滚方案\n?$/);
  for (const leaked of ['md-to-wiki', '自动生成', '对比分支', '订单导出支持', 'PRD 12345', '/order/export', 'max-rows', 'channel']) assert.ok(!t.includes(leaked), `不应保留样例内容：${leaked}`);
});

test('skeleton：wiki 纯文本（表格没有分隔行）也能抽出表头', () => {
  const wiki = '# 上线方案\n\n## 上线服务\n\n| 服务名 | 环境 |\n| order-svc | prod |\n\n## 监控\n\n- 看板 A\n';
  const t = skeleton(wiki).template;
  assert.match(t, /\| 服务名 \| 环境 \|\n\|---\|---\|\n\| \{\{服务名\}\} \| \{\{环境\}\} \|/);
  assert.ok(!t.includes('order-svc'));
});

test('CLI：文件 / stdin / --out；没有标题时退出 1', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mktpl-'));
  fs.writeFileSync(path.join(dir, 'sample.md'), SAMPLE);
  let r = node([SCRIPT, path.join(dir, 'sample.md')]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /## 二、接口变更/);
  r = node([SCRIPT, '-'], { input: SAMPLE });
  assert.match(r.stdout, /## 三、回滚方案/);
  r = node([SCRIPT, path.join(dir, 'sample.md'), '--out', path.join(dir, 'out/template.md')]);
  assert.equal(r.status, 0);
  assert.match(fs.readFileSync(path.join(dir, 'out/template.md'), 'utf8'), /## 一、需求背景 \*/);
  assert.equal(node([SCRIPT, '-'], { input: '只有正文，没有标题\n' }).status, 1);
  assert.equal(node([SCRIPT]).status, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
