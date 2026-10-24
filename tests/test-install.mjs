// 安装器黑盒测试（三个平台都跑）：每个用例在临时目录放一份 workflow-run 副本，执行安装后检查目录、软链接与配置。
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { useLocalDocNexus } from './helpers/docnexus-pkg.mjs';

// 必装组件 DocNexus 用本地夹具接入：不依赖 npm registry，也不写用户的 ~/.npm。
useLocalDocNexus();

const REPO = fileURLToPath(new URL('..', import.meta.url));
const IS_WIN = process.platform === 'win32';
const SKILLS = ['workflow', 'dev', 'project-review', 'database-query', 'md-to-wiki', 'create-tech-md-doc', 'create-release-md-doc', 'code-graph'];
const PASSWORD = 'p/a&s|s"w\\o\\"rd\\';
const DB_ANSWERS = `mysql\n127.0.0.1\n3307\nappdb\nroot\n${PASSWORD}\n`;
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-run-install-'));
test.after(() => fs.rmSync(WORK, { recursive: true, force: true }));

const SYMLINK_OK = (() => {
  if (process.env.WORKFLOW_RUN_NO_SYMLINK === '1') return false;
  const d = fs.mkdtempSync(path.join(WORK, 'probe-'));
  try { fs.symlinkSync('.', path.join(d, 'l'), 'dir'); return true; } catch { return false; }
})();

// ---------------------------------------------------------------- 工具
function copyRepo(dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(REPO)) {
    if (['.git', '.github', '.claude', 'tests', 'node_modules', 'tmp'].includes(e)) continue;
    fs.cpSync(path.join(REPO, e), path.join(dst, e), { recursive: true });
  }
}

function project(name) {
  const P = path.join(WORK, name);
  // 安装器副本放在项目外（项目里的 workflow-run/ 是放产出的目录）
  const INST = path.join(WORK, `${name}.installer`);
  fs.mkdirSync(P, { recursive: true });
  copyRepo(INST);
  const at = (rel) => path.join(P, ...rel.split('/'));
  const install = (args, { input = '', env = {} } = {}) => {
    const r = spawnSync(process.execPath, [path.join(INST, 'bin', 'workflow-run.mjs'), '--project-root', P, ...args], {
      encoding: 'utf8', input, env: { ...process.env, WORKFLOW_RUN_NO_SYMLINK: '', ...env },
    });
    return { status: r.status, log: `${r.stdout}\n${r.stderr}` };
  };
  return {
    P, at, install, inst: (rel) => path.join(INST, ...rel.split('/')),
    read: (rel) => fs.readFileSync(at(rel), 'utf8'),
    json: (rel) => JSON.parse(fs.readFileSync(at(rel), 'utf8')),
    write: (rel, text) => { fs.mkdirSync(path.dirname(at(rel)), { recursive: true }); fs.writeFileSync(at(rel), text); },
    exists: (rel) => { try { fs.lstatSync(at(rel)); return true; } catch { return false; } },
    isLink: (rel) => { try { return fs.lstatSync(at(rel)).isSymbolicLink(); } catch { return false; } },
    isDir: (rel) => { try { const s = fs.lstatSync(at(rel)); return s.isDirectory() && !s.isSymbolicLink(); } catch { return false; } },
    isFile: (rel) => { try { const s = fs.lstatSync(at(rel)); return s.isFile(); } catch { return false; } },
  };
}

const repoFile = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const sha256 = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO, rel))).digest('hex');
const fillProfile = (p, rel, branch) => p.write(rel, `{\n  "main_branch": "${branch}",\n  "build": "make"\n}\n`);
const fillWiki = (p, rel, url) => p.write(rel, `{\n  "enabled": true,\n  "wiki": { "base_url": "${url}" }\n}\n`);
const ok = (r) => assert.equal(r.status, 0, r.log.slice(-2000));

// 链接环境：软链接可用时应全部是指向单一来源的相对链接，否则应为独立拷贝
function assertLinked(p, envDir, skills = SKILLS) {
  for (const s of skills) {
    if (SYMLINK_OK) {
      assert.ok(p.isLink(`${envDir}/${s}`), `${envDir}/${s} 应为软链接`);
      assert.equal(fs.readlinkSync(p.at(`${envDir}/${s}`)).replace(/\\/g, '/'), `../../.agents/skills/${s}`);
      assert.ok(fs.existsSync(p.at(`${envDir}/${s}/SKILL.md`)));
    } else {
      assert.ok(p.isDir(`${envDir}/${s}`), `${envDir}/${s} 应为目录`);
      assert.ok(p.isFile(`${envDir}/${s}/SKILL.md`));
    }
  }
}
const backups = (p, glob) => {
  const root = p.at('workflow-run/tmp/backup');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).map((ts) => path.join(root, ts, ...glob.split('/'))).filter((d) => fs.existsSync(d));
};

// ---------------------------------------------------------------- 用例

// 升级备份：workflow-run/tmp/upgrade-backup/<时间>/<相对项目根的路径>；返回所有备份里这个文件的内容
function upgradeBackups(p, rel) {
  const dir = p.at('workflow-run/tmp/upgrade-backup');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((d) => path.join(dir, d, rel)).filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f, 'utf8'));
}

test('全新安装：单一来源完整文件 + 相对软链接；重跑不变', () => {
  const p = project('fresh');
  ok(p.install(['--envs', 'claude,qwen', '--yes', '--skip-db']));
  for (const s of SKILLS) { assert.ok(p.isDir(`.agents/skills/${s}`)); assert.ok(p.isFile(`.agents/skills/${s}/SKILL.md`)); }
  assertLinked(p, '.claude/skills');
  assertLinked(p, '.qwen/skills');
  assert.equal(p.read('.agents/skills/project-review/references/checklist.md'), repoFile('project-review/references/checklist.md.tpl'));
  assert.equal(p.read('.agents/skills/md-to-wiki/scripts/md-to-wiki.mjs'), repoFile('md-to-wiki/scripts/md-to-wiki.mjs'));
  assert.equal(p.read('.agents/skills/md-to-wiki/wiki-config.json'), repoFile('md-to-wiki/wiki-config.json.tpl'));
  assert.equal(p.read('.agents/skills/workflow/profile.json'), repoFile('workflow/profile.json.tpl'));
  assert.equal(p.read('.claude/skills/workflow/SKILL.md'), repoFile('workflow/SKILL.md.tpl'));
  assert.ok(!p.exists('.agents/skills/database-query/config.json'));
  ok(p.install(['--envs', 'claude,qwen', '--yes', '--skip-db']));
  assertLinked(p, '.claude/skills');
  assert.ok(!p.exists('workflow-run/tmp/backup'));
});

test('非管理员终端（WORKFLOW_RUN_ADMIN=0 模拟）：安装与升级直接停下并提示用管理员终端，不做任何改动；doctor 不受影响', () => {
  const p = project('non-admin');
  const env = { WORKFLOW_RUN_ADMIN: '0' };
  let r = p.install(['--envs', 'claude', '--yes', '--skip-db'], { env });
  assert.equal(r.status, 1);
  assert.match(r.log, /没有管理员权限，已停止安装/);
  assert.match(r.log, /以管理员身份运行/);
  assert.deepEqual(fs.readdirSync(p.P).filter((f) => f !== 'workflow-run'), [], '没有创建任何文件');
  ok(p.install(['--envs', 'claude', '--yes', '--skip-db']));
  const before = p.read('.agents/skills/.workflow-run.json');
  r = p.install(['upgrade'], { env });
  assert.equal(r.status, 1);
  assert.match(r.log, /已停止升级/);
  assert.equal(p.read('.agents/skills/.workflow-run.json'), before);
  assert.doesNotMatch(p.install(['doctor', '--offline'], { env }).log, /管理员/, 'doctor 只读，不要求管理员');
});

test('WORKFLOW_RUN_NO_SYMLINK=1：退回各环境独立拷贝', () => {
  const p = project('no-symlink');
  ok(p.install(['--envs', 'claude,qwen', '--yes', '--skip-db'], { env: { WORKFLOW_RUN_NO_SYMLINK: '1' } }));
  for (const d of ['.claude/skills', '.qwen/skills']) {
    for (const s of SKILLS) { assert.ok(p.isDir(`${d}/${s}`), `${d}/${s}`); assert.ok(p.isFile(`${d}/${s}/SKILL.md`)); }
    assert.equal(p.read(`${d}/workflow/profile.json`), repoFile('workflow/profile.json.tpl'));
  }
  assert.ok(p.isDir('.agents/skills/workflow'));
});

test('--copy：各环境独立拷贝；没选 codex / doubao 时不装 .agents', () => {
  const p = project('copy');
  ok(p.install(['--envs', 'claude,qwen', '--copy', '--yes', '--skip-db']));
  for (const d of ['.claude/skills', '.qwen/skills']) {
    for (const s of SKILLS) { assert.ok(p.isDir(`${d}/${s}`)); assert.ok(p.isFile(`${d}/${s}/SKILL.md`)); }
    assert.equal(p.read(`${d}/workflow/profile.json`), repoFile('workflow/profile.json.tpl'));
  }
  assert.ok(!p.exists('.agents/skills'));
});

test('--yes 且没有数据库配置：退出码 1，什么也不装', () => {
  const p = project('yes-no-db');
  assert.equal(p.install(['--envs', 'claude', '--yes']).status, 1);
  assert.ok(!p.exists('.agents/skills'));
});

test('交互输入含特殊字符的密码：config.json 合法且值一致；--yes 重跑复用', () => {
  const p = project('password');
  ok(p.install(['--envs', 'claude,qwen'], { input: DB_ANSWERS }));
  const cfg = '.agents/skills/database-query/config.json';
  const conn = p.json(cfg).connections.default;
  assert.deepEqual([conn.password, conn.port, conn.user], [PASSWORD, 3307, 'root']);
  assert.match(p.read('.agents/skills/database-query/references/schema.md'), /appdb/);
  ok(p.install(['--envs', 'claude,qwen', '--yes']));
  assert.equal(p.json(cfg).connections.default.password, PASSWORD);
});

test('重跑保留用户配置；手改的 skill 文件备份后更新为新版；--skip-db 保留 config.json', () => {
  const p = project('rerun');
  ok(p.install(['--envs', 'claude,qwen'], { input: DB_ANSWERS }));
  const c = '.agents/skills';
  fillWiki(p, `${c}/md-to-wiki/wiki-config.json`, 'https://wiki.example.com');
  p.write(`${c}/database-query/references/schema.md`, '# my schema\n');
  fillProfile(p, `${c}/workflow/profile.json`, 'develop');
  p.write(`${c}/dev/SKILL.md`, 'stale\n');
  const keep = Object.fromEntries(['md-to-wiki/wiki-config.json', 'workflow/profile.json', 'database-query/config.json'].map((f) => [f, p.read(`${c}/${f}`)]));
  ok(p.install(['--envs', 'claude,qwen', '--yes']));
  for (const [f, v] of Object.entries(keep)) assert.equal(p.read(`${c}/${f}`), v, f);
  assert.equal(p.read(`${c}/database-query/references/schema.md`), '# my schema\n');
  assert.equal(p.read(`${c}/dev/SKILL.md`), repoFile('dev/SKILL.md.tpl'));
  assert.deepEqual(upgradeBackups(p, `${c}/dev/SKILL.md`), ['stale\n']);
  ok(p.install(['--envs', 'claude,qwen', '--yes', '--skip-db']));
  assert.equal(p.read(`${c}/database-query/config.json`), keep['database-query/config.json']);
});

test('安装清单：版本 / 环境 / sha256，用户配置只记存在与否；--copy 各目录一份', () => {
  let p = project('manifest');
  ok(p.install(['--envs', 'claude,qwen', '--yes', '--skip-db']));
  const m = p.json('.agents/skills/.workflow-run.json');
  assert.equal(m.version, JSON.parse(repoFile('package.json')).version);
  assert.deepEqual(m.envs, ['claude', 'qwen']);
  assert.equal(m.skills.dev.files['SKILL.md'], sha256('dev/SKILL.md.tpl'));
  assert.equal(m.skills['project-review'].files['references/checklist.md'], sha256('project-review/references/checklist.md.tpl'));
  assert.equal(m.skills.workflow.userFiles['profile.json'], true);
  assert.equal(m.skills['database-query'].userFiles['config.json'], false);
  assert.ok(!('profile.json' in m.skills.workflow.files));
  assert.ok(!p.exists('.claude/skills/.workflow-run.json'));
  p = project('manifest-copy');
  ok(p.install(['--envs', 'claude,qwen', '--copy', '--yes', '--skip-db']));
  assert.ok(p.isFile('.claude/skills/.workflow-run.json'));
  assert.equal(p.json('.qwen/skills/.workflow-run.json').mode, 'copy');
});

test('手改的 skill 文件：一律更新为新版，原文件备份到 workflow-run/tmp/upgrade-backup/；不询问', () => {
  const p = project('modified');
  const c = '.agents/skills';
  const args = ['--envs', 'claude,qwen', '--skip-db'];
  ok(p.install([...args, '--yes']));
  p.write(`${c}/dev/SKILL.md`, 'my edits\n');
  p.write(`${c}/create-tech-md-doc/skill.json`, '{"name":"create-tech-md-doc","order":6,"templates":[{"id":"template.md","src":"template.md"}]}\n');
  let r = p.install(args); ok(r); // 交互模式也不询问（没有输入也不会卡住）
  assert.equal(p.read(`${c}/dev/SKILL.md`), repoFile('dev/SKILL.md.tpl'));
  assert.equal(p.read(`${c}/create-tech-md-doc/skill.json`), repoFile('create-tech-md-doc/skill.json'), 'skill.json 与 SKILL.md 不会新旧混搭');
  assert.deepEqual(upgradeBackups(p, `${c}/dev/SKILL.md`), ['my edits\n']);
  assert.match(r.log, /以下文件被手动修改过，已按新版覆盖，原文件备份在 workflow-run\/tmp\/upgrade-backup\/\d{8}-\d{6}\//);
  assert.ok(r.log.includes(`  ${c}/dev/SKILL.md`));
  r = p.install([...args, '--yes']); ok(r);
  assert.ok(!r.log.includes('被手动修改过'), '没有再改过就不再提示');
});

test('新版本删掉的模板文件：未改过的直接清理，改过的备份后清理', () => {
  const p = project('prune');
  const c = '.agents/skills';
  ok(p.install(['--envs', 'claude,qwen', '--yes', '--skip-db']));
  fs.appendFileSync(p.at(`${c}/dev/references/delivery-template.md`), 'my notes\n');
  const edited = p.read(`${c}/dev/references/delivery-template.md`);
  fs.rmSync(p.inst('dev/references/plan-template.md'));
  fs.rmSync(p.inst('dev/references/delivery-template.md'));
  fs.rmSync(p.inst('create-tech-md-doc/references'), { recursive: true });
  // dev/skill.json 登记了 plan-template.md：同步去掉，模拟新版本整体删除
  const meta = JSON.parse(fs.readFileSync(p.inst('dev/skill.json'), 'utf8'));
  meta.templates = [];
  fs.writeFileSync(p.inst('dev/skill.json'), JSON.stringify(meta));
  const r = p.install(['--envs', 'claude,qwen', '--yes', '--skip-db']); ok(r);
  assert.ok(!p.exists(`${c}/dev/references/plan-template.md`));
  assert.ok(!p.exists(`${c}/dev/references/delivery-template.md`));
  assert.deepEqual(upgradeBackups(p, `${c}/dev/references/delivery-template.md`), [edited]);
  // skill 自带的 references 被清理；skill.json 声明的共享文件仍然装在 references/ 下
  assert.ok(!p.exists(`${c}/create-tech-md-doc/references/diff-collection.md`));
  assert.ok(!p.exists(`${c}/create-tech-md-doc/references/prd.md`));
  assert.ok(p.isFile(`${c}/create-tech-md-doc/references/prd-fetch.md`));
  assert.ok(p.isFile(`${c}/create-tech-md-doc/SKILL.md`));
  assert.ok(r.log.includes(`${c}/dev/references/delivery-template.md（新版已不提供，已删除）`));
  assert.ok(!('references/plan-template.md' in p.json(`${c}/.workflow-run.json`).skills.dev.files));
});

test('卸载：移除本项目的文件与链接，备份用户配置与手改文件，不动用户自己的 skill', () => {
  const p = project('uninstall');
  const c = '.agents/skills';
  ok(p.install(['--envs', 'claude,qwen', '--yes', '--skip-db']));
  fillWiki(p, `${c}/md-to-wiki/wiki-config.json`, 'https://wiki.example.com');
  fillProfile(p, `${c}/workflow/profile.json`, 'develop');
  p.write(`${c}/project-review/SKILL.md`, 'my edits\n');
  const wiki = p.read(`${c}/md-to-wiki/wiki-config.json`);
  const profile = p.read(`${c}/workflow/profile.json`);
  p.write(`${c}/my-skill/SKILL.md`, 'mine\n');
  p.write('.claude/skills/my-claude-skill/SKILL.md', 'mine\n');
  if (SYMLINK_OK) fs.symlinkSync('../../.agents/skills/my-skill', p.at('.qwen/skills/my-skill'), 'dir');
  p.write(`${c}/dev/notes.md`, 'notes\n');

  const r = p.install(['--uninstall']); ok(r);
  for (const s of SKILLS) {
    assert.ok(!p.exists(`.claude/skills/${s}`), `.claude/skills/${s}`);
    assert.ok(!p.exists(`.qwen/skills/${s}`), `.qwen/skills/${s}`);
    if (s !== 'dev') assert.ok(!p.exists(`${c}/${s}`), `${c}/${s}`);
  }
  assert.ok(!p.exists(`${c}/.workflow-run.json`));
  assert.ok(!p.exists(`${c}/dev/SKILL.md`));
  assert.equal(p.read(`${c}/dev/notes.md`), 'notes\n');
  assert.equal(p.read(`${c}/my-skill/SKILL.md`), 'mine\n');
  assert.equal(p.read('.claude/skills/my-claude-skill/SKILL.md'), 'mine\n');
  if (SYMLINK_OK) assert.ok(p.isLink('.qwen/skills/my-skill'));
  const [b] = fs.readdirSync(p.at('workflow-run/tmp/uninstall-backup'));
  const bk = (rel) => fs.readFileSync(path.join(p.at('workflow-run/tmp/uninstall-backup'), b, ...c.split('/'), ...rel.split('/')), 'utf8');
  assert.equal(bk('md-to-wiki/wiki-config.json'), wiki);
  assert.equal(bk('workflow/profile.json'), profile);
  assert.equal(bk('project-review/SKILL.md'), 'my edits\n');
  assert.ok(r.log.includes('uninstall-backup'));
  ok(p.install(['--uninstall']));
  assert.equal(p.read(`${c}/my-skill/SKILL.md`), 'mine\n');
});

test('卸载 --copy 安装：环境目录清空后一并移除', () => {
  const p = project('uninstall-copy');
  ok(p.install(['--envs', 'claude,qwen', '--copy', '--yes', '--skip-db']));
  ok(p.install(['--uninstall']));
  for (const d of ['.claude', '.qwen', '.agents']) assert.ok(!p.exists(d), d);
});

test('普通聊天落盘约定：无需 DocNexus，重装与升级更新原段，卸载保留手写说明和产物', () => {
  const p = project('artifact-context');
  const files = ['CLAUDE.md', 'AGENTS.md', 'QWEN.md'];
  const before = '# 团队约定\n\n<!-- custom:start -->\n手写规则\n<!-- custom:end -->\n';
  for (const f of files) p.write(f, before);
  p.write('workflow-run/other/讨论/报告.md', '# 普通对话报告\n');
  const meta = '{"name":"existing","runs":{}}\n';
  p.write('workflow-run/docs/requirements/existing/service/meta.json', meta);
  ok(p.install(['--envs', 'codex,claude,doubao,qwen,workbuddy', '--copy', '--yes', '--skip-db', '--skills', 'workflow']));
  const installed = Object.fromEntries(files.map((f) => [f, p.read(f)]));
  for (const f of files) {
    assert.ok(installed[f].startsWith(before), f);
    assert.match(installed[f], /workflow-run\/other\//);
    assert.match(installed[f], /普通聊天不得.*requirement\.mjs.*run\.mjs/);
    const artifactBlock = installed[f].split('<!-- workflow-run:artifacts:start -->')[1].split('<!-- workflow-run:artifacts:end -->')[0];
    assert.doesNotMatch(artifactBlock, /DocNexus/, '落盘边界独立于 DocNexus 段落');
  }
  ok(p.install(['--envs', 'codex,claude,doubao,qwen,workbuddy', '--copy', '--yes', '--skip-db', '--skills', 'workflow']));
  for (const f of files) assert.equal(p.read(f), installed[f], '重装幂等');
  for (const f of files) p.write(f, installed[f].replace('## 工作流文件落盘边界', '## 旧版文件规则'));
  ok(p.install(['upgrade']));
  for (const f of files) assert.equal(p.read(f), installed[f], '升级替换旧段，不重复追加');
  assert.equal(p.read('workflow-run/docs/requirements/existing/service/meta.json'), meta);
  ok(p.install(['uninstall']));
  for (const f of files) assert.equal(p.read(f), before, '只移除自己的段落');
  assert.equal(p.read('workflow-run/other/讨论/报告.md'), '# 普通对话报告\n');
  assert.equal(p.read('workflow-run/docs/requirements/existing/service/meta.json'), meta);
});

test('文件落盘约定只写所选环境：包括 WorkBuddy 与豆包；卸载清理仅含生成段落的文件', () => {
  for (const [env, file] of Object.entries({ claude: 'CLAUDE.md', codex: 'AGENTS.md', doubao: 'AGENTS.md', workbuddy: 'AGENTS.md', qwen: 'QWEN.md' })) {
    const p = project(`artifact-context-${env}`);
    ok(p.install(['--envs', env, '--copy', '--yes', '--skip-db', '--skills', 'workflow']));
    for (const f of ['CLAUDE.md', 'AGENTS.md', 'QWEN.md']) assert.equal(p.exists(f), f === file, `${env}: ${f}`);
    assert.ok(!p.exists('workflow-run/other'), '没有辅助文件时不创建空目录');
    ok(p.install(['uninstall']));
    assert.ok(!p.exists(file), '只剩生成段落的文件随卸载移除');
  }
});

test('--copy 装的独立拷贝换成链接：填过的用户配置并入单一来源，原目录备份', { skip: !SYMLINK_OK && '需要软链接' }, () => {
  const p = project('copy-to-link');
  ok(p.install(['--envs', 'claude,qwen', '--copy', '--yes', '--skip-db']));
  fillWiki(p, '.claude/skills/md-to-wiki/wiki-config.json', 'https://wiki.example.com');
  fillProfile(p, '.claude/skills/workflow/profile.json', 'main');
  p.write('.qwen/skills/database-query/config.json', '{"connections":{"default":{"host":"db.local","database":"x"}}}\n');
  const wiki = p.read('.claude/skills/md-to-wiki/wiki-config.json');
  const profile = p.read('.claude/skills/workflow/profile.json');
  const cfg = p.read('.qwen/skills/database-query/config.json');
  ok(p.install(['--envs', 'claude,qwen', '--yes', '--skip-db']));
  assertLinked(p, '.claude/skills');
  assertLinked(p, '.qwen/skills');
  const c = '.agents/skills';
  assert.equal(p.read(`${c}/md-to-wiki/wiki-config.json`), wiki);
  assert.equal(p.read(`${c}/workflow/profile.json`), profile);
  assert.equal(p.read(`${c}/database-query/config.json`), cfg);
  const [b] = backups(p, 'claude/md-to-wiki');
  assert.ok(b, '缺少 claude 的 md-to-wiki 备份');
  assert.equal(fs.readFileSync(path.join(b, 'wiki-config.json'), 'utf8'), wiki);
});

test('两份独立拷贝的同一配置都填过且不同：保留那个目录不建链接，其余照常', { skip: !SYMLINK_OK && '需要软链接' }, () => {
  const p = project('conflict');
  ok(p.install(['--envs', 'claude,qwen', '--copy', '--yes', '--skip-db']));
  fillWiki(p, '.claude/skills/md-to-wiki/wiki-config.json', 'https://a.example.com');
  fillWiki(p, '.qwen/skills/md-to-wiki/wiki-config.json', 'https://b.example.com');
  const b = p.read('.qwen/skills/md-to-wiki/wiki-config.json');
  ok(p.install(['--envs', 'claude,qwen', '--yes', '--skip-db']));
  assert.equal(p.read('.agents/skills/md-to-wiki/wiki-config.json'), p.read('.claude/skills/md-to-wiki/wiki-config.json'), 'claude 的先并入');
  assert.ok(p.isDir('.qwen/skills/md-to-wiki'));
  assert.equal(p.read('.qwen/skills/md-to-wiki/wiki-config.json'), b);
  assertLinked(p, '.claude/skills');
  assertLinked(p, '.qwen/skills', SKILLS.filter((s) => s !== 'md-to-wiki'));
});

test('本机系统与终端：安装时写进 workflow/profile.local.json（不提交），resolve.mjs env / profile / status 读它；保留已有的个人设置', () => {
  const p = project('env');
  const os = { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform] ?? process.platform;
  p.write('.agents/skills/workflow/profile.local.json', '{ "artifacts": { "commit_prompt": false } }\n');
  const r = p.install(['--envs', 'claude,qwen', '--yes', '--skip-db'], { env: { SHELL: '/bin/zsh' } });
  ok(r);
  const local = p.json('.agents/skills/workflow/profile.local.json');
  assert.equal(local.env.os, os);
  assert.deepEqual(local.artifacts, { commit_prompt: false }, '已有的个人设置保留');
  if (IS_WIN) assert.ok(['pwsh', 'powershell'].includes(local.env.shell));
  else assert.equal(local.env.shell, 'zsh');
  assert.match(r.log, new RegExp(`本机环境：${os} / ${local.env.shell}`));
  const resolve = (cmd) => JSON.parse(spawnSync(process.execPath, [p.at('.agents/skills/workflow/scripts/resolve.mjs'), cmd], { cwd: p.P, encoding: 'utf8' }).stdout);
  assert.deepEqual(resolve('env'), { os, shell: local.env.shell, source: 'install', ...(IS_WIN ? { note: resolve('env').note } : {}) });
  assert.equal(resolve('profile').env.source, 'install');
  assert.equal(resolve('status').env.os, os);
  spawnSync('git', ['init', '-q'], { cwd: p.P });
  assert.equal(spawnSync('git', ['check-ignore', '-q', '.agents/skills/workflow/profile.local.json'], { cwd: p.P }).status, 0, '不提交');
  // --copy：每份独立拷贝各写一份
  const q = project('env-copy');
  ok(q.install(['--envs', 'claude,qwen', '--copy', '--yes', '--skip-db']));
  for (const d of ['.claude', '.qwen']) assert.equal(q.json(`${d}/skills/workflow/profile.local.json`).env.os, os, d);
});

test('.gitignore 只追加缺失的规则，重跑不重复', () => {
  const p = project('gitignore');
  p.write('.gitignore', 'node_modules/\n**/wiki-config.json\n.env');
  ok(p.install(['--envs', 'claude', '--yes', '--skip-db']));
  const lines = p.read('.gitignore').split(/\r?\n/);
  for (const r of ['**/database-query/config.json', '**/wiki-config.json', '/workflow-run/tmp/', 'node_modules/', '.env']) {
    assert.equal(lines.filter((l) => l === r).length, 1, r);
  }
  const after = p.read('.gitignore');
  ok(p.install(['--envs', 'claude', '--yes', '--skip-db']));
  assert.equal(p.read('.gitignore'), after);
});

test('--skills 子集：自动带上 requires 依赖；不装 database-query 时不问数据库；之后补装合并清单', () => {
  const p = project('subset');
  let r = p.install(['--envs', 'claude', '--yes', '--skills', 'project-review']); ok(r);
  assert.match(r.log, /安装的 skill：workflow project-review/);
  assert.deepEqual(fs.readdirSync(p.at('.agents/skills')).filter((f) => !f.startsWith('.')).sort(), ['project-review', 'workflow']);
  assertLinked(p, '.claude/skills', ['workflow', 'project-review']);
  assert.ok(!p.exists('.claude/skills/dev'));
  r = p.install(['--envs', 'claude', '--yes', '--skip-db', '--skills', 'md-to-wiki']); ok(r);
  assert.deepEqual(Object.keys(p.json('.agents/skills/.workflow-run.json').skills).sort(), ['md-to-wiki', 'project-review', 'workflow']);
  assertLinked(p, '.claude/skills', ['workflow', 'project-review', 'md-to-wiki']);
  r = p.install(['upgrade']); ok(r);
  assert.match(r.log, /安装的 skill：workflow project-review md-to-wiki/);
  assert.ok(!p.exists('.agents/skills/dev'), 'upgrade 只升级装过的 skill');
  const status = JSON.parse(spawnSync(process.execPath, [p.at('.agents/skills/workflow/scripts/resolve.mjs'), 'status'], { cwd: p.P, encoding: 'utf8' }).stdout);
  assert.deepEqual(status.skills.sort(), ['md-to-wiki', 'project-review', 'workflow']);
  assert.deepEqual(status.templates.map((t) => t.skill), ['project-review', 'project-review']);
  r = p.install(['--envs', 'claude', '--yes', '--skip-db', '--skills', 'nope']);
  assert.equal(r.status, 1); assert.match(r.log, /未知的 skill：nope/);
  // dev 自审要读 project-review 的审查清单，所以只装 dev 也会带上 project-review
  const d = project('subset-dev');
  r = d.install(['--envs', 'claude', '--yes', '--skip-db', '--skills', 'dev']); ok(r);
  assert.match(r.log, /安装的 skill：workflow dev project-review/);
});

test('共享参考文件：仓库只有一份，装进每个声明它的 skill；改源文件后重跑全部更新', () => {
  const p = project('shared');
  ok(p.install(['--envs', 'codex', '--yes', '--skip-db']));
  const users = ['dev', 'create-tech-md-doc', 'create-release-md-doc'];
  for (const s of users) assert.equal(p.read(`.agents/skills/${s}/references/prd-fetch.md`), repoFile('shared/prd-fetch.md'), s);
  assert.ok(!p.exists('.agents/skills/project-review/references/prd-fetch.md'));
  fs.appendFileSync(p.inst('shared/prd-fetch.md'), '\n<!-- 新版 -->\n');
  ok(p.install(['--envs', 'codex', '--yes', '--skip-db']));
  for (const s of users) assert.match(p.read(`.agents/skills/${s}/references/prd-fetch.md`), /新版/, s);
  ok(p.install(['--envs', 'codex', '--yes', '--skip-db', '--skills', 'database-query']));
  ok(p.install(['uninstall']));
  for (const s of users) assert.ok(!p.exists(`.agents/skills/${s}`), s);
});

test('旧包 skills-init 装过的项目：列出改名命令后停下，不做改动；按提示改名后 upgrade 正常，旧段落与旧忽略规则只提示', () => {
  const p = project('legacy');
  ok(p.install(['--envs', 'codex', '--yes', '--skip-db']));
  fs.rmSync(p.at('workflow-run'), { recursive: true, force: true });
  p.write('skills-init/docs/requirements/x/plan.md', '# 方案\n');
  fs.renameSync(p.at('.agents/skills/.workflow-run.json'), p.at('.agents/skills/.skills-init.json'));
  p.write('CLAUDE.md', '# 项目\n\n<!-- skills-init:docnexus:start -->\n旧段落\n<!-- skills-init:docnexus:end -->\n');
  fs.appendFileSync(p.at('.gitignore'), '/skills-init/tmp/\n');
  for (const cmd of [[], ['upgrade'], ['doctor']]) {
    const r = p.install([...cmd, '--envs', 'codex', '--yes', '--skip-db']);
    assert.equal(r.status, 1, cmd.join(' '));
    assert.match(r.log, /mv skills-init workflow-run/);
    assert.match(r.log, /mv \.agents\/skills\/\.skills-init\.json \.agents\/skills\/\.workflow-run\.json/);
    assert.match(r.log, /CLAUDE\.md：删掉/);
  }
  assert.ok(!p.exists('workflow-run'), '停下时不建新目录');

  fs.renameSync(p.at('skills-init'), p.at('workflow-run'));
  fs.renameSync(p.at('.agents/skills/.skills-init.json'), p.at('.agents/skills/.workflow-run.json'));
  const r = p.install(['upgrade']);
  ok(r);
  assert.ok(p.exists('workflow-run/docs/requirements/x/legacy/plan.md'), '旧结构迁到 <需求>/<项目名>/（项目名取目录名）');
  assert.match(r.log, /需求产物已迁到新结构/);
  assert.equal(p.json('.agents/skills/workflow/profile.json').artifacts.project, 'legacy');
  assert.match(r.log, /旧版残留：CLAUDE\.md/);
  assert.match(r.log, /旧版残留：\.gitignore/);
  assert.ok(p.read('.gitignore').includes('/workflow-run/tmp/'));
});

test('WorkBuddy：.codebuddy/skills 按 skill 软链接到单一来源；交互菜单第 5 项；doctor 检查链接；卸载后 .codebuddy 里别的文件保留', () => {
  const p = project('workbuddy');
  p.write('.codebuddy/CODEBUDDY.md', '# 团队约定\n');
  ok(p.install(['--envs', 'workbuddy', '--yes', '--skip-db']));
  for (const s of SKILLS) assert.ok(p.isFile(`.agents/skills/${s}/SKILL.md`), s);
  assertLinked(p, '.codebuddy/skills');
  assert.deepEqual(p.json('.agents/skills/.workflow-run.json').envs, ['workbuddy']);
  const d = p.install(['doctor']);
  if (SYMLINK_OK) assert.match(d.log, /\.codebuddy\/skills 全部指向 \.agents\/skills/);
  ok(p.install(['uninstall']));
  assert.ok(!p.exists('.codebuddy/skills'));
  assert.equal(p.read('.codebuddy/CODEBUDDY.md'), '# 团队约定\n');

  const q = project('workbuddy-menu');
  ok(q.install(['--skip-db'], { input: '5\n' }));
  assert.deepEqual(q.json('.agents/skills/.workflow-run.json').envs, ['workbuddy']);
  assertLinked(q, '.codebuddy/skills');
});

test('WorkBuddy 改用 --copy：已有软链接变成真实目录，保留配置，不改动共享来源和 Qwen', { skip: !SYMLINK_OK }, () => {
  const p = project('workbuddy-switch-copy');
  ok(p.install(['--envs', 'qwen,workbuddy', '--yes', '--skip-db']));
  fillProfile(p, '.agents/skills/workflow/profile.json', 'main');
  p.write('.agents/skills/database-query/config.json', '{"connections":{"test":{"password":"keep"}}}\n');
  p.write('.agents/skills/dev/SKILL.md', '# 共享来源的手改内容\n');
  const profile = p.read('.agents/skills/workflow/profile.json');
  const config = p.read('.agents/skills/database-query/config.json');

  ok(p.install(['--envs', 'workbuddy', '--copy', '--yes', '--skip-db']));
  for (const s of SKILLS) {
    assert.ok(p.isDir(`.codebuddy/skills/${s}`), s);
    assert.ok(p.isFile(`.codebuddy/skills/${s}/SKILL.md`), s);
  }
  assert.equal(p.read('.codebuddy/skills/workflow/profile.json'), profile);
  assert.equal(p.read('.codebuddy/skills/database-query/config.json'), config);
  assert.equal(p.read('.codebuddy/skills/dev/SKILL.md'), repoFile('dev/SKILL.md.tpl'));
  assert.equal(p.read('.agents/skills/dev/SKILL.md'), '# 共享来源的手改内容\n');
  assertLinked(p, '.qwen/skills');
  p.write('.codebuddy/skills/workflow/profile.json', '{"main_branch":"release"}\n');
  assert.equal(p.read('.agents/skills/workflow/profile.json'), profile);
  assert.equal(p.json('.codebuddy/skills/.workflow-run.json').mode, 'copy');
  ok(p.install(['upgrade']));
  for (const s of SKILLS) assert.ok(p.isDir(`.codebuddy/skills/${s}`), s);
  assert.equal(p.read('.codebuddy/skills/workflow/profile.json'), '{"main_branch":"release"}\n');
  assertLinked(p, '.qwen/skills');
});

test('WorkBuddy --copy 不替换用户指向其他位置的 skill 链接', { skip: !SYMLINK_OK }, () => {
  const p = project('workbuddy-user-link');
  p.write('my-workflow/SKILL.md', '# 用户的技能\n');
  fs.mkdirSync(p.at('.codebuddy/skills'), { recursive: true });
  fs.symlinkSync('../../my-workflow', p.at('.codebuddy/skills/workflow'), 'dir');
  const r = p.install(['--envs', 'workbuddy', '--copy', '--yes', '--skip-db']);
  assert.equal(r.status, 1);
  assert.match(r.log, /指向其他位置/);
  assert.ok(p.isLink('.codebuddy/skills/workflow'));
  assert.equal(p.read('my-workflow/SKILL.md'), '# 用户的技能\n');
});

test('WorkBuddy 自动退回拷贝：升级仍以单一来源的完整 skill 清单为准', () => {
  const p = project('workbuddy-copy-fallback');
  const env = { WORKFLOW_RUN_NO_SYMLINK: '1' };
  ok(p.install(['--envs', 'workbuddy', '--yes', '--skip-db'], { env }));
  ok(p.install(['--envs', 'workbuddy', '--skills', 'workflow', '--yes', '--skip-db'], { env }));
  ok(p.install(['upgrade'], { env }));
  for (const s of SKILLS) assert.ok(p.isFile(`.codebuddy/skills/${s}/SKILL.md`), s);
  assert.deepEqual(Object.keys(p.json('.codebuddy/skills/.workflow-run.json').skills).sort(), [...SKILLS].sort());
  assert.equal(p.json('.codebuddy/skills/.workflow-run.json').mode, 'copy-fallback');
});

test('WorkBuddy --copy：.codebuddy/skills 独立拷贝，带自己的安装清单', () => {
  const p = project('workbuddy-copy');
  ok(p.install(['--envs', 'workbuddy', '--copy', '--yes', '--skip-db']));
  assert.ok(p.isDir('.codebuddy/skills/workflow') && p.isFile('.codebuddy/skills/workflow/SKILL.md'));
  assert.equal(p.json('.codebuddy/skills/.workflow-run.json').mode, 'copy');
  assert.ok(!p.exists('.agents/skills'));
  ok(p.install(['upgrade']));
  ok(p.install(['uninstall']));
  assert.ok(!p.exists('.codebuddy'));
});

test('目录里没有安装清单：和新版不同的文件备份后覆盖，只汇总一行，不报「被手动修改过」；交互安装不再问用户级 Codex', () => {
  const p = project('unlisted');
  ok(p.install(['--envs', 'codex', '--yes', '--skip-db']));
  fs.rmSync(p.at('.agents/skills/.workflow-run.json'));
  p.write('.agents/skills/dev/SKILL.md', 'old\n');
  const r = p.install(['--envs', 'codex', '--skip-db']); ok(r);
  assert.ok(!r.log.includes('被手动修改过'), r.log.slice(-1500));
  assert.match(r.log, /\.agents\/skills 里没有安装清单，1 个和新版不同的文件已备份到 workflow-run\/tmp\/upgrade-backup\/\d{8}-\d{6}\/ 后覆盖/);
  assert.deepEqual(upgradeBackups(p, '.agents/skills/dev/SKILL.md'), ['old\n']);
  assert.equal(p.read('.agents/skills/dev/SKILL.md'), repoFile('dev/SKILL.md.tpl'));
  assert.ok(!r.log.includes('.codex/skills'), '不再询问用户级 Codex');
});
