// workflow/scripts/resolve.mjs：用真实安装器装到临时项目，再验证模板来源、画像、能力探测
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { useLocalDocNexus, resetDocNexus } from './helpers/docnexus-pkg.mjs';

// 必装组件 DocNexus 用本地夹具接入：不依赖 npm registry，也不写用户的 ~/.npm。
useLocalDocNexus();

const REPO = fileURLToPath(new URL('..', import.meta.url));

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-'));
  const r = spawnSync(process.execPath, [path.join(REPO, 'bin', 'workflow-run.mjs'), '--project-root', root, '--envs', 'codex,claude', '--skip-db', '--yes'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  // 安装一定会接入 DocNexus；本文件自己搭接入状态（connect / 缺失 / 未接入），先回到基线。
  resetDocNexus(root);
  const resolve = (...args) => {
    // 经 .claude 下的软链接调用，和 Claude Code 中的实际路径一致（Windows 建不了链接时退回 .agents）
    const viaLink = fs.lstatSync(path.join(root, '.claude', 'skills', 'workflow')).isSymbolicLink();
    const res = spawnSync(process.execPath, [path.join(root, viaLink ? '.claude' : '.agents', 'skills', 'workflow', 'scripts', 'resolve.mjs'), ...args], { cwd: root, encoding: 'utf8' });
    return { status: res.status, out: res.stdout ? JSON.parse(res.stdout) : null, stderr: res.stderr };
  };
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  return { root, resolve, put };
}
const connect = (put) => { put('.docnexus/project.json', '{"format_version":7,"output_dir":"workflow-run"}'); put('.docnexus/node_modules/.bin/docnexus', ''); put('.docnexus/node_modules/.bin/docnexus.cmd', ''); };

test('未接入 DocNexus：只用默认模板，项目文件不生效；技术方案没有默认模板，退出 2 提示先接入 DocNexus', () => {
  const { root, resolve, put } = project();
  let r = resolve('template', 'create-tech-md-doc', 'template.md');
  assert.equal(r.status, 2);
  assert.deepEqual([r.out.error, r.out.need_docnexus, r.out.on_demand, r.out.docnexus], ['missing', true, undefined, false]);
  assert.match(r.out.hint, /必装组件/);
  // 包内模板只用于导入，模板一律从知识库取：未接入时 checklist 也报缺失，不回退内置默认
  const listed = resolve('template', 'project-review', 'checklist.md');
  assert.equal(listed.status, 2);
  assert.equal(listed.out.expected, 'workflow-run/docnexus/library/templates/project-review/checklist.md');
  // 未接入时提前返回，只给 expected 与「必装组件」提示，不算 import_from
  assert.equal(listed.out.import_from, undefined);
  const devTpl = resolve('template', 'dev', 'plan-template.md');
  assert.equal(devTpl.status, 2);
  assert.equal(devTpl.out.expected, 'workflow-run/docnexus/library/templates/dev/plan-template.md');
  r = resolve('template', 'no-such-skill', 'checklist.md');
  assert.deepEqual([r.status, r.out.error], [1, 'unknown']);
  assert.match(r.out.message, /没有安装/);
  const s0 = resolve('status').out;
  assert.deepEqual(s0.templates_to_create, []);
  // 未接入时 6 份模板一律报 need_docnexus（包内模板不再作为默认来源兜底）
  assert.equal(s0.templates.filter((t) => t.need_docnexus).length, 6);
  assert.deepEqual([...new Set(s0.templates.filter((t) => t.need_docnexus).map((t) => t.skill))].sort(),
    ['create-release-md-doc', 'create-tech-md-doc', 'dev', 'project-review']);
  put('workflow-run/templates/create-tech-md-doc/template.md', '# 团队模板');
  put('workflow-run/templates/dev/plan-template.md', '# 项目里的方案模板');
  r = resolve('template', 'create-tech-md-doc', 'template.md');
  assert.equal(r.status, 2, '项目模板不再生效');
  assert.equal(r.out.stale_project_file, 'workflow-run/templates/create-tech-md-doc/template.md');
  // 未接入时提前返回「必装组件」提示；项目模板不再生效由 stale_project_file 表达
  assert.match(r.out.hint, /必装组件/);
  r = resolve('template', 'dev', 'plan-template.md');
  // 未接入时同样不回退默认模板；项目目录里的旧模板只作为 stale 提示（导入来源改从包内模板取）
  assert.deepEqual([r.status, r.out.error, r.out.stale_project_file], [2, 'missing', 'workflow-run/templates/dev/plan-template.md']);
  assert.deepEqual(resolve('status').out.docnexus.stale_project_templates.sort(), ['workflow-run/templates/create-tech-md-doc/template.md', 'workflow-run/templates/dev/plan-template.md']);
  assert.equal(resolve('template', 'dev', 'nope.md').status, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('已接入 DocNexus：只用知识库，缺失退出 2 并给出导入来源', () => {
  const { root, resolve, put } = project();
  connect(put);
  put('workflow-run/templates/dev/plan-template.md', '# 旧项目模板');
  let r = resolve('template', 'dev', 'plan-template.md');
  assert.equal(r.status, 2);
  assert.equal(r.out.error, 'missing');
  assert.equal(r.out.expected, 'workflow-run/docnexus/library/templates/dev/plan-template.md');
  assert.equal(r.out.import_from, 'workflow-run/templates/dev/plan-template.md');
  assert.match(r.out.hint, /seed-templates 导入/);
  put('workflow-run/docnexus/library/templates/dev/plan-template.md', '# 库里的模板');
  r = resolve('template', 'dev', 'plan-template.md');
  assert.equal(r.status, 0);
  assert.equal(r.out.source, 'docnexus');
  assert.equal(r.out.stale_project_file, 'workflow-run/templates/dev/plan-template.md');
  const s = resolve('status').out;
  assert.equal(s.docnexus.ok, true);
  assert.ok(s.docnexus.missing_templates.includes('workflow-run/docnexus/library/templates/dev/delivery-template.md'));
  assert.ok(!s.docnexus.missing_templates.includes('workflow-run/docnexus/library/templates/dev/plan-template.md'));
  // 没有默认版本的模板不算「缺失待导入」，而是待创建；创建位置是知识库
  assert.ok(!s.docnexus.missing_templates.includes('workflow-run/docnexus/library/templates/create-tech-md-doc/template.md'));
  assert.ok(s.templates_to_create.some((t) => t.expected === 'workflow-run/docnexus/library/templates/create-tech-md-doc/template.md'));
  put('workflow-run/templates/create-release-md-doc/template.md', '# 项目里的上线方案模板');
  r = resolve('template', 'create-release-md-doc', 'template.md');
  assert.deepEqual([r.status, r.out.on_demand, r.out.import_from], [2, true, 'workflow-run/templates/create-release-md-doc/template.md']);
  assert.doesNotMatch(r.out.hint, /seed-templates/);
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

// ------------------------------------------------------------------ 开发环境配置（toolchain）
test('env --check：展开 $VAR / ~，核对路径存在性；变量没配与路径不存在都算不通过', () => {
  const { root, resolve, put } = project();
  const home = os.tmpdir();
  put('.agents/skills/workflow/profile.json', JSON.stringify({
    main_branch: 'main', build: 'mvn package', test: 'mvn test',
    toolchain: { java_home: '$JAVA_HOME', maven: { settings: '~/settings.xml', repository: '/nope/missing-repo' }, node: '$NOPE/bin' },
    env_vars: { JAVA_HOME: home },
  }));
  const r = resolve('env', '--check');
  assert.equal(r.status, 0);
  assert.equal(r.out.fields.java_home.resolved, home, '$VAR 用 env_vars 展开');
  assert.equal(r.out.fields.java_home.exists, true);
  assert.equal(r.out.fields.java_home.source, 'team');
  assert.equal(r.out.fields['maven.settings'].resolved, path.join(process.env.HOME || process.env.USERPROFILE, 'settings.xml'), '~ 展开为 HOME');
  assert.equal(r.out.fields['maven.settings'].exists, false);
  assert.deepEqual(r.out.fields['maven.repository'].resolved, '/nope/missing-repo');
  // 变量没配时，展开结果即使碰巧存在（$NOPE/bin → /bin）也必须算不通过
  assert.deepEqual(r.out.fields.node.unset_vars, ['NOPE']);
  assert.equal(r.out.fields.node.exists, false);
  assert.equal(r.out.ok, false);
  assert.deepEqual([...r.out.missing].sort(), ['maven.repository', 'maven.settings', 'node']);
  assert.ok(r.out.current && 'JAVA_HOME' in r.out.current);
  fs.rmSync(root, { recursive: true, force: true });
});

test('env --check：profile.local.json 的个人值逐个子字段覆盖团队画像；没配时给出去哪配的提示', () => {
  const { root, resolve, put } = project();
  const real = path.join(root, 'jdk'); fs.mkdirSync(real, { recursive: true });
  put('.agents/skills/workflow/profile.json', JSON.stringify({ toolchain: { java_home: '/team/other-machine-jdk', maven: { repository: '/team/repo' } } }));
  put('.agents/skills/workflow/profile.local.json', JSON.stringify({ toolchain: { java_home: real } }));
  const r = resolve('env', '--check');
  assert.deepEqual([r.out.fields.java_home.source, r.out.fields.java_home.exists], ['local', true], '本人机器上的 JDK 覆盖团队值');
  assert.deepEqual([r.out.fields['maven.repository'].source, r.out.fields['maven.repository'].exists], ['team', false], '没覆盖的字段仍用团队值');
  assert.match(r.out.how, /profile\.local\.json/);
  // status / profile 也带 toolchain（配过才给 fields）
  assert.equal(resolve('status').out.toolchain.configured, true);
  assert.equal(resolve('status').out.toolchain.fields.java_home, real);
  assert.equal(resolve('profile').out.toolchain.configured, true);
  fs.rmSync(root, { recursive: true, force: true });

  const q = project();
  const empty = q.resolve('env', '--check');
  assert.equal(empty.out.configured, false);
  assert.equal(empty.out.ok, true, '没配不算失败');
  assert.match(empty.out.how, /\/workflow profile/);
  assert.equal(q.resolve('status').out.toolchain.configured, false);
  fs.rmSync(q.root, { recursive: true, force: true });
});

// 回归：审查发现的 3 个问题之三——个人配置要能显式清空团队路径
test('env --check：profile.local.json 里写空字符串表示不用团队值，不再继承、也不再报缺失', () => {
  const { root, resolve, put } = project();
  const real = path.join(root, 'jdk'); fs.mkdirSync(real, { recursive: true });
  put('.agents/skills/workflow/profile.json', JSON.stringify({
    toolchain: { java_home: '/team/other-machine-jdk', maven: { settings: '/team/settings.xml', repository: '/team/repo' } },
  }));
  // 本机没有 /team/*，所以覆盖前两个字段都会报缺失
  let r = resolve('env', '--check');
  assert.deepEqual([...r.out.missing].sort(), ['java_home', 'maven.repository', 'maven.settings']);
  assert.equal(r.out.cleared, undefined, '没声明过就没有 cleared');
  // 个人显式留空 maven.settings（想用 Maven 默认配置）+ 覆盖 java_home 为本机真实路径
  put('.agents/skills/workflow/profile.local.json', JSON.stringify({ toolchain: { java_home: real, maven: { settings: '' } } }));
  r = resolve('env', '--check');
  assert.deepEqual(r.out.cleared, ['maven.settings'], '显式留空记为 cleared');
  assert.ok(!('maven.settings' in r.out.fields), '被清空的字段不再出现，也不继承团队值');
  assert.ok(!r.out.missing.includes('maven.settings'), '清空后不再报缺失');
  assert.deepEqual([r.out.fields.java_home.source, r.out.fields.java_home.exists], ['local', true]);
  assert.deepEqual([r.out.fields['maven.repository'].source, r.out.fields['maven.repository'].resolved], ['team', '/team/repo'], '没覆盖的字段仍继承团队值');
  assert.deepEqual(r.out.missing, ['maven.repository']);
  // status / profile 也带上 cleared
  assert.deepEqual(resolve('status').out.toolchain.cleared, ['maven.settings']);
  assert.deepEqual(resolve('profile').out.toolchain.cleared, ['maven.settings']);
  fs.rmSync(root, { recursive: true, force: true });
});
