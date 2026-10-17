// DocNexus 放在团队文档仓库（workflow/profile.json 的 docnexus.root）：和产物共用一个仓库。
// 用假的 DocNexus 工作区与 CLI：脚本在那里运行、路径带上位置，本项目链接它的 skills 并写 CLAUDE.md / AGENTS.md 段落，卸载时撤掉
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

function workspace(envs = 'codex,claude') {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dnroot-'));
  const docs = path.join(ws, 'team-docs');
  const put = (rel, text, mode) => { const f = path.join(docs, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text, mode ? { mode } : undefined); };
  fs.mkdirSync(docs);
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: docs });
  put('docnexus/project.json', '{}');
  put('docnexus/node_modules/.bin/docnexus', FAKE, 0o755);
  put('docnexus/CONCEPTS.md', '# 概念\n');
  for (const s of ['docnexus', 'docnexus-recall']) put(`docnexus/skills/${s}/SKILL.md`, `---\nname: ${s}\n---\n`);
  put('docnexus/library/templates/create-tech-md-doc/template.md', '# 【技术方案】{{文档标题}}\n\n## 背景 *\n');
  put('docs.json', JSON.stringify([{ id: 'a', category: 'dev-notes', title: '订单幂等约定', summary: 's', file_path: 'dev/a.md', updated_at: '2026-10-01', tags: [] }]));
  spawnSync('git', [...G, 'add', '-A'], { cwd: docs }); spawnSync('git', [...G, 'commit', '-q', '-m', 'init'], { cwd: docs });

  const root = path.join(ws, 'order-service');
  fs.mkdirSync(root);
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  spawnSync('git', [...G, 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: root });
  spawnSync('git', ['checkout', '-q', '-b', 'feature/x'], { cwd: root });
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# 项目说明\n\n手写的内容\n');
  const cli = (...a) => spawnSync(process.execPath, [path.join(REPO, 'bin/skills-init.mjs'), '--project-root', root, ...a], { cwd: root, encoding: 'utf8', env: { ...process.env, SKILLS_INIT_ADMIN: '1' } });
  const r = cli('--envs', envs, '--skip-db', '--yes', '--docnexus-root', '../team-docs');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const script = (s, ...a) => { const x = spawnSync(process.execPath, [path.join(root, '.agents/skills/workflow/scripts', s), ...a], { cwd: root, encoding: 'utf8', env: { ...process.env, FAKE_LOG: path.join(ws, 'calls.log') } }); return { code: x.status, out: x.stdout.trim().startsWith('{') ? JSON.parse(x.stdout) : x.stdout, err: x.stderr }; };
  return { ws, docs, root, cli, script, install: r, calls: () => fs.readFileSync(path.join(ws, 'calls.log'), 'utf8') };
}

test('--docnexus-root：写进画像，本项目链接 DocNexus 的 skills、写 CLAUDE.md / AGENTS.md 段落（不动手写内容）', { skip }, () => {
  const { ws, docs, root, install } = workspace();
  assert.match(install.stdout, /DocNexus 位置：\.\.\/team-docs\/docnexus\//);
  const profile = JSON.parse(fs.readFileSync(path.join(root, '.agents/skills/workflow/profile.json'), 'utf8'));
  assert.deepEqual(profile.docnexus, { root: '../team-docs' });
  for (const dir of ['.agents/skills', '.claude/skills']) {
    const link = path.join(root, dir, 'docnexus-recall');
    assert.ok(fs.lstatSync(link).isSymbolicLink(), dir);
    assert.ok(!path.isAbsolute(fs.readlinkSync(link)), '相对链接，换机器克隆到同样的相对位置也能用');
    assert.equal(fs.realpathSync(link), fs.realpathSync(path.join(docs, 'docnexus/skills/docnexus-recall')));
  }
  const claude = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /^# 项目说明\n\n手写的内容\n\n<!-- skills-init:docnexus:start -->/);
  assert.match(claude, /@\.\.\/team-docs\/docnexus\/CONCEPTS\.md/);
  assert.match(claude, /先 `cd \.\.\/team-docs` 再运行/);
  assert.match(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /`\.\.\/team-docs\/docnexus\/CONCEPTS\.md`（每个任务开始时读）/);
  assert.ok(!fs.existsSync(path.join(docs, 'CLAUDE.md')), '不往文档仓库里写 agent 段落');
  fs.rmSync(ws, { recursive: true, force: true });
});

test('脚本：status 给出位置与运行前缀；模板从文档仓库取；knowledge 在那里运行并给出可读路径', { skip }, () => {
  const { ws, docs, script, calls } = workspace();
  const st = script('resolve.mjs', 'status').out.docnexus;
  assert.deepEqual([st.ok, st.root, st.bin, st.run_in], [true, '../team-docs', '../team-docs/docnexus/node_modules/.bin/docnexus', 'cd ../team-docs && ']);
  const t = script('resolve.mjs', 'template', 'create-tech-md-doc', 'template.md').out;
  assert.deepEqual([t.source, t.path], ['docnexus', '../team-docs/docnexus/library/templates/create-tech-md-doc/template.md']);
  const k = script('knowledge.mjs', 'dev');
  assert.equal(k.code, 0, k.err);
  const d = k.out.categories.find((c) => c.category === 'dev-notes').documents[0];
  assert.deepEqual([d.path, d.file], ['docnexus/library/dev/a.md', '../team-docs/docnexus/library/dev/a.md']);
  assert.equal(k.out.docnexus_root, '../team-docs');
  assert.ok(calls().split('\n').filter(Boolean).every((l) => l.startsWith(fs.realpathSync(docs)) || l.startsWith(docs)), '在文档仓库里运行');
  fs.rmSync(ws, { recursive: true, force: true });
});

test('和产物共用文档仓库：docnexus 目录不当成需求；知识库改动在 pending 里单独列出', { skip }, () => {
  const { ws, docs, root, script } = workspace();
  script('requirement.mjs', 'config', '--repo', '../team-docs', '--project', 'order-service');
  const w = script('requirement.mjs', 'which').out;
  assert.deepEqual(w.other_projects, [], 'docnexus/ 不是需求');
  assert.equal(script('requirement.mjs', 'bind', '--name', 'docnexus').out.dir, '../team-docs/docnexus-2/order-service', '需求名撞上保留目录时换名');
  fs.mkdirSync(path.join(docs, 'docnexus/library/dev'), { recursive: true });
  fs.writeFileSync(path.join(docs, 'docnexus/library/dev/new.md'), '# 新沉淀\n');
  const p = script('requirement.mjs', 'pending').out;
  assert.deepEqual(p.knowledge_files, ['docnexus/library/dev/new.md']);
  assert.match(p.knowledge_commands[1], /commit -m "knowledge: <沉淀了什么>"/);
  const v = script('view.mjs', '--out', 'tmp/v.html');
  assert.equal(v.code, 0, v.err);
  assert.ok(!/"name":"docnexus"/.test(fs.readFileSync(path.join(root, 'tmp/v.html'), 'utf8')));
  fs.rmSync(ws, { recursive: true, force: true });
});

test('doctor 报告位置；升级刷新链接；卸载撤掉链接和段落，文档仓库不动；--docnexus-root . 改回本项目', { skip }, () => {
  const { ws, docs, root, cli } = workspace();
  let r = cli('doctor', '--offline');
  assert.match(r.stdout + r.stderr, /DocNexus 在 \.\.\/team-docs\/docnexus\/（和产物共用的仓库），本项目已链接它的 skills 并写入段落/);

  fs.mkdirSync(path.join(docs, 'docnexus/skills/docnexus-library'));
  fs.rmSync(path.join(root, '.claude/skills/docnexus-recall'));
  r = cli('upgrade');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.lstatSync(path.join(root, '.claude/skills/docnexus-recall')).isSymbolicLink(), '升级补回链接');
  assert.ok(fs.lstatSync(path.join(root, '.agents/skills/docnexus-library')).isSymbolicLink(), 'DocNexus 新增的 skill 也链接上');
  assert.equal(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8').match(/skills-init:docnexus:start/g).length, 1, '段落不重复');

  r = cli('uninstall');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /已移除指向 \.\.\/team-docs\/docnexus\/skills 的 \d+ 个 DocNexus skill 链接，以及 CLAUDE\.md、AGENTS\.md 里的 DocNexus 段落/);
  assert.equal(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), '# 项目说明\n\n手写的内容\n');
  assert.ok(!fs.existsSync(path.join(root, 'AGENTS.md')), '只有段落的文件删掉');
  assert.ok(fs.existsSync(path.join(docs, 'docnexus/skills/docnexus-recall/SKILL.md')), '文档仓库里的 DocNexus 不动');
  fs.rmSync(ws, { recursive: true, force: true });
});

test('--docnexus-root . 改回本项目；之后不再链接文档仓库里的 skills', { skip }, () => {
  const { ws, root, cli, script } = workspace('codex');
  const r = cli('--envs', 'codex', '--skip-db', '--yes', '--docnexus-root', '.');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /DocNexus 位置：本项目 docnexus\//);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.agents/skills/workflow/profile.json'), 'utf8')).docnexus, undefined);
  const st = script('resolve.mjs', 'status').out.docnexus;
  assert.deepEqual([st.ok, st.root, st.run_in], [false, '.', null]);
  fs.rmSync(ws, { recursive: true, force: true });
});
