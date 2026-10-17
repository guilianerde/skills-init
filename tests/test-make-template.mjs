// 技术方案 / 上线方案模板改为按样例创建：make-template.mjs 抽骨架；老项目升级时保留原来在用的默认模板
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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

// 模拟老版本装过的项目：skills 目录里有默认模板，并记在安装清单里
function oldProject({ withLibrary = false, withProject = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retired-'));
  const cli = (...a) => node([path.join(REPO, 'bin/skills-init.mjs'), '--project-root', root, ...a], { cwd: root, env: { ...process.env, SKILLS_INIT_ADMIN: '1' } });
  assert.equal(cli('--envs', 'codex', '--skip-db', '--yes').status, 0);
  const base = path.join(root, '.agents/skills');
  const man = JSON.parse(fs.readFileSync(path.join(base, '.skills-init.json'), 'utf8'));
  for (const s of ['create-tech-md-doc', 'create-release-md-doc']) {
    const content = `# 【${s}】旧默认模板\n## 章节 *\n`;
    fs.writeFileSync(path.join(base, s, 'template.md'), content);
    man.skills[s].files['template.md'] = crypto.createHash('sha256').update(content).digest('hex');
  }
  fs.writeFileSync(path.join(base, '.skills-init.json'), JSON.stringify(man, null, 2));
  if (withLibrary) { fs.mkdirSync(path.join(root, 'skills-init/docnexus/library/templates/create-tech-md-doc'), { recursive: true }); fs.writeFileSync(path.join(root, 'skills-init/docnexus/library/templates/create-tech-md-doc/template.md'), '# 库里的\n'); }
  if (withProject) { fs.mkdirSync(path.join(root, 'skills-init/templates/create-release-md-doc'), { recursive: true }); fs.writeFileSync(path.join(root, 'skills-init/templates/create-release-md-doc/template.md'), '# 项目自己的\n'); }
  return { root, base, cli };
}

test('升级：老项目还在用的默认模板保存到项目模板目录，skills 目录里那份按清单清理', () => {
  const { root, base, cli } = oldProject();
  const r = cli('upgrade');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /不再随 skills 提供，已把项目在用的版本保存到 skills-init\/templates\/create-tech-md-doc\/template\.md/);
  for (const s of ['create-tech-md-doc', 'create-release-md-doc']) {
    assert.equal(fs.readFileSync(path.join(root, 'skills-init/templates', s, 'template.md'), 'utf8'), `# 【${s}】旧默认模板\n## 章节 *\n`);
    assert.ok(!fs.existsSync(path.join(base, s, 'template.md')), `${s}：skills 目录里的旧默认模板应被清理`);
  }
  const res = node([path.join(base, 'workflow/scripts/resolve.mjs'), 'template', 'create-tech-md-doc', 'template.md'], { cwd: root });
  assert.equal(JSON.parse(res.stdout).source, 'project', '升级后生成效果不变');
  fs.rmSync(root, { recursive: true, force: true });
});

test('升级：项目或 DocNexus 里已有自己的模板时不覆盖、不复制', () => {
  const { root, cli } = oldProject({ withLibrary: true, withProject: true });
  assert.equal(cli('upgrade').status, 0);
  assert.ok(!fs.existsSync(path.join(root, 'skills-init/templates/create-tech-md-doc/template.md')), 'DocNexus 里已有，不复制');
  assert.equal(fs.readFileSync(path.join(root, 'skills-init/templates/create-release-md-doc/template.md'), 'utf8'), '# 项目自己的\n');
  fs.rmSync(root, { recursive: true, force: true });
});
