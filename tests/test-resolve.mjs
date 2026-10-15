// workflow/scripts/resolve.mjs：用真实安装器装到临时项目，再验证模板来源、画像、能力探测
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-'));
  const r = spawnSync(process.execPath, [path.join(REPO, 'bin', 'skills-init.mjs'), '--project-root', root, '--envs', 'codex,claude', '--skip-db', '--yes'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const resolve = (...args) => {
    // 经 .claude 下的软链接调用，和 Claude Code 中的实际路径一致（Windows 建不了链接时退回 .agents）
    const viaLink = fs.lstatSync(path.join(root, '.claude', 'skills', 'workflow')).isSymbolicLink();
    const res = spawnSync(process.execPath, [path.join(root, viaLink ? '.claude' : '.agents', 'skills', 'workflow', 'scripts', 'resolve.mjs'), ...args], { cwd: root, encoding: 'utf8' });
    return { status: res.status, out: res.stdout ? JSON.parse(res.stdout) : null, stderr: res.stderr };
  };
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  return { root, resolve, put };
}
const connect = (put) => { put('docnexus/project.json', '{}'); put('node_modules/.bin/docnexus', ''); put('node_modules/.bin/docnexus.cmd', ''); };

test('未接入 DocNexus：项目文件优先，其次默认模板', () => {
  const { root, resolve, put } = project();
  let r = resolve('template', 'create-tech-md-doc', 'template.md');
  assert.equal(r.status, 0);
  assert.equal(r.out.source, 'default');
  assert.equal(r.out.path, '.agents/skills/create-tech-md-doc/template.md');
  assert.equal(resolve('template', 'project-review', 'checklist.md').out.path, '.agents/skills/project-review/references/checklist.md');
  put('docs/skills/templates/create-tech-md-doc/template.md', '# 团队模板');
  r = resolve('template', 'create-tech-md-doc', 'template.md');
  assert.deepEqual([r.out.source, r.out.path], ['project', 'docs/skills/templates/create-tech-md-doc/template.md']);
  assert.equal(resolve('template', 'dev', 'nope.md').status, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('已接入 DocNexus：只用知识库，缺失退出 2 并给出导入来源', () => {
  const { root, resolve, put } = project();
  connect(put);
  put('docs/skills/templates/dev/plan-template.md', '# 旧项目模板');
  let r = resolve('template', 'dev', 'plan-template.md');
  assert.equal(r.status, 2);
  assert.equal(r.out.error, 'missing');
  assert.equal(r.out.expected, 'docnexus/library/templates/dev/plan-template.md');
  assert.equal(r.out.import_from, 'docs/skills/templates/dev/plan-template.md');
  assert.match(r.out.hint, /--seed-templates/);
  put('docnexus/library/templates/dev/plan-template.md', '# 库里的模板');
  r = resolve('template', 'dev', 'plan-template.md');
  assert.equal(r.status, 0);
  assert.equal(r.out.source, 'docnexus');
  assert.equal(r.out.stale_project_file, 'docs/skills/templates/dev/plan-template.md');
  const s = resolve('status').out;
  assert.equal(s.docnexus.ok, true);
  assert.ok(s.docnexus.missing_templates.includes('docnexus/library/templates/create-tech-md-doc/template.md'));
  assert.ok(!s.docnexus.missing_templates.includes('docnexus/library/templates/dev/plan-template.md'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('画像空字段与能力探测不输出凭据', () => {
  const { root, resolve, put } = project();
  let p = resolve('profile').out;
  assert.equal(p.complete, false);
  assert.ok(p.empty.includes('main_branch'));
  put('.agents/skills/workflow/profile.json', JSON.stringify({ main_branch: 'main', build: 'mvn package', test: 'mvn test', deploy: { platform: 'x', regions: [] } }));
  p = resolve('profile').out;
  assert.equal(p.complete, true);
  assert.ok(p.empty.includes('deploy.regions') && !p.empty.includes('deploy.platform'));
  put('.agents/skills/database-query/config.json', JSON.stringify({ default_connection: 'dev', connections: { dev: { driver: 'mysql', host: 'h', user: 'u', password: 'TOPSECRET' }, rw: { readonly: false, password_env: 'X' } } }));
  const r = spawnSync(process.execPath, [path.join(root, '.agents/skills/workflow/scripts/resolve.mjs'), 'status'], { cwd: root, encoding: 'utf8' });
  assert.doesNotMatch(r.stdout, /TOPSECRET|"host"|"user"/);
  const s = JSON.parse(r.stdout);
  assert.deepEqual(s.database.connections, { dev: { driver: 'mysql', readonly: true }, rw: { driver: 'mysql', readonly: false } });
  assert.equal(s.profile.ok, true);
  assert.equal(s.wiki.ok, false);
  assert.equal(s.docnexus.ok, false);
  assert.equal(s.templates.length, 6);
  fs.rmSync(root, { recursive: true, force: true });
});

test('category：skill.json 声明的显式分类，项目画像可覆盖，未声明 / 非法时退出 1', () => {
  const { root, resolve, put } = project();
  let r = resolve('category', 'create-tech-md-doc');
  assert.equal(r.status, 0);
  assert.equal(r.out.source, 'skill');
  assert.equal(r.out.category, 'tech-design');
  assert.deepEqual(r.out.seal_args, ['--category', 'tech-design', '--category-reason', r.out.reason]);
  assert.deepEqual(r.out.metadata, { category: 'tech-design', category_reason: r.out.reason });
  r = resolve('category', 'database-query');
  assert.equal(r.status, 1);
  assert.equal(r.out.error, 'none');
  assert.equal(resolve('category', 'nope').out.error, 'unknown');
  const profile = path.join(root, '.agents/skills/workflow/profile.json');
  const p = JSON.parse(fs.readFileSync(profile, 'utf8'));
  put('.agents/skills/workflow/profile.json', JSON.stringify({ ...p, docnexus_categories: { 'create-tech-md-doc': '技术方案', dev: ' 带空格 ' } }));
  r = resolve('category', 'create-tech-md-doc');
  assert.deepEqual([r.out.source, r.out.category], ['profile', '技术方案']);
  r = resolve('category', 'dev');
  assert.deepEqual([r.status, r.out.error], [1, 'invalid']);
  const s = resolve('status').out;
  assert.equal(s.docnexus.categories['create-tech-md-doc'], '技术方案');
  assert.equal(s.docnexus.categories['create-release-md-doc'], 'release-plan');
  assert.ok(!('database-query' in s.docnexus.categories));
  fs.rmSync(root, { recursive: true, force: true });
});
