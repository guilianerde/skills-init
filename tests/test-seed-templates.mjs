// --seed-templates 单元测试：用一个假的 docnexus CLI 记录调用，验证导入顺序、模板原样写入、已存在不覆盖。
// 真实 DocNexus 的端到端验证需要安装 npm 包，见 README「DocNexus 模板」一节的手动步骤。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedTemplates, TEMPLATES } from '../bin/seed-templates.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const skip = process.platform === 'win32' ? '假 CLI 用 shebang 脚本实现，Windows 跳过' : false;

// 假 docnexus：draft new 分配目录，draft seal 记录目标路径，document add 把 document.md 拷进 library
const FAKE = `#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const [cmd, sub, ...rest] = process.argv.slice(2);
const arg = (n) => rest[rest.indexOf(n) + 1];
fs.appendFileSync('calls.log', [cmd, sub, ...rest].join(' ') + '\\n');
if (cmd === 'draft' && sub === 'new') {
  const id = 'draft_' + arg('--slug'); const dir = path.join('docnexus/drafts', id);
  fs.mkdirSync(dir, { recursive: true });
  const a = (f) => path.join(dir, f);
  console.log(JSON.stringify({ draft_id: id, artifacts: { source: a('source.md'), document: a('document.md'), metadata: a('metadata.json') } }));
} else if (cmd === 'draft' && sub === 'seal') {
  fs.writeFileSync(path.join('docnexus/drafts', arg('--id'), 'target'), arg('--file'));
  console.log(JSON.stringify({ result: 'draft_ready' }));
} else if (cmd === 'document' && sub === 'add') {
  const dir = path.join('docnexus/drafts', arg('--draft'));
  const target = path.join('docnexus/library', fs.readFileSync(path.join(dir, 'target'), 'utf8'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(dir, 'document.md'), target);
  console.log(JSON.stringify({ operation: 'created' }));
} else if (cmd === 'draft' && sub === 'discard') {
  console.log('{}');
} else { process.exit(1); }
`;

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-'));
  fs.mkdirSync(path.join(root, 'docnexus'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docnexus', 'project.json'), '{}');
  fs.mkdirSync(path.join(root, 'node_modules', '.bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', '.bin', 'docnexus'), FAKE, { mode: 0o755 });
  return root;
}
const quiet = { ok() {}, warn() {} };

test('导入全部模板，内容与自带模板一致，元数据分类为 doc-template', { skip }, () => {
  const root = project();
  const r = seedTemplates(root, REPO, quiet);
  assert.deepEqual(r.seeded, TEMPLATES.map((t) => t.file));
  assert.equal(r.failed.length, 0);
  for (const t of TEMPLATES) {
    assert.equal(fs.readFileSync(path.join(root, 'docnexus/library', t.file), 'utf8'), fs.readFileSync(path.join(REPO, t.src), 'utf8'));
    const meta = JSON.parse(fs.readFileSync(path.join(root, 'docnexus/drafts', `draft_template-${t.skill}`, 'metadata.json'), 'utf8'));
    assert.equal(meta.category, 'doc-template');
    assert.ok(meta.tags.includes('skills-init-template'));
  }
  const calls = fs.readFileSync(path.join(root, 'calls.log'), 'utf8');
  assert.match(calls, /draft seal --id draft_template-create-tech-md-doc --file templates\/create-tech-md-doc\/template.md --base-version new/);
  assert.doesNotMatch(calls, /--replace/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('已存在的模板不覆盖', { skip }, () => {
  const root = project();
  const existing = path.join(root, 'docnexus/library/templates/create-tech-md-doc/template.md');
  fs.mkdirSync(path.dirname(existing), { recursive: true });
  fs.writeFileSync(existing, '# 团队改过的模板\n');
  const r = seedTemplates(root, REPO, quiet);
  assert.deepEqual(r.skipped, ['templates/create-tech-md-doc/template.md']);
  assert.equal(r.seeded.length, TEMPLATES.length - 1);
  assert.equal(fs.readFileSync(existing, 'utf8'), '# 团队改过的模板\n');
  fs.rmSync(root, { recursive: true, force: true });
});

test('未接入 DocNexus 时报错', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-none-'));
  assert.throws(() => seedTemplates(root, REPO, quiet), /未检测到 DocNexus/);
  fs.rmSync(root, { recursive: true, force: true });
});
