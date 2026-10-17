// 本工具的产出都在项目根的 skills-init/：DocNexus 工作区 skills-init/docnexus/（以 skills-init/ 为项目根运行）、
// 需求产物、项目模板、临时文件。用假的 DocNexus 工作区与 CLI：本项目链接它的 skills 并写 CLAUDE.md / AGENTS.md 段落，
// 脚本在 skills-init/ 下运行；卸载撤掉链接和段落，产出不删
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const skip = process.platform === 'win32' ? '假 CLI 与软链接用 POSIX 实现，Windows 跳过' : false;
const G = ['-c', 'user.email=t@t', '-c', 'user.name=t'];

// 假 docnexus：记录运行目录；document query 从运行目录下的 docs.json 返回
const FAKE = `#!/usr/bin/env node
const fs = require('fs');
fs.appendFileSync(process.env.FAKE_LOG || '/dev/null', process.cwd() + ' ' + process.argv.slice(2).join(' ') + '\\n');
const [cmd, sub, ...rest] = process.argv.slice(2);
if (cmd === '--help') { console.log('  docnexus recall "q" --limit 5 [--category <name>]\\n  docnexus draft seal --category-reason'); process.exit(0); }
if (cmd === 'recall') { console.log(JSON.stringify({ query: sub, context_groups: [] })); process.exit(0); }
if (cmd === 'document' && sub === 'query') {
  const cat = rest[rest.indexOf('--category') + 1];
  const docs = JSON.parse(fs.readFileSync('docs.json', 'utf8')).filter((d) => d.category === cat);
  console.log(JSON.stringify({ documents: docs.map((d) => ({ ...d, library_path: 'docnexus/library/' + d.file_path })) }));
  process.exit(0);
}
process.exit(1);
`;

// 在 base（相对项目根）下放一个假的 DocNexus 项目：<base>/docnexus/ 工作区 + CLI + skills + 一份知识库模板
function fakeDocNexus(root, base) {
  const put = (rel, text, mode) => { const f = path.join(root, base, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text, mode ? { mode } : undefined); };
  put('docnexus/project.json', '{}');
  put('docnexus/node_modules/.bin/docnexus', FAKE, 0o755);
  put('docnexus/CONCEPTS.md', '# 概念\n');
  for (const s of ['docnexus', 'docnexus-recall']) put(`docnexus/skills/${s}/SKILL.md`, `---\nname: ${s}\n---\n`);
  put('docnexus/library/templates/create-tech-md-doc/template.md', '# 【技术方案】{{文档标题}}\n\n## 背景 *\n');
  put('docs.json', JSON.stringify([{ id: 'a', category: 'dev-notes', title: '订单幂等约定', summary: 's', file_path: 'dev/a.md', updated_at: '2026-10-01', tags: [] }]));
}

function project() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  const root = path.join(ws, 'order-service');
  fs.mkdirSync(root);
  const git = (...a) => spawnSync('git', [...G, ...a], { cwd: root, encoding: 'utf8' });
  git('init', '-q', '-b', 'main'); git('commit', '-q', '--allow-empty', '-m', 'init'); git('checkout', '-q', '-b', 'feature/x');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# 项目说明\n\n手写的内容\n');
  const cli = (...a) => spawnSync(process.execPath, [path.join(REPO, 'bin/skills-init.mjs'), '--project-root', root, ...a], { cwd: root, encoding: 'utf8', env: { ...process.env, SKILLS_INIT_ADMIN: '1' } });
  const install = (envs = 'codex,claude') => { const r = cli('--envs', envs, '--skip-db', '--yes'); assert.equal(r.status, 0, r.stdout + r.stderr); return r; };
  const script = (s, ...a) => { const x = spawnSync(process.execPath, [path.join(root, '.agents/skills/workflow/scripts', s), ...a], { cwd: root, encoding: 'utf8', env: { ...process.env, FAKE_LOG: path.join(ws, 'calls.log') } }); return { code: x.status, out: x.stdout.trim().startsWith('{') ? JSON.parse(x.stdout) : x.stdout, err: x.stderr }; };
  const put = (rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  const exists = (rel) => { try { fs.lstatSync(path.join(root, rel)); return true; } catch { return false; } };
  return { ws, root, git, cli, install, script, put, read, exists, calls: () => fs.readFileSync(path.join(ws, 'calls.log'), 'utf8') };
}

test('DocNexus 在 skills-init/docnexus/：本项目链接它的 skills（相对链接）、写 CLAUDE.md / AGENTS.md 段落，不动手写内容', { skip }, () => {
  const p = project();
  fakeDocNexus(p.root, 'skills-init');
  p.install();
  for (const dir of ['.agents/skills', '.claude/skills']) {
    const link = path.join(p.root, dir, 'docnexus-recall');
    assert.ok(fs.lstatSync(link).isSymbolicLink(), dir);
    assert.ok(!path.isAbsolute(fs.readlinkSync(link)), '相对链接，换机器克隆也能用');
    assert.equal(fs.realpathSync(link), fs.realpathSync(path.join(p.root, 'skills-init/docnexus/skills/docnexus-recall')));
  }
  const claude = p.read('CLAUDE.md');
  assert.match(claude, /^# 项目说明\n\n手写的内容\n\n<!-- skills-init:docnexus:start -->/);
  assert.match(claude, /@skills-init\/docnexus\/CONCEPTS\.md/);
  assert.match(claude, /`node \.claude\/skills\/workflow\/scripts\/docnexus\.mjs <参数>`/);
  assert.doesNotMatch(claude, /cd skills-init/);
  assert.match(p.read('AGENTS.md'), /`node \.agents\/skills\/workflow\/scripts\/docnexus\.mjs --node docnexus\/skills\/<…>\.mjs <参数>`/);
  assert.match(p.read('AGENTS.md'), /`skills-init\/docnexus\/CONCEPTS\.md`（每个任务开始时读）/);
  assert.ok(!p.exists('skills-init/CLAUDE.md'), '不往 skills-init/ 里写 agent 段落');
  assert.equal(p.install().stdout.match(/CLAUDE\.md 已写入/g), null, '重跑段落不变');
  assert.equal(p.read('CLAUDE.md').match(/skills-init:docnexus:start/g).length, 1);
  fs.rmSync(p.ws, { recursive: true, force: true });
});

test('脚本：status 给出位置与运行前缀；模板从 skills-init/docnexus/library 取；knowledge 在 skills-init/ 下运行并给出可读路径', { skip }, () => {
  const p = project();
  fakeDocNexus(p.root, 'skills-init');
  p.install();
  const st = p.script('resolve.mjs', 'status').out.docnexus;
  assert.deepEqual([st.ok, st.root, st.bin, st.run], [true, 'skills-init', './skills-init/docnexus/node_modules/.bin/docnexus', 'node .agents/skills/workflow/scripts/docnexus.mjs']);
  // 包装脚本：在 skills-init/ 下运行 CLI 与 node 脚本，输出、退出码透传
  let w = p.script('docnexus.mjs', 'recall', '订单');
  assert.equal(w.code, 0, w.err);
  assert.equal(w.out.query, '订单');
  p.put('skills-init/docnexus/skills/docnexus-library/scripts/q.mjs', "console.log(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) })); process.exit(3);\n");
  w = p.script('docnexus.mjs', '--node', 'docnexus/skills/docnexus-library/scripts/q.mjs', '--category', 'dev-notes');
  assert.deepEqual([w.code, fs.realpathSync(w.out.cwd), w.out.args], [3, fs.realpathSync(path.join(p.root, 'skills-init')), ['--category', 'dev-notes']]);
  assert.equal(p.script('docnexus.mjs', 'bogus').code, 1);
  const t = p.script('resolve.mjs', 'template', 'create-tech-md-doc', 'template.md').out;
  assert.deepEqual([t.source, t.path], ['docnexus', 'skills-init/docnexus/library/templates/create-tech-md-doc/template.md']);
  const k = p.script('knowledge.mjs', 'dev');
  assert.equal(k.code, 0, k.err);
  const d = k.out.categories.find((c) => c.category === 'dev-notes').documents[0];
  assert.deepEqual([d.path, d.file], ['docnexus/library/dev/a.md', 'skills-init/docnexus/library/dev/a.md']);
  const home = fs.realpathSync(path.join(p.root, 'skills-init'));
  assert.ok(p.calls().split('\n').filter(Boolean).every((l) => l.startsWith(home + ' ')), '在 skills-init/ 下运行');
  fs.rmSync(p.ws, { recursive: true, force: true });
});

test('doctor 报告产出目录与 DocNexus；卸载撤掉链接和段落，skills-init/ 不动；没有 --docnexus-root', { skip }, () => {
  const p = project();
  fakeDocNexus(p.root, 'skills-init');
  p.install();
  let r = p.cli('doctor', '--offline');
  assert.match(r.stdout + r.stderr, /DocNexus 在 skills-init\/docnexus\/，本项目已链接它的 skills 并写入段落/);
  assert.match(r.stdout + r.stderr, /产出目录 skills-init\/：随项目提交/);

  r = p.cli('uninstall');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /已移除指向 skills-init\/docnexus\/skills 的 \d+ 个 DocNexus skill 链接，以及 CLAUDE\.md、AGENTS\.md 里的 DocNexus 段落/);
  assert.equal(p.read('CLAUDE.md'), '# 项目说明\n\n手写的内容\n');
  assert.ok(!p.exists('AGENTS.md'), '只有段落的文件删掉');
  assert.ok(p.exists('skills-init/docnexus/skills/docnexus-recall/SKILL.md'), 'skills-init/ 里的 DocNexus 不动');

  r = p.cli('--envs', 'codex', '--skip-db', '--yes', '--docnexus-root', '../team-docs');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /未知参数: --docnexus-root/);
  fs.rmSync(p.ws, { recursive: true, force: true });
});

test('skills-init/ 是独立文档仓库：DocNexus 在里面，知识库改动在 pending 里单独列出', { skip }, () => {
  const p = project();
  fs.mkdirSync(path.join(p.root, 'skills-init'));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: path.join(p.root, 'skills-init') });
  fakeDocNexus(p.root, 'skills-init');
  p.install();
  p.script('requirement.mjs', 'config', '--project', 'order-service');
  p.script('requirement.mjs', 'bind', '--name', '订单导出');
  p.put('skills-init/docnexus/library/dev/new.md', '# 新沉淀\n');
  const pd = p.script('requirement.mjs', 'pending').out;
  assert.ok(pd.knowledge_files.includes('docnexus/library/dev/new.md'));
  assert.match(pd.knowledge_commands[1], /^git -C "skills-init" commit -m "knowledge: <沉淀了什么>"$/);
  assert.match(p.read('.gitignore'), /^\/skills-init\/$/m, '代码仓库忽略整个 skills-init/');
  fs.rmSync(p.ws, { recursive: true, force: true });
});
