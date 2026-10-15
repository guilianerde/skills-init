// 安装器黑盒测试（三个平台都跑）：每个用例在临时目录放一份 skills-init 副本，执行安装后检查目录、软链接与配置。
// 原来 bash / PowerShell 各维护一份的场景都在这里；tests/test-init-skills.* 只保留封装脚本的冒烟用例。
// 旧布局升级用例从 git 历史取 71a23c8 的旧脚本（CI 用 fetch-depth: 0），取不到时跳过。
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const IS_WIN = process.platform === 'win32';
const SKILLS = ['workflow', 'dev', 'project-review', 'database-query', 'md-to-wiki', 'create-tech-md-doc', 'create-release-md-doc'];
const OLD_REV = '71a23c8'; // 单一来源之前的版本：各环境独立拷贝，画像在 dev/profile.json
const PASSWORD = 'p/a&s|s"w\\o\\"rd\\';
const DB_ANSWERS = `mysql\n127.0.0.1\n3307\nappdb\nroot\n${PASSWORD}\n`;
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-init-install-'));
test.after(() => fs.rmSync(WORK, { recursive: true, force: true }));

const SYMLINK_OK = (() => {
  if (process.env.SKILLS_INIT_NO_SYMLINK === '1') return false;
  const d = fs.mkdtempSync(path.join(WORK, 'probe-'));
  try { fs.symlinkSync('.', path.join(d, 'l'), 'dir'); return true; } catch { return false; }
})();
const OLD_AVAILABLE = spawnSync('git', ['-C', REPO, 'cat-file', '-e', `${OLD_REV}^{commit}`]).status === 0;
const oldSkip = !OLD_AVAILABLE ? `git 历史中没有 ${OLD_REV}（浅克隆时先 git fetch --unshallow）`
  : IS_WIN && spawnSync('pwsh', ['-v']).status !== 0 ? 'Windows 上需要 pwsh 运行旧版脚本' : false;

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
  copyRepo(path.join(P, 'skills-init'));
  const at = (rel) => path.join(P, ...rel.split('/'));
  const install = (args, { input = '', env = {} } = {}) => {
    const r = spawnSync(process.execPath, [path.join(P, 'skills-init', 'bin', 'skills-init.mjs'), '--project-root', P, ...args], {
      encoding: 'utf8', input, env: { ...process.env, SKILLS_INIT_NO_SYMLINK: '', ...env },
    });
    return { status: r.status, log: `${r.stdout}\n${r.stderr}` };
  };
  return {
    P, at, install,
    read: (rel) => fs.readFileSync(at(rel), 'utf8'),
    json: (rel) => JSON.parse(fs.readFileSync(at(rel), 'utf8')),
    write: (rel, text) => { fs.mkdirSync(path.dirname(at(rel)), { recursive: true }); fs.writeFileSync(at(rel), text); },
    exists: (rel) => { try { fs.lstatSync(at(rel)); return true; } catch { return false; } },
    isLink: (rel) => { try { return fs.lstatSync(at(rel)).isSymbolicLink(); } catch { return false; } },
    isDir: (rel) => { try { const s = fs.lstatSync(at(rel)); return s.isDirectory() && !s.isSymbolicLink(); } catch { return false; } },
    isFile: (rel) => { try { const s = fs.lstatSync(at(rel)); return s.isFile(); } catch { return false; } },
    // 用 git 历史中的旧版脚本生成旧布局（各环境独立拷贝），再换回当前版本的 skills-init
    oldLayout() {
      const dst = path.join(P, 'skills-init');
      fs.rmSync(dst, { recursive: true, force: true });
      fs.mkdirSync(dst);
      const tar = spawnSync('git', ['-C', REPO, 'archive', '--format=tar', OLD_REV], { maxBuffer: 64 * 1024 * 1024 });
      assert.equal(tar.status, 0, '无法从 git 历史取出旧版本');
      assert.equal(spawnSync('tar', ['-x', '-C', dst], { input: tar.stdout }).status, 0);
      const r = IS_WIN
        ? spawnSync('pwsh', ['-NoProfile', '-File', path.join(dst, 'init-skills.ps1'), '-Envs', 'all', '-Yes', '-SkipDb'], { cwd: P, encoding: 'utf8', input: '' })
        : spawnSync('bash', [path.join(dst, 'init-skills.sh'), '--envs', 'all', '--yes', '--skip-db'], { cwd: P, encoding: 'utf8', input: '' });
      assert.equal(r.status, 0, `旧版脚本执行失败：${r.stdout}${r.stderr}`);
      fs.rmSync(dst, { recursive: true, force: true });
      copyRepo(dst);
    },
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
  const root = p.at('tmp/skills/backup');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).map((ts) => path.join(root, ts, ...glob.split('/'))).filter((d) => fs.existsSync(d));
};

// ---------------------------------------------------------------- 用例
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
  assert.ok(!p.exists('tmp/skills/backup'));
});

test('SKILLS_INIT_NO_SYMLINK=1：退回各环境独立拷贝', () => {
  const p = project('no-symlink');
  ok(p.install(['--envs', 'claude,qwen', '--yes', '--skip-db'], { env: { SKILLS_INIT_NO_SYMLINK: '1' } }));
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

test('重跑保留用户配置；手改的模板另存 .new；--skip-db 保留 config.json', () => {
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
  assert.equal(p.read(`${c}/dev/SKILL.md`), 'stale\n');
  assert.equal(p.read(`${c}/dev/SKILL.md.new`), repoFile('dev/SKILL.md.tpl'));
  ok(p.install(['--envs', 'claude,qwen', '--yes', '--skip-db']));
  assert.equal(p.read(`${c}/database-query/config.json`), keep['database-query/config.json']);
});

test('安装清单：版本 / 环境 / sha256，用户配置只记存在与否；--copy 各目录一份', () => {
  let p = project('manifest');
  ok(p.install(['--envs', 'claude,qwen', '--yes', '--skip-db']));
  const m = p.json('.agents/skills/.skills-init.json');
  assert.equal(m.version, JSON.parse(repoFile('package.json')).version);
  assert.deepEqual(m.envs, ['claude', 'qwen']);
  assert.equal(m.skills.dev.files['SKILL.md'], sha256('dev/SKILL.md.tpl'));
  assert.equal(m.skills['project-review'].files['references/checklist.md'], sha256('project-review/references/checklist.md.tpl'));
  assert.equal(m.skills.workflow.userFiles['profile.json'], true);
  assert.equal(m.skills['database-query'].userFiles['config.json'], false);
  assert.ok(!('profile.json' in m.skills.workflow.files));
  assert.ok(!p.exists('.claude/skills/.skills-init.json'));
  p = project('manifest-copy');
  ok(p.install(['--envs', 'claude,qwen', '--copy', '--yes', '--skip-db']));
  assert.ok(p.isFile('.claude/skills/.skills-init.json'));
  assert.equal(p.json('.qwen/skills/.skills-init.json').mode, 'copy');
});

test('手改模板：--yes 另存 .new；交互 k 保留、o 覆盖；采纳 .new 后不再提示', () => {
  const p = project('modified');
  const c = '.agents/skills';
  const args = ['--envs', 'claude,qwen', '--skip-db'];
  ok(p.install([...args, '--yes']));
  p.write(`${c}/dev/SKILL.md`, 'my edits\n');
  let r = p.install([...args, '--yes']); ok(r);
  assert.equal(p.read(`${c}/dev/SKILL.md`), 'my edits\n');
  assert.equal(p.read(`${c}/dev/SKILL.md.new`), repoFile('dev/SKILL.md.tpl'));
  assert.ok(r.log.includes(`${c}/dev/SKILL.md  ->  SKILL.md.new`));
  ok(p.install([...args, '--yes']));
  assert.equal(p.read(`${c}/dev/SKILL.md`), 'my edits\n');
  ok(p.install(args, { input: 'k\n' }));
  assert.equal(p.read(`${c}/dev/SKILL.md`), 'my edits\n');
  assert.ok(!p.exists(`${c}/dev/SKILL.md.new`));
  ok(p.install(args, { input: 'o\n' }));
  assert.equal(p.read(`${c}/dev/SKILL.md`), repoFile('dev/SKILL.md.tpl'));
  p.write(`${c}/dev/SKILL.md`, 'mine again\n');
  ok(p.install([...args, '--yes']));
  fs.renameSync(p.at(`${c}/dev/SKILL.md.new`), p.at(`${c}/dev/SKILL.md`));
  r = p.install([...args, '--yes']); ok(r);
  assert.equal(p.read(`${c}/dev/SKILL.md`), repoFile('dev/SKILL.md.tpl'));
  assert.ok(!p.exists(`${c}/dev/SKILL.md.new`));
  assert.ok(!r.log.includes('SKILL.md.new'));
});

test('新版本删掉的模板文件：未改过的清理，改过的保留并提示', () => {
  const p = project('prune');
  const c = '.agents/skills';
  ok(p.install(['--envs', 'claude,qwen', '--yes', '--skip-db']));
  fs.appendFileSync(p.at(`${c}/dev/references/delivery-template.md`), 'my notes\n');
  const edited = p.read(`${c}/dev/references/delivery-template.md`);
  fs.rmSync(p.at('skills-init/dev/references/plan-template.md'));
  fs.rmSync(p.at('skills-init/dev/references/delivery-template.md'));
  fs.rmSync(p.at('skills-init/create-tech-md-doc/references'), { recursive: true });
  // dev/skill.json 登记了 plan-template.md：同步去掉，模拟新版本整体删除
  const meta = JSON.parse(fs.readFileSync(p.at('skills-init/dev/skill.json'), 'utf8'));
  meta.templates = [];
  fs.writeFileSync(p.at('skills-init/dev/skill.json'), JSON.stringify(meta));
  const r = p.install(['--envs', 'claude,qwen', '--yes', '--skip-db']); ok(r);
  assert.ok(!p.exists(`${c}/dev/references/plan-template.md`));
  assert.equal(p.read(`${c}/dev/references/delivery-template.md`), edited);
  // skill 自带的 references 被清理；skill.json 声明的共享文件仍然装在 references/ 下
  assert.ok(!p.exists(`${c}/create-tech-md-doc/references/diff-collection.md`));
  assert.ok(!p.exists(`${c}/create-tech-md-doc/references/prd.md`));
  assert.ok(p.isFile(`${c}/create-tech-md-doc/references/prd-fetch.md`));
  assert.ok(p.isFile(`${c}/create-tech-md-doc/SKILL.md`));
  assert.ok(r.log.includes(`${c}/dev/references/delivery-template.md`));
  assert.ok(!('references/plan-template.md' in p.json(`${c}/.skills-init.json`).skills.dev.files));
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
  assert.ok(!p.exists(`${c}/.skills-init.json`));
  assert.ok(!p.exists(`${c}/dev/SKILL.md`));
  assert.equal(p.read(`${c}/dev/notes.md`), 'notes\n');
  assert.equal(p.read(`${c}/my-skill/SKILL.md`), 'mine\n');
  assert.equal(p.read('.claude/skills/my-claude-skill/SKILL.md'), 'mine\n');
  if (SYMLINK_OK) assert.ok(p.isLink('.qwen/skills/my-skill'));
  const [b] = fs.readdirSync(p.at('tmp/skills/uninstall-backup'));
  const bk = (rel) => fs.readFileSync(path.join(p.at('tmp/skills/uninstall-backup'), b, ...c.split('/'), ...rel.split('/')), 'utf8');
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

test('从旧版各环境独立拷贝升级：用户配置并入单一来源，旧目录备份，code-review 清理', { skip: oldSkip }, () => {
  const p = project('upgrade');
  p.oldLayout();
  assert.ok(p.isDir('.claude/skills/dev') && p.isFile('.claude/skills/dev/profile.json') && !p.exists('.claude/skills/workflow'));
  fillWiki(p, '.claude/skills/md-to-wiki/wiki-config.json', 'https://wiki.example.com');
  fillProfile(p, '.claude/skills/dev/profile.json', 'main');
  p.write('.qwen/skills/database-query/config.json', '{"connections":{"default":{"host":"db.local","database":"x"}}}\n');
  p.write('.qwen/skills/database-query/references/schema.md', '# qwen schema\n');
  const wiki = p.read('.claude/skills/md-to-wiki/wiki-config.json');
  const profile = p.read('.claude/skills/dev/profile.json');
  const cfg = p.read('.qwen/skills/database-query/config.json');

  ok(p.install(['--envs', 'claude,qwen', '--yes', '--skip-db']));
  assertLinked(p, '.claude/skills');
  assertLinked(p, '.qwen/skills');
  const c = '.agents/skills';
  if (SYMLINK_OK) {
    assert.equal(p.read(`${c}/md-to-wiki/wiki-config.json`), wiki);
    assert.equal(p.read(`${c}/workflow/profile.json`), profile);
    assert.ok(!p.exists(`${c}/dev/profile.json`));
    assert.equal(p.read(`${c}/database-query/config.json`), cfg);
    assert.equal(p.read(`${c}/database-query/references/schema.md`), '# qwen schema\n');
    const [b] = backups(p, 'claude/md-to-wiki');
    assert.ok(b, '缺少 claude 的 md-to-wiki 备份');
    assert.equal(fs.readFileSync(path.join(b, 'wiki-config.json'), 'utf8'), wiki);
    for (const e of ['claude', 'qwen']) for (const s of ['dev', 'database-query', 'md-to-wiki', 'create-tech-md-doc', 'create-release-md-doc']) {
      assert.equal(backups(p, `${e}/${s}`).length, 1, `${e}/${s} 的备份数量`);
    }
  } else {
    // 建不了链接时不动旧目录：用户配置原地保留、不做备份，模板照常更新
    assert.equal(p.read('.claude/skills/md-to-wiki/wiki-config.json'), wiki);
    assert.equal(p.read('.claude/skills/dev/SKILL.md'), repoFile('dev/SKILL.md.tpl'));
    assert.ok(p.isFile('.claude/skills/workflow/SKILL.md'));
    assert.ok(!p.exists('tmp/skills/backup'));
  }
  for (const e of ['.agents', '.claude', '.qwen']) assert.ok(!p.exists(`${e}/skills/code-review`), `${e}/skills/code-review`);
});

test('旧布局两边配置都填过且不同：保留旧目录不建链接，其余照常', { skip: oldSkip || (!SYMLINK_OK && '需要软链接') }, () => {
  const p = project('conflict');
  p.oldLayout();
  fillWiki(p, '.agents/skills/md-to-wiki/wiki-config.json', 'https://a.example.com');
  fillWiki(p, '.claude/skills/md-to-wiki/wiki-config.json', 'https://b.example.com');
  const a = p.read('.agents/skills/md-to-wiki/wiki-config.json');
  const b = p.read('.claude/skills/md-to-wiki/wiki-config.json');
  ok(p.install(['--envs', 'claude,qwen', '--yes', '--skip-db']));
  assert.ok(p.isDir('.claude/skills/md-to-wiki'));
  assert.equal(p.read('.claude/skills/md-to-wiki/wiki-config.json'), b);
  assert.equal(p.read('.agents/skills/md-to-wiki/wiki-config.json'), a);
  assert.equal(backups(p, 'claude/md-to-wiki').length, 0);
  assertLinked(p, '.claude/skills', SKILLS.filter((s) => s !== 'md-to-wiki'));
  assertLinked(p, '.qwen/skills');
});

test('.gitignore 只追加缺失的规则，重跑不重复', () => {
  const p = project('gitignore');
  p.write('.gitignore', 'node_modules/\n**/wiki-config.json\n.env');
  ok(p.install(['--envs', 'claude', '--yes', '--skip-db']));
  const lines = p.read('.gitignore').split(/\r?\n/);
  for (const r of ['**/database-query/config.json', '**/wiki-config.json', '/tmp/', 'node_modules/', '.env']) {
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
  assert.deepEqual(Object.keys(p.json('.agents/skills/.skills-init.json').skills).sort(), ['md-to-wiki', 'project-review', 'workflow']);
  assertLinked(p, '.claude/skills', ['workflow', 'project-review', 'md-to-wiki']);
  r = p.install(['upgrade']); ok(r);
  assert.match(r.log, /安装的 skill：workflow project-review md-to-wiki/);
  assert.ok(!p.exists('.agents/skills/dev'), 'upgrade 只升级装过的 skill');
  const status = JSON.parse(spawnSync(process.execPath, [p.at('.agents/skills/workflow/scripts/resolve.mjs'), 'status'], { cwd: p.P, encoding: 'utf8' }).stdout);
  assert.deepEqual(status.skills.sort(), ['md-to-wiki', 'project-review', 'workflow']);
  assert.deepEqual(status.templates.map((t) => t.skill), ['project-review', 'project-review']);
  r = p.install(['--envs', 'claude', '--yes', '--skip-db', '--skills', 'nope']);
  assert.equal(r.status, 1); assert.match(r.log, /未知的 skill：nope/);
});

test('共享参考文件：仓库只有一份，装进每个声明它的 skill；改源文件后重跑全部更新', () => {
  const p = project('shared');
  ok(p.install(['--envs', 'codex', '--yes', '--skip-db']));
  const users = ['dev', 'create-tech-md-doc', 'create-release-md-doc'];
  for (const s of users) assert.equal(p.read(`.agents/skills/${s}/references/prd-fetch.md`), repoFile('shared/prd-fetch.md'), s);
  assert.ok(!p.exists('.agents/skills/project-review/references/prd-fetch.md'));
  fs.appendFileSync(p.at('skills-init/shared/prd-fetch.md'), '\n<!-- 新版 -->\n');
  ok(p.install(['--envs', 'codex', '--yes', '--skip-db']));
  for (const s of users) assert.match(p.read(`.agents/skills/${s}/references/prd-fetch.md`), /新版/, s);
  ok(p.install(['--envs', 'codex', '--yes', '--skip-db', '--skills', 'database-query']));
  ok(p.install(['uninstall']));
  for (const s of users) assert.ok(!p.exists(`.agents/skills/${s}`), s);
});
