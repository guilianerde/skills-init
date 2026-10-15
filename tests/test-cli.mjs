// 子命令：upgrade / doctor / seed-templates / uninstall 与参数解析
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../bin/skills-init.mjs', import.meta.url));
const PKG = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const cli = (root, ...args) => spawnSync(process.execPath, [CLI, '--project-root', root, ...args], { encoding: 'utf8', input: '' });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cli-'));
const manifestPath = (root) => path.join(root, '.agents', 'skills', '.skills-init.json');

test('未安装时 doctor / upgrade 报错退出', () => {
  const root = tmp();
  let r = cli(root, 'doctor', '--offline');
  assert.equal(r.status, 1); assert.match(r.stdout, /未找到安装清单/);
  r = cli(root, 'upgrade');
  assert.equal(r.status, 1); assert.match(r.stderr, /请先运行 init/);
  r = cli(root, 'bogus');
  assert.equal(r.status, 1); assert.match(r.stderr, /未知参数: bogus/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('doctor：干净安装无错误；手改 / 缺链接 / .gitignore 缺规则被发现', () => {
  const root = tmp();
  assert.equal(cli(root, 'init', '--envs', 'codex,claude', '--skip-db', '--yes').status, 0);
  let r = cli(root, 'doctor', '--offline');
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, new RegExp(`已安装版本 ${PKG.version.replace(/\./g, '\\.')}`));
  assert.match(r.stdout, /0 个错误/);
  fs.appendFileSync(path.join(root, '.agents/skills/dev/SKILL.md'), '\n# 手改\n');
  fs.writeFileSync(path.join(root, '.gitignore'), '');
  const viaLink = fs.lstatSync(path.join(root, '.claude/skills/dev')).isSymbolicLink();
  if (viaLink) fs.unlinkSync(path.join(root, '.claude/skills/dev'));
  r = cli(root, 'doctor', '--offline');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /dev\/SKILL\.md 被手动修改过/);
  assert.match(r.stdout, /\.gitignore 缺少/);
  if (viaLink) assert.match(r.stdout, /\.claude\/skills\/dev 不存在/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('upgrade：沿用清单里的环境、保留数据库配置、手改文件另存 .new', () => {
  const root = tmp();
  assert.equal(cli(root, '--envs', 'codex,claude', '--skip-db', '--yes').status, 0);
  const cfg = path.join(root, '.agents/skills/database-query/config.json');
  fs.writeFileSync(cfg, '{"connections":{"default":{"driver":"mysql","password":"keep"}}}');
  fs.appendFileSync(path.join(root, '.agents/skills/workflow/SKILL.md'), '\n# 手改\n');
  const m = JSON.parse(fs.readFileSync(manifestPath(root), 'utf8'));
  m.version = '0.0.1';
  fs.writeFileSync(manifestPath(root), JSON.stringify(m));
  const r = cli(root, 'upgrade');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`升级：0\\.0\\.1 -> ${PKG.version.replace(/\./g, '\\.')}`));
  assert.match(r.stdout, /目标环境：(claude codex|codex claude)/);
  assert.equal(fs.readFileSync(cfg, 'utf8'), '{"connections":{"default":{"driver":"mysql","password":"keep"}}}');
  assert.ok(fs.existsSync(path.join(root, '.agents/skills/workflow/SKILL.md.new')));
  assert.equal(JSON.parse(fs.readFileSync(manifestPath(root), 'utf8')).version, PKG.version);
  assert.equal(cli(root, 'uninstall').status, 0);
  assert.ok(!fs.existsSync(manifestPath(root)));
  fs.rmSync(root, { recursive: true, force: true });
});

test('seed-templates 子命令：未接入 DocNexus 时报错且不安装任何东西', () => {
  const root = tmp();
  const r = cli(root, 'seed-templates');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /未检测到 DocNexus/);
  assert.ok(!fs.existsSync(path.join(root, '.agents')));
  fs.rmSync(root, { recursive: true, force: true });
});
