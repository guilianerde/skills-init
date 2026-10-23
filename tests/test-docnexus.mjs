// format 7 重新接入：破坏性清理旧布局，新版重装保留知识，npm 安装和 init 参数一致。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanupLegacyDocNexus } from '../bin/lib/docnexus.mjs';

const CLI = fileURLToPath(new URL('../bin/workflow-run.mjs', import.meta.url));
function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docnexus-v7-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const at = (rel) => path.join(root, rel);
  const put = (rel, text) => { fs.mkdirSync(path.dirname(at(rel)), { recursive: true }); fs.writeFileSync(at(rel), text); };
  const read = (rel) => fs.readFileSync(at(rel), 'utf8');
  const cli = (args, env = {}) => spawnSync(process.execPath, [CLI, '--project-root', root, ...args], {
    encoding: 'utf8', env: { ...process.env, WORKFLOW_RUN_ADMIN: '1', ...env },
  });
  const install = () => cli(['--envs', 'codex', '--skills', 'workflow', '--yes', '--skip-db']);
  return { root, at, put, read, cli, install };
}

function oldWorkspace(p) {
  p.put('workflow-run/docnexus/project.json', '{"format_version":6}');
  p.put('workflow-run/docnexus/library/old.md', '# 旧知识');
  p.put('workflow-run/docnexus/node_modules/old.txt', '旧依赖');
  p.put('workflow-run/.docnexus/store/old.bin', '嵌套运行环境');
  p.put('workflow-run/tmp/duplicate-docnexus/old/docnexus/library/a.md', '旧备份');
  p.put('workflow-run/.agents/skills/docnexus-recall/SKILL.md', '# 嵌套旧 skill');
}

test('安装强制清除旧版工作区、嵌套运行环境和旧备份；其他工作流产物保留', (t) => {
  const p = project(t);
  oldWorkspace(p);
  p.put('workflow-run/docs/requirements/task/svc/delivery.md', '# 交付');
  p.put('workflow-run/tmp/template-draft/dev/plan-template.md', '# 草稿');
  p.put('AGENTS.md', '# 手写说明\n\n<!-- docnexus:start -->\n旧说明\n<!-- docnexus:end -->\n');
  p.put('workflow-run/AGENTS.md', '# 嵌套手写说明\n\n<!-- docnexus:start -->\n旧说明\n<!-- docnexus:end -->\n');
  const r = p.install();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const rel of ['workflow-run/docnexus', 'workflow-run/.docnexus', 'workflow-run/tmp/duplicate-docnexus']) assert.equal(fs.existsSync(p.at(rel)), false, rel);
  assert.equal(p.read('workflow-run/docs/requirements/task/svc/delivery.md'), '# 交付');
  assert.equal(p.read('workflow-run/tmp/template-draft/dev/plan-template.md'), '# 草稿');
  assert.equal(fs.existsSync(p.at('workflow-run/.agents/skills/docnexus-recall')), false);
  assert.match(p.read('AGENTS.md'), /^# 手写说明\n\n<!-- workflow-run:artifacts:start -->/);
  assert.doesNotMatch(p.read('AGENTS.md'), /<!-- docnexus:start -->/);
  assert.equal(p.read('workflow-run/AGENTS.md'), '# 嵌套手写说明\n');
  assert.match(r.stderr, /破坏性更新/);
});

test('新版 output-dir 输出在重装 / 升级后保留，旧内部文件不再写进知识目录', (t) => {
  const p = project(t);
  p.put('.docnexus/project.json', '{"format_version":7,"output_dir":"workflow-run"}');
  p.put('workflow-run/docnexus/library/keep.md', '# 新版知识');
  p.put('workflow-run/docnexus/records/a/record.json', '{"id":"a"}');
  p.put('.docnexus/store/keep.bin', '索引');
  let r = p.install();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  r = p.cli(['upgrade']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(p.read('workflow-run/docnexus/library/keep.md'), '# 新版知识');
  assert.equal(p.read('workflow-run/docnexus/records/a/record.json'), '{"id":"a"}');
  assert.equal(p.read('.docnexus/store/keep.bin'), '索引');
});

test('doctor 只读报告旧布局；upgrade 同样清理，不再迁移或备份', (t) => {
  const p = project(t);
  assert.equal(p.install().status, 0);
  oldWorkspace(p);
  let r = p.cli(['doctor', '--offline']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /发现旧版 DocNexus/);
  assert.equal(p.read('workflow-run/docnexus/library/old.md'), '# 旧知识');
  r = p.cli(['upgrade']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.existsSync(p.at('workflow-run/docnexus')), false);
  assert.equal(fs.existsSync(p.at('workflow-run/tmp/duplicate-docnexus')), false);
});

test('清除旧 .docnexus 项目状态，保留安装依赖；同名普通业务目录保留', (t) => {
  const p = project(t);
  p.put('.docnexus/project.json', '{"format_version":6}');
  p.put('.docnexus/package.json', '{"dependencies":{"@rowansenne/docnexus":"0.23.0"}}');
  p.put('.docnexus/store/old.bin', '旧索引');
  p.put('docnexus/manual.md', '业务文件');
  cleanupLegacyDocNexus(path.relative(process.cwd(), p.root));
  assert.equal(fs.existsSync(p.at('.docnexus/project.json')), false);
  assert.equal(fs.existsSync(p.at('.docnexus/store')), false);
  assert.ok(fs.existsSync(p.at('.docnexus/package.json')));
  assert.equal(p.read('docnexus/manual.md'), '业务文件');
});

test('旧工作区是软链接时只删链接，不跟随删除外部知识', { skip: process.platform === 'win32' }, (t) => {
  const p = project(t);
  const external = project(t);
  external.put('project.json', '{"format_version":6}');
  external.put('library/keep.md', '# 外部知识');
  fs.mkdirSync(p.at('workflow-run'));
  fs.symlinkSync(external.root, p.at('workflow-run/docnexus'), 'dir');
  cleanupLegacyDocNexus(p.root);
  assert.equal(fs.existsSync(p.at('workflow-run/docnexus')), false);
  assert.equal(external.read('library/keep.md'), '# 外部知识');
});

test('旧内部状态目录是链接时不清理链接目标的文件', { skip: process.platform === 'win32' }, (t) => {
  const p = project(t);
  const external = project(t);
  external.put('project.json', '{"format_version":6}');
  external.put('store/keep.bin', '外部索引');
  fs.symlinkSync(external.root, p.at('.docnexus'), 'dir');
  cleanupLegacyDocNexus(p.root);
  assert.equal(fs.existsSync(p.at('.docnexus')), false);
  assert.equal(external.read('store/keep.bin'), '外部索引');
});

test('旧工作区的父目录是外部链接时停止，不穿透删除', { skip: process.platform === 'win32' }, (t) => {
  const p = project(t);
  const external = project(t);
  external.put('docnexus/project.json', '{"format_version":6}');
  external.put('docnexus/library/keep.md', '# 外部知识');
  fs.symlinkSync(external.root, p.at('workflow-run'), 'dir');
  const r = p.install();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /父目录是软链接/);
  assert.equal(external.read('docnexus/library/keep.md'), '# 外部知识');
  assert.equal(fs.existsSync(p.at('.agents')), false);
});

test('安装接入：npm 使用 .docnexus 前缀，init 在业务根传 --output-dir workflow-run，Qwen 获得正确入口', (t) => {
  const p = project(t);
  const pkg = project(t);
  pkg.put('package.json', JSON.stringify({ name: '@rowansenne/docnexus', version: '0.23.0', bin: { docnexus: 'cli.cjs' } }));
  pkg.put('cli.cjs', `#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const args = process.argv.slice(2);
if (args[0] !== 'init') process.exit(1);
const output = args[args.indexOf('--output-dir') + 1];
if (output !== 'workflow-run' || args[args.indexOf('--agent') + 1] !== 'none') process.exit(2);
fs.writeFileSync('.docnexus/project.json', JSON.stringify({ format_version: 7, output_dir: output }));
for (const name of ['docnexus', 'docnexus-recall']) {
  const dir = '.docnexus/skills/' + name; fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dir + '/SKILL.md', '---\\nname: ' + name + '\\n---\\n');
}
fs.mkdirSync(output + '/docnexus/library', { recursive: true });
fs.writeFileSync(output + '/docnexus/CONCEPTS.md', '# 概念');
fs.writeFileSync('init-call.json', JSON.stringify({ cwd: process.cwd(), args }));
console.log('{}');
`);
  oldWorkspace(p);
  const r = p.cli(['--envs', 'qwen', '--skills', 'workflow', '--skip-db', '--yes', '--with-docnexus'], {
    DOCNEXUS_PKG: pkg.root, npm_config_cache: p.at('npm-cache'), npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const call = JSON.parse(p.read('init-call.json'));
  assert.equal(fs.realpathSync(call.cwd), fs.realpathSync(p.root));
  assert.deepEqual(call.args, ['init', '--output-dir', 'workflow-run', '--agent', 'none']);
  assert.equal(JSON.parse(p.read('.docnexus/project.json')).output_dir, 'workflow-run');
  assert.ok(fs.existsSync(p.at('.docnexus/node_modules/.bin/docnexus')));
  assert.equal(fs.existsSync(p.at('workflow-run/docnexus/node_modules')), false);
  assert.equal(fs.existsSync(p.at('workflow-run/docnexus/library/old.md')), false);
  assert.match(p.read('QWEN.md'), /\.docnexus\/node_modules\/\.bin\/docnexus/);
  assert.match(p.read('QWEN.md'), /--output-dir workflow-run/);
});
