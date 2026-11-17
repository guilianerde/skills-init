// 从实际发布包安装，避免源码测试通过但 npm files 漏掉运行时文件。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadSkills } from '../bin/skills.mjs';
import { templateParts } from '../workflow/lib/template-parts.mjs';
import { withLocalDocNexus } from './helpers/docnexus-pkg.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));

test('npm 发布包：安装 CLI、全部 skills、执行已安装脚本、卸载并保留用户产物', async (t) => {
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

  run('git', ['init', '-q', '-b', 'main']);
  run('git', ['config', 'user.name', 'Test']);
  run('git', ['config', 'user.email', 'test@example.invalid']);
  run('git', ['add', 'package.json']);
  run('git', ['commit', '-q', '-m', 'baseline']);
  const branch = 'feature/package-integration';
  run('git', ['switch', '-q', '-c', branch]);

  const workflow = await import(pathToFileURL(path.join(root, '.agents/skills/workflow/core/index.mjs')));
  const core = workflow.createWorkflow({ root });
  const binding = core.requirements.bind({ name: '包内双入口', branch, base: 'main' });
  assert.equal(binding.ok, true);
  const temp = path.join(root, 'workflow-run/tmp');
  fs.mkdirSync(temp, { recursive: true });
  const inputFile = path.join(temp, 'package-start.json');
  fs.writeFileSync(inputFile, `${JSON.stringify({
    stage: 'F3',
    steps: Object.fromEntries(['Step0', 'F1', 'F2'].map((step) => [step, { status: 'completed' }])),
    context: { summary: 'npm 包内双入口', acceptance: ['真实脚本完成收尾'] },
  }, null, 2)}\n`);
  const runScript = path.join(root, '.agents/skills/workflow/scripts/run.mjs');
  const started = JSON.parse(run(process.execPath, [
    runScript, 'start',
    '--root', root,
    '--branch', branch,
    '--kind', 'feature',
    '--size', 'S',
    '--input', inputFile,
  ]));

  const templateFile = path.join(root, 'workflow-run/docnexus/library/templates/dev/requirement-template.md');
  const requirementDraft = path.join(temp, 'package-requirement.md');
  const requirementText = templateParts(fs.readFileSync(templateFile, 'utf8')).content
    .replace(/\{\{([\s\S]*?)\}\}/g, (_, rawKey) => {
      const key = rawKey.trim();
      if (key === '需求名') return '包内双入口';
      if (key === 'S / M / L') return 'S';
      if (key === 'dev分支') return branch;
      if (key === 'YYYY-MM-DD') return '2026-11-17';
      if (/需求来源/.test(key)) return 'npm 发布包测试';
      return '无';
    })
    .replace(/<在此填写[^>]*>/g, '无');
  fs.writeFileSync(requirementDraft, requirementText);
  const checkpointFile = path.join(temp, 'package-requirement-checkpoint.json');
  fs.writeFileSync(checkpointFile, `${JSON.stringify({ steps: { F3: { status: 'completed' } } }, null, 2)}\n`);
  const artifactScript = path.join(root, '.agents/skills/workflow/scripts/artifact.mjs');
  const finalizeArgs = [
    artifactScript, 'finalize',
    '--root', root,
    '--branch', branch,
    '--id', started.run.id,
    '--expect-revision', String(started.run.revision),
    '--kind', 'requirement',
    '--draft', requirementDraft,
    '--input', checkpointFile,
  ];
  const finalized = JSON.parse(run(process.execPath, finalizeArgs));
  assert.equal(finalized.run.id, started.run.id);
  assert.equal(finalized.version, 1);
  const replay = JSON.parse(run(process.execPath, finalizeArgs));
  assert.equal(replay.alreadyFinalized, true);
  assert.equal(core.runs.get({ branch, id: started.run.id }).run.artifacts.requirement.hash, finalized.run.artifacts.requirement.hash);

  const keep = path.join(root, 'workflow-run', 'other', 'keep.md');
  fs.mkdirSync(path.dirname(keep), { recursive: true });
  fs.writeFileSync(keep, '# 用户产物\n');
  npm(['exec', '--offline', '--', 'workflow-run', 'uninstall']);
  assert.ok(!fs.existsSync(path.join(root, '.agents/skills/.workflow-run.json')));
  for (const skill of loadSkills(REPO)) assert.ok(!fs.existsSync(path.join(root, '.agents/skills', skill.name)), skill.name);
  assert.equal(fs.readFileSync(keep, 'utf8'), '# 用户产物\n');
});
