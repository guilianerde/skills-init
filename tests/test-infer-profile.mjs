// workflow/scripts/infer-profile.mjs：按仓库文件推断画像草稿
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inferProfile } from '../workflow/scripts/infer-profile.mjs';

function repo(files, branch = 'main') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infer-'));
  for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), c); }
  const g = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  g('init', '-q', '-b', branch); g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  return root;
}

test('Maven + Nacos + XxlJob', () => {
  const root = repo({
    'pom.xml': '<project><artifactId>spring-cloud-starter-alibaba-nacos-config</artifactId><artifactId>maven-checkstyle-plugin</artifactId></project>',
    mvnw: '', 'src/main/java/a/Job.java': 'class Job { @XxlJob("x") void run() {} }',
  }, 'master');
  const { draft, evidence, unknown } = inferProfile(root);
  assert.equal(draft.main_branch, 'master');
  assert.equal(draft.build, './mvnw -q -DskipTests package');
  assert.equal(draft.test_single, './mvnw -q test -Dtest={target}');
  assert.equal(draft.lint, './mvnw checkstyle:check');
  assert.equal(draft.config_center, 'nacos');
  assert.equal(draft.job_annotation, '@XxlJob');
  assert.equal(evidence.job_annotation, 'src/main/java/a/Job.java');
  assert.ok(unknown.includes('deploy.platform') && !unknown.includes('build'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('Gradle + apollo 配置文件 + @Scheduled', () => {
  const root = repo({ 'build.gradle.kts': 'plugins { java }', 'src/main/resources/application.yml': 'apollo.meta: http://x', 'src/main/java/A.java': '@Scheduled(cron="0 * * * * *") void f(){}' });
  const { draft } = inferProfile(root);
  assert.equal(draft.build, 'gradle build -x test');
  assert.equal(draft.test_single, 'gradle test --tests {target}');
  assert.equal(draft.config_center, 'apollo');
  assert.equal(draft.job_annotation, '@Scheduled');
  fs.rmSync(root, { recursive: true, force: true });
});

test('pnpm + vitest；Makefile 目标优先', () => {
  const root = repo({
    'package.json': JSON.stringify({ scripts: { build: 'vite build', test: 'vitest', lint: 'eslint .' }, devDependencies: { vitest: '1' } }),
    'pnpm-lock.yaml': '', Makefile: 'test:\n\tpnpm test --run\n',
  });
  const { draft, evidence } = inferProfile(root);
  assert.equal(draft.test, 'make test');
  assert.equal(evidence.test, 'Makefile 中有 test 目标');
  assert.equal(draft.build, 'pnpm build');
  assert.equal(draft.lint, 'pnpm lint');
  assert.equal(draft.test_single, 'npx vitest run {target}');
  assert.equal(draft.config_center, '');
  fs.rmSync(root, { recursive: true, force: true });
});

test('Go + golangci；npm 默认 test 脚本不算', () => {
  let root = repo({ 'go.mod': 'module x', '.golangci.yml': '' });
  assert.deepEqual([inferProfile(root).draft.test, inferProfile(root).draft.lint], ['go test ./...', 'golangci-lint run']);
  fs.rmSync(root, { recursive: true, force: true });
  root = repo({ 'package.json': JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) });
  assert.equal(inferProfile(root).draft.test, '');
  fs.rmSync(root, { recursive: true, force: true });
});

// ------------------------------------------------------------------ 开发环境配置（toolchain）
test('toolchain：Maven 项目的 JDK / settings / 本地仓库与依据', () => {
  const root = repo({ 'pom.xml': '<project><java.version>17</java.version><artifactId>maven-checkstyle-plugin</artifactId></project>' });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'infer-home-'));
  const settings = path.join(home, '.m2', 'settings.xml');
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(settings, '<settings><localRepository>/data/m2-repo</localRepository></settings>');
  const { draft, evidence, unknown } = inferProfile(root, { env: { HOME: home, JAVA_HOME: '/jdk/temurin-17' } });
  assert.equal(draft.toolchain.java_home, '/jdk/temurin-17');
  assert.equal(draft.toolchain.maven.settings, settings);
  assert.equal(draft.toolchain.maven.repository, '/data/m2-repo', 'settings.xml 的 localRepository 优先于默认目录');
  assert.match(evidence['toolchain.maven.repository'], /localRepository/);
  assert.match(evidence['toolchain.java_home.version'], /JDK 17/);
  assert.ok(!unknown.includes('toolchain.java_home'));
  fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true });
});

test('toolchain：Gradle 项目不推 maven，推 GRADLE_USER_HOME；Node 项目推 node 目录', () => {
  const root = repo({ 'build.gradle.kts': 'plugins { java }', '.nvmrc': '20.11.0', 'package.json': '{"name":"x"}' });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'infer-home-'));
  fs.mkdirSync(path.join(home, '.gradle'), { recursive: true });
  const { draft, evidence } = inferProfile(root, { env: { HOME: home, GRADLE_USER_HOME: '/gradle-home' } });
  assert.equal(draft.toolchain.maven.settings, '', 'Gradle 项目不推 Maven');
  assert.equal(draft.toolchain.gradle_user_home, '/gradle-home');
  assert.ok(draft.toolchain.node, 'Node 项目推 node 目录');
  assert.match(evidence['toolchain.node.version'], /Node 20\.11\.0/);
  fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true });
});

test('toolchain：非 Java / Node 项目不推断，字段进 unknown；没有 JAVA_HOME 时不猜 JDK', () => {
  const root = repo({ 'go.mod': 'module x' });
  const { draft, unknown } = inferProfile(root, { env: { HOME: '/nonexistent-home' } });
  assert.deepEqual(draft.toolchain, { java_home: '', maven: { settings: '', repository: '' }, gradle_user_home: '', node: '' });
  assert.ok(unknown.includes('toolchain.java_home') && unknown.includes('toolchain.node'));
  fs.rmSync(root, { recursive: true, force: true });
});

// 回归：审查发现的 3 个问题
test('toolchain：全局与用户级 settings.xml 同时存在时以用户级为准，全局只作依据', () => {
  const root = repo({ 'pom.xml': '<project/>' });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'infer-home-'));
  const mavenHome = fs.mkdtempSync(path.join(os.tmpdir(), 'infer-mh-'));
  fs.mkdirSync(path.join(home, '.m2'), { recursive: true });
  fs.mkdirSync(path.join(mavenHome, 'conf'), { recursive: true });
  const user = path.join(home, '.m2', 'settings.xml');
  const global = path.join(mavenHome, 'conf', 'settings.xml');
  fs.writeFileSync(user, '<settings><localRepository>/user/repo</localRepository></settings>');
  fs.writeFileSync(global, '<settings><localRepository>/global/repo</localRepository></settings>');
  const { draft, evidence } = inferProfile(root, { env: { HOME: home, MAVEN_HOME: mavenHome } });
  assert.equal(draft.toolchain.maven.settings, user, '用户级优先于全局（Maven 合并两份、用户配置生效）');
  assert.equal(draft.toolchain.maven.repository, '/user/repo', '有效配置里的 localRepository');
  assert.match(evidence['toolchain.maven.settings'], /优先于全局/);
  assert.match(evidence['toolchain.maven.settings.global'], new RegExp(global.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  // 只有全局时用全局
  fs.rmSync(user);
  const only = inferProfile(root, { env: { HOME: home, MAVEN_HOME: mavenHome } });
  assert.equal(only.draft.toolchain.maven.settings, global);
  assert.equal(only.draft.toolchain.maven.repository, '/global/repo');
  fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(mavenHome, { recursive: true, force: true });
});

test('toolchain：settings.xml 注释里的 <localRepository> 示例不算有效配置，回退默认仓库', () => {
  const root = repo({ 'pom.xml': '<project/>' });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'infer-home-'));
  fs.mkdirSync(path.join(home, '.m2', 'repository'), { recursive: true });
  fs.writeFileSync(path.join(home, '.m2', 'settings.xml'),
    '<settings>\n  <!--\n  <localRepository>/path/to/local/repo</localRepository>\n  -->\n</settings>');
  const { draft, evidence } = inferProfile(root, { env: { HOME: home } });
  assert.equal(draft.toolchain.maven.repository, path.join(home, '.m2', 'repository'), '注释里的示例要被忽略');
  assert.match(evidence['toolchain.maven.repository'], /默认本地仓库/);
  // 注释外有真实值时仍要认出来
  fs.writeFileSync(path.join(home, '.m2', 'settings.xml'),
    '<settings>\n<!-- <localRepository>/path/to/local/repo</localRepository> -->\n<localRepository>/real/repo</localRepository>\n</settings>');
  assert.equal(inferProfile(root, { env: { HOME: home } }).draft.toolchain.maven.repository, '/real/repo');
  fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true });
});
