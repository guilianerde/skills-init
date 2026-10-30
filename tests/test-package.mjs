// 从实际发布包安装，避免源码测试通过但 npm files 漏掉运行时文件。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadSkills } from '../bin/skills.mjs';
import { withLocalDocNexus } from './helpers/docnexus-pkg.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));

test('npm 发布包：安装 CLI、全部 skills、执行已安装脚本、卸载并保留用户产物', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-package-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const root = path.join(tmp, 'project');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'package.json'), '{"private":true}');
  const env = { ...withLocalDocNexus(), WORKFLOW_RUN_ADMIN: '1' };
  const run = (cmd, args, cwd = root, shell = false) => {
    const r = spawnSync(cmd, args, { cwd, env, shell, encoding: 'utf8', timeout: 120_000 });
    assert.equal(r.status, 0, `${cmd} ${args.join(' ')}\n${r.error ?? ''}\n${r.stdout}\n${r.stderr}`);
    return r.stdout;
  };
  // npm test / npm run test:package 提供 npm_execpath；也支持直接 node --test。
  const npm = (args, cwd) => process.env.npm_execpath
    ? run(process.execPath, [process.env.npm_execpath, ...args], cwd)
    : run(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, cwd, process.platform === 'win32');
  const [packed] = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', tmp], REPO));
  npm(['install', path.join(tmp, packed.filename), '--offline', '--ignore-scripts', '--no-audit', '--no-fund']);
  assert.equal(npm(['exec', '--offline', '--', 'workflow-run', '--version']).trim(), pkg.version);

  const installed = path.join(root, 'node_modules', ...pkg.name.split('/'));
  // 首页和专题文档随包分发，包内相对链接也必须存在。
  const docs = ['README.md', ...fs.readdirSync(path.join(installed, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)];
  for (const doc of docs) {
    const text = fs.readFileSync(path.join(installed, doc), 'utf8');
    for (const [, target] of text.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(?:[a-z]+:|#)/i.test(target)) continue;
      const file = decodeURIComponent(target.split('#')[0]);
      assert.ok(fs.existsSync(path.resolve(installed, path.dirname(doc), file)), `${doc}: ${target}`);
    }
  }

  npm(['exec', '--offline', '--', 'workflow-run', '--envs', 'codex', '--copy', '--yes', '--skip-db']);
  for (const skill of loadSkills(REPO)) {
    const dir = path.join(root, '.agents', 'skills', skill.name);
    assert.ok(fs.existsSync(path.join(dir, 'SKILL.md')), skill.name);
    for (const shared of skill.shared) assert.ok(fs.existsSync(path.join(dir, 'references', shared)), `${skill.name}/${shared}`);
  }
  const status = JSON.parse(run(process.execPath, [path.join(root, '.agents/skills/workflow/scripts/resolve.mjs'), '--root', root, 'status']));
  assert.equal(status.docnexus.ok, true);
  const keep = path.join(root, 'workflow-run', 'other', 'keep.md');
  fs.mkdirSync(path.dirname(keep), { recursive: true });
  fs.writeFileSync(keep, '# 用户产物\n');
  npm(['exec', '--offline', '--', 'workflow-run', 'uninstall']);
  assert.ok(!fs.existsSync(path.join(root, '.agents/skills/.workflow-run.json')));
  for (const skill of loadSkills(REPO)) assert.ok(!fs.existsSync(path.join(root, '.agents/skills', skill.name)), skill.name);
  assert.equal(fs.readFileSync(keep, 'utf8'), '# 用户产物\n');
});
