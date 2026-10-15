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
