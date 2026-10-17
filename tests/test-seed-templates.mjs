// --seed-templates 单元测试：用一个假的 docnexus CLI 记录调用，验证导入顺序、模板原样写入、已存在不覆盖。
// 真实 DocNexus 的端到端验证需要安装 npm 包，见 README「DocNexus 模板」一节的手动步骤。
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { seedTemplates, templateStatus, updateTemplates, TEMPLATES } from '../bin/seed-templates.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const skip = process.platform === 'win32' ? '假 CLI 用 shebang 脚本实现，Windows 跳过' : false;

// 假 docnexus：draft new 分配目录，draft seal 记录目标路径（带 --category 时像真 CLI 一样写进 metadata.json），document add 把 document.md 拷进 library
const FAKE = `#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const [cmd, sub, ...rest] = process.argv.slice(2);
const arg = (n) => rest[rest.indexOf(n) + 1];
fs.appendFileSync('calls.log', [cmd, sub, ...rest].join(' ') + '\\n');
const REG = 'registry.json';
const reg = fs.existsSync(REG) ? JSON.parse(fs.readFileSync(REG, 'utf8')) : {};
const save = () => fs.writeFileSync(REG, JSON.stringify(reg));
if (cmd === '--help') {
  // 真 CLI 的帮助里列出 seal 参数；old-docnexus 标记文件模拟不支持 --category 的旧版
  console.log(fs.existsSync('old-docnexus') ? 'docnexus draft seal --id <id> --file <path>\\ndocnexus recall "q" --limit 5' : 'docnexus draft seal --id <id> --file <path> [--category <name> [--category-reason <basis>]]\\ndocnexus recall "q" --limit 5 [--category <name>]');
} else if (cmd === 'draft' && sub === 'new') {
  const id = 'draft_' + arg('--slug') + '_' + Date.now() + Math.random().toString(36).slice(2, 6); const dir = path.join('docnexus/drafts', id);
  fs.mkdirSync(dir, { recursive: true });
  const a = (f) => path.join(dir, f);
  console.log(JSON.stringify({ draft_id: id, artifacts: { source: a('source.md'), document: a('document.md'), metadata: a('metadata.json') } }));
} else if (cmd === 'draft' && sub === 'seal') {
  if (rest.includes('--category')) {
    const mf = path.join('docnexus/drafts', arg('--id'), 'metadata.json');
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    m.category = arg('--category'); m.category_reason = rest.includes('--category-reason') ? arg('--category-reason') : 'Explicit category supplied by caller.';
    fs.writeFileSync(mf, JSON.stringify(m));
  }
  fs.writeFileSync(path.join('docnexus/drafts', arg('--id'), 'target'), JSON.stringify({ file: arg('--file'), base: arg('--base-version') }));
  console.log(JSON.stringify({ result: 'draft_ready' }));
} else if (cmd === 'document' && sub === 'add') {
  const dir = path.join('docnexus/drafts', arg('--draft'));
  const { file, base } = JSON.parse(fs.readFileSync(path.join(dir, 'target'), 'utf8'));
  const prev = Object.values(reg).find((r) => r.file_path === file);
  if (prev && (!rest.includes('--replace') || base !== prev.record_version)) { console.error('version_conflict'); process.exit(1); }
  const target = path.join('docnexus/library', file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(dir, 'document.md'), target);
  const id = prev ? prev.id : 'doc_' + Object.keys(reg).length;
  reg[id] = { id, file_path: file, record_version: 'v' + Date.now() + Math.random(), metadata: JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8')) };
  save();
  console.log(JSON.stringify({ operation: prev ? 'replaced' : 'created' }));
} else if (cmd === 'document' && sub === 'query') {
  console.log(JSON.stringify({ documents: Object.values(reg).map(({ id, file_path, record_version }) => ({ id, file_path, record_version })) }));
} else if (cmd === 'document' && sub === 'get') {
  const r = reg[arg('--id')]; console.log(JSON.stringify({ id: r.id, record_version: r.record_version, metadata: r.metadata }));
} else if (cmd === 'draft' && sub === 'discard') {
  console.log('{}');
} else { process.exit(1); }
`;

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-'));
  fs.mkdirSync(path.join(root, 'skills-init/docnexus'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills-init/docnexus', 'project.json'), '{}');
  // DocNexus 0.17.0 起的装法：CLI 在 docnexus/node_modules/.bin（旧装法在项目根，见 test-links / test-resolve）
  fs.mkdirSync(path.join(root, 'skills-init/docnexus', 'node_modules', '.bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills-init/docnexus', 'node_modules', '.bin', 'docnexus'), FAKE, { mode: 0o755 });
  return root;
}
const quiet = { ok() {}, warn() {} };

test('导入全部模板，内容与自带模板一致，元数据分类为 doc-template', { skip }, () => {
  const root = project();
  const r = seedTemplates(root, REPO, quiet);
  assert.deepEqual(r.seeded, TEMPLATES.map((t) => t.file));
  assert.ok(!r.seeded.some((f) => /create-(tech|release)-md-doc/.test(f)), '技术方案、上线方案没有默认模板，不导入');
  assert.equal(r.failed.length, 0);
  for (const t of TEMPLATES) {
    assert.equal(fs.readFileSync(path.join(root, 'skills-init/docnexus/library', t.file), 'utf8'), fs.readFileSync(path.join(REPO, t.src), 'utf8'));
  }
  const reg = Object.values(JSON.parse(fs.readFileSync(path.join(root, 'skills-init', 'registry.json'), 'utf8')));
  assert.equal(reg.length, TEMPLATES.length);
  for (const r of reg) {
    assert.equal(r.metadata.category, 'doc-template');
    assert.ok(r.metadata.tags.includes('skills-init-template'));
  }
  const calls = fs.readFileSync(path.join(root, 'skills-init', 'calls.log'), 'utf8');
  assert.match(calls, /draft seal --id draft_template-dev\S* --file templates\/dev\/plan-template.md --base-version new --category doc-template --category-reason \S/);
  assert.doesNotMatch(calls, /--replace/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('已存在的模板不覆盖', { skip }, () => {
  const root = project();
  const existing = path.join(root, 'skills-init/docnexus/library/templates/dev/plan-template.md');
  fs.mkdirSync(path.dirname(existing), { recursive: true });
  fs.writeFileSync(existing, '# 团队改过的模板\n');
  const r = seedTemplates(root, REPO, quiet);
  assert.deepEqual(r.skipped, ['templates/dev/plan-template.md']);
  assert.equal(r.seeded.length, TEMPLATES.length - 1);
  assert.equal(fs.readFileSync(existing, 'utf8'), '# 团队改过的模板\n');
  fs.rmSync(root, { recursive: true, force: true });
});

test('未接入 DocNexus 时报错', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-none-'));
  assert.throws(() => seedTemplates(root, REPO, quiet), /未检测到 DocNexus/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('导入记录与状态：current / outdated / customized / edited / untracked / missing', { skip }, () => {
  const root = project();
  // 用临时“默认模板目录”模拟新版本：复制仓库模板后再修改
  const tpl = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-'));
  for (const t of TEMPLATES) { fs.mkdirSync(path.dirname(path.join(tpl, t.src)), { recursive: true }); fs.copyFileSync(path.join(REPO, t.src), path.join(tpl, t.src)); }
  const r = seedTemplates(root, tpl, { ...quiet, version: '0.3.0' });
  const records = r.records;
  assert.equal(Object.keys(records).length, TEMPLATES.length);
  assert.ok(Object.values(records).every((x) => x.version === '0.3.0' && /^[0-9a-f]{64}$/.test(x.sha256)));
  const [tech, release, plan, checklist] = TEMPLATES;
  const status = () => Object.fromEntries(templateStatus(root, tpl, records).map((s) => [s.file, s.status]));
  assert.ok(Object.values(status()).every((v) => v === 'current'));

  fs.appendFileSync(path.join(tpl, tech.src), '\n<!-- 新版默认模板 -->\n');           // 默认变了，库没改 → outdated
  fs.appendFileSync(path.join(tpl, release.src), '\n<!-- 新版默认模板 -->\n');        // 默认变了，库也改了 → customized
  fs.appendFileSync(path.join(root, 'skills-init/docnexus/library', release.file), '\n## 团队加的章节\n');
  fs.appendFileSync(path.join(root, 'skills-init/docnexus/library', plan.file), '\n## 团队加的章节\n'); // 只有库改了 → edited
  fs.rmSync(path.join(root, 'skills-init/docnexus/library', checklist.file));                        // → missing
  let s = status();
  assert.deepEqual([s[tech.file], s[release.file], s[plan.file], s[checklist.file]], ['outdated', 'customized', 'edited', 'missing']);
  assert.equal(templateStatus(root, tpl, {}).find((x) => x.file === release.file).status, 'untracked');

  const u = updateTemplates(root, tpl, records, { ...quiet, version: '0.4.0' });
  assert.deepEqual(u.updated, [tech.file]);
  assert.deepEqual(u.failed, []);
  assert.equal(fs.readFileSync(path.join(root, 'skills-init/docnexus/library', tech.file), 'utf8'), fs.readFileSync(path.join(tpl, tech.src), 'utf8'));
  assert.match(fs.readFileSync(path.join(root, 'skills-init/docnexus/library', release.file), 'utf8'), /团队加的章节/, 'customized 不自动覆盖');
  assert.match(fs.readFileSync(path.join(root, 'skills-init', 'calls.log'), 'utf8'), /document add --draft \S+ --replace/);
  s = Object.fromEntries(templateStatus(root, tpl, { ...records, ...u.records }).map((x) => [x.file, x.status]));
  assert.equal(s[tech.file], 'current');
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(tpl, { recursive: true, force: true });
});

test('CLI：安装时导入并记录到清单；doctor 提示 outdated；seed-templates --update 更新', { skip }, () => {
  const root = project();
  const cli = (...a) => spawnSync(process.execPath, [path.join(REPO, 'bin/skills-init.mjs'), '--project-root', root, ...a], { cwd: root, encoding: 'utf8' });
  let r = cli('--envs', 'codex', '--skip-db', '--yes', '--seed-templates');
  assert.equal(r.status, 0, r.stderr);
  const mf = path.join(root, '.agents/skills/.skills-init.json');
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  assert.equal(Object.keys(m.templates).length, TEMPLATES.length);
  // 模拟“导入的是旧版默认模板”：库内容与记录一致，但与当前默认不同
  const t = TEMPLATES[0];
  const old = '# 旧版默认模板\n';
  fs.writeFileSync(path.join(root, 'skills-init/docnexus/library', t.file), old);
  m.templates[t.file] = { version: '0.2.0', sha256: crypto.createHash('sha256').update(old).digest('hex') };
  fs.writeFileSync(mf, JSON.stringify(m));
  r = cli('doctor', '--offline');
  assert.match(r.stderr, new RegExp(`${t.file}：默认模板有新版`));
  assert.match(r.stdout, /支持调用方显式分类/);
  assert.match(r.stdout, /支持按分类检索/);
  fs.writeFileSync(path.join(root, 'skills-init', 'old-docnexus'), '');
  const oldDoctor = cli('doctor', '--offline').stderr;
  assert.match(oldDoctor, /不支持 draft seal --category/);
  assert.match(oldDoctor, /不支持 recall --category/);
  fs.rmSync(path.join(root, 'skills-init', 'old-docnexus'));
  r = cli('upgrade');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /seed-templates --update/, 'upgrade 后提示，不自动写 DocNexus');
  assert.equal(fs.readFileSync(path.join(root, 'skills-init/docnexus/library', t.file), 'utf8'), old);
  r = cli('seed-templates', '--update');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(root, 'skills-init/docnexus/library', t.file), 'utf8'), fs.readFileSync(path.join(REPO, t.src), 'utf8'));
  assert.equal(JSON.parse(fs.readFileSync(mf, 'utf8')).templates[t.file].version, JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version);
  fs.rmSync(root, { recursive: true, force: true });
});

test('CLI：upgrade 自动导入新增的模板（只新增）；seed-templates --diff 只读打印团队改过的模板与新默认的差异', { skip }, () => {
  const root = project();
  const cli = (...a) => spawnSync(process.execPath, [path.join(REPO, 'bin/skills-init.mjs'), '--project-root', root, ...a], { cwd: root, encoding: 'utf8' });
  let r = cli('--envs', 'codex', '--skip-db', '--yes', '--seed-templates');
  assert.equal(r.status, 0, r.stderr);
  const mf = path.join(root, '.agents/skills/.skills-init.json');
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const added = TEMPLATES.find((t) => t.skill === 'project-review' && t.id === 'report.md');
  const custom = TEMPLATES.find((t) => t.skill === 'project-review' && t.id === 'checklist.md');
  // 模拟「旧版本装的项目」：知识库里还没有新模板；清单是团队在旧默认基础上改过的
  fs.rmSync(path.join(root, 'skills-init/docnexus/library', added.file));
  const reg = JSON.parse(fs.readFileSync(path.join(root, 'skills-init', 'registry.json'), 'utf8'));
  fs.writeFileSync(path.join(root, 'skills-init', 'registry.json'), JSON.stringify(Object.fromEntries(Object.entries(reg).filter(([, d]) => d.file_path !== added.file))));
  delete m.templates[added.file];
  const oldDefault = '# 旧版清单\n## 1. 正确性\n';
  fs.writeFileSync(path.join(root, 'skills-init/docnexus/library', custom.file), `${oldDefault}## 团队加的章节\n`);
  m.templates[custom.file] = { version: '0.5.0', sha256: crypto.createHash('sha256').update(oldDefault).digest('hex') };
  fs.writeFileSync(mf, JSON.stringify(m));
  fs.writeFileSync(path.join(root, 'skills-init', 'calls.log'), '');

  r = cli('upgrade');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(root, 'skills-init/docnexus/library', added.file), 'utf8'), fs.readFileSync(path.join(REPO, added.src), 'utf8'));
  assert.match(fs.readFileSync(path.join(root, 'skills-init/docnexus/library', custom.file), 'utf8'), /团队加的章节/, '已有模板不动');
  const seals = fs.readFileSync(path.join(root, 'skills-init', 'calls.log'), 'utf8').split('\n').filter((l) => l.startsWith('draft seal'));
  assert.equal(seals.length, 1);
  assert.match(seals[0], new RegExp(`--file ${added.file} --base-version new`));
  assert.ok(JSON.parse(fs.readFileSync(mf, 'utf8')).templates[added.file], '导入记录写回清单');
  assert.doesNotMatch(r.stdout, /DocNexus 中已有/, 'upgrade 时不逐个列出已有模板');
  assert.match(r.stderr, /seed-templates --diff/, 'customized 提示用 --diff 对比');

  fs.writeFileSync(path.join(root, 'skills-init', 'calls.log'), '');
  r = cli('seed-templates', '--diff');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(custom.file.replace(/[.]/g, '\\.')));
  assert.match(r.stdout, /^-## 团队加的章节$/m);
  assert.match(r.stdout, /^\+## 11\. 幂等与消息一致性$/m);
  assert.equal(fs.readFileSync(path.join(root, 'skills-init', 'calls.log'), 'utf8'), '', '--diff 不调用 DocNexus');
  r = cli('upgrade');
  assert.match(r.stdout, /文档模板齐全/);
  fs.rmSync(root, { recursive: true, force: true });
});
