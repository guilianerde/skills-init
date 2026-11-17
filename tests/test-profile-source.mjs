import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  artifactsConfig,
  profileSources,
  resolveProfileDir,
  setProfileSource,
} from '../workflow/lib/project.mjs';
import { createWorkflow, WORKFLOW_ERROR_CODES, WorkflowError } from '../workflow/core/index.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = path.join(REPO, 'workflow/scripts/requirement.mjs');

function project(t, name = 'svc') {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-source-'));
  const root = path.join(parent, name);
  fs.mkdirSync(root);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  const put = (rel, value) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  };
  const cli = (...args) => spawnSync(process.execPath, [SCRIPT, '--root', root, ...args], { encoding: 'utf8' });
  return { root, put, cli };
}

const profile = (projectName) => ({
  main_branch: 'main',
  build: 'npm run build',
  test: 'npm test',
  artifacts: { project: projectName },
});

const expectAmbiguous = (fn, reason) => assert.throws(fn, (error) => {
  assert.equal(error.code, 'PROJECT_CONFIG_AMBIGUOUS');
  if (reason) assert.equal(error.details.reason, reason);
  assert.match(error.message, /config --profile-source/);
  return true;
});

test('--copy 生成相同 profile 时自动视为等价来源', (t) => {
  const f = project(t);
  f.put('.claude/skills/workflow/profile.json', profile('same'));
  f.put('.qwen/skills/workflow/profile.json', profile('same'));

  const resolved = resolveProfileDir(f.root);
  assert.equal(resolved.base, '.claude/skills');
  assert.equal(resolved.selected_by, 'equivalent_profiles');
  assert.equal(artifactsConfig(f.root).project, 'same');
  assert.deepEqual(profileSources(f.root).map(({ env, dir }) => [env, dir]), [
    ['claude', '.claude/skills/workflow'],
    ['qwen', '.qwen/skills/workflow'],
  ]);
});

test('profile 内容不同时必须显式选择，且选择可持久化、可清除', (t) => {
  const f = project(t);
  f.put('.claude/skills/workflow/profile.json', profile('claude'));
  f.put('.qwen/skills/workflow/profile.json', profile('qwen'));
  expectAmbiguous(() => artifactsConfig(f.root), 'different_profiles');
  expectAmbiguous(() => createWorkflow({ root: f.root }).requirements.which({ branch: 'feature/x' }), 'different_profiles');

  const selected = setProfileSource(f.root, 'qwen');
  assert.equal(selected.profile_dir, '.qwen/skills/workflow');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root, 'workflow-run/profile-source.json'), 'utf8')), {
    profile_dir: '.qwen/skills/workflow',
  });
  const resolved = resolveProfileDir(f.root);
  assert.equal(resolved.base, '.qwen/skills');
  assert.equal(resolved.selected_by, 'profile-source');
  assert.equal(artifactsConfig(f.root).project, 'qwen');

  const cleared = setProfileSource(f.root, 'auto');
  assert.equal(cleared.cleared, true);
  expectAmbiguous(() => artifactsConfig(f.root), 'different_profiles');
});

test('显式来源覆盖规范目录，但损坏、越界或已删除的来源明确失败', (t) => {
  const f = project(t);
  f.put('.agents/skills/workflow/profile.json', profile('canonical'));
  f.put('.qwen/skills/workflow/profile.json', profile('qwen'));
  assert.equal(resolveProfileDir(f.root).base, '.agents/skills');

  setProfileSource(f.root, '.qwen/skills/workflow');
  assert.equal(resolveProfileDir(f.root).base, '.qwen/skills');
  expectAmbiguous(() => setProfileSource(f.root, '../outside'), 'invalid_source');

  f.put('workflow-run/profile-source.json', '{ bad json');
  expectAmbiguous(() => resolveProfileDir(f.root), 'invalid_source');

  fs.rmSync(path.join(f.root, '.qwen/skills/workflow'), { recursive: true, force: true });
  f.put('workflow-run/profile-source.json', JSON.stringify({ profile_dir: '.qwen/skills/workflow' }));
  expectAmbiguous(() => resolveProfileDir(f.root), 'invalid_source');
});

test('config CLI 可设置和清除 profile 来源，错误保留稳定 code 与候选路径', (t) => {
  const f = project(t);
  f.put('.claude/skills/workflow/profile.json', profile('claude'));
  f.put('.qwen/skills/workflow/profile.json', profile('qwen'));

  const ambiguous = f.cli('config');
  assert.equal(ambiguous.status, 1);
  const error = JSON.parse(ambiguous.stderr);
  assert.equal(error.code, 'PROJECT_CONFIG_AMBIGUOUS');
  assert.deepEqual(error.details.paths, ['.claude/skills/workflow', '.qwen/skills/workflow']);

  const selected = f.cli('config', '--profile-source', 'qwen');
  assert.equal(selected.status, 0, selected.stderr);
  assert.equal(JSON.parse(selected.stdout).profile_dir, '.qwen/skills/workflow');
  const status = f.cli('config');
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).project, 'qwen');
  assert.equal(JSON.parse(status.stdout).profile_source.selected_by, 'profile-source');

  const cleared = f.cli('config', '--profile-source', 'auto');
  assert.equal(cleared.status, 0, cleared.stderr);
  assert.equal(JSON.parse(cleared.stdout).cleared, true);
  assert.equal(fs.existsSync(path.join(f.root, 'workflow-run/profile-source.json')), false);
});

test('核心把 profile 来源错误统一映射为 WorkflowError', (t) => {
  const f = project(t);
  f.put('.claude/skills/workflow/profile.json', profile('claude'));
  f.put('.qwen/skills/workflow/profile.json', profile('qwen'));
  assert.throws(() => createWorkflow({ root: f.root }).requirements.which({ branch: 'feature/x' }), (error) => {
    assert.ok(error instanceof WorkflowError);
    assert.equal(error.code, WORKFLOW_ERROR_CODES.PROJECT_CONFIG_AMBIGUOUS);
    assert.equal(error.details.reason, 'different_profiles');
    return true;
  });
});
