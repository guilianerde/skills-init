// 项目画像推断：按固定规则从仓库文件推断 profile.json 的草稿，每个字段附带依据。
// 由 resolve.mjs infer-profile 调用；只读，不写 profile.json——写入前必须给用户确认。
// 推断不出的字段（发布平台、Region、是否数据评审）留空，由 agent 询问用户。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'build', 'dist', 'out', '.gradle', '.idea', 'vendor', 'tmp', '.agents', '.claude', '.qwen', '.codebuddy', 'docnexus', 'workflow-run']);

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

// 广度优先找文件，限制数量，避免大仓库扫描过久
function findFiles(root, test, limit = 3000) {
  const out = [];
  const queue = [root];
  let seen = 0;
  while (queue.length && seen < limit) {
    const dir = queue.shift();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) queue.push(path.join(dir, e.name)); }
      else if (e.isFile() && test(e.name)) { out.push(path.join(dir, e.name)); if (++seen >= limit) break; }
    }
  }
  return out;
}

function makeTargets(root) {
  const mk = read(path.join(root, 'Makefile'));
  const has = (t) => new RegExp(`^${t}\\s*:`, 'm').test(mk);
  return { build: has('build'), test: has('test'), lint: has('lint') };
}

export function inferProfile(root) {
  const draft = { main_branch: '', build: '', test: '', test_single: '', lint: '', config_center: '', job_annotation: '' };
  const evidence = {};
  const set = (k, v, why) => { if (v && !draft[k]) { draft[k] = v; evidence[k] = why; } };
  const exists = (f) => fs.existsSync(path.join(root, f));

  // 主分支
  const head = git(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (head) set('main_branch', head.replace(/^origin\//, ''), 'git symbolic-ref refs/remotes/origin/HEAD');
  else for (const b of ['main', 'master']) if (git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`])) { set('main_branch', b, `本地存在 ${b} 分支`); break; }

  // Makefile 目标视为项目约定，优先
  const mk = makeTargets(root);
  for (const t of ['build', 'test', 'lint']) if (mk[t]) set(t, `make ${t}`, `Makefile 中有 ${t} 目标`);

  const pom = read(path.join(root, 'pom.xml'));
  const gradleFile = ['build.gradle.kts', 'build.gradle'].find(exists);
  const gradle = gradleFile ? read(path.join(root, gradleFile)) : '';
  const pkg = readJson(path.join(root, 'package.json'));
  const javaBuild = pom + gradle;

  if (pom) {
    const mvn = exists('mvnw') ? './mvnw' : 'mvn';
    set('build', `${mvn} -q -DskipTests package`, 'pom.xml');
    set('test', `${mvn} test`, 'pom.xml');
    set('test_single', `${mvn} -q test -Dtest={target}`, 'pom.xml（surefire）');
    if (/spotless-maven-plugin/.test(pom)) set('lint', `${mvn} spotless:check`, 'pom.xml 中有 spotless-maven-plugin');
    else if (/maven-checkstyle-plugin/.test(pom)) set('lint', `${mvn} checkstyle:check`, 'pom.xml 中有 maven-checkstyle-plugin');
  } else if (gradleFile) {
    const g = exists('gradlew') ? './gradlew' : 'gradle';
    set('build', `${g} build -x test`, gradleFile);
    set('test', `${g} test`, gradleFile);
    set('test_single', `${g} test --tests {target}`, gradleFile);
    if (/spotless/.test(gradle)) set('lint', `${g} spotlessCheck`, `${gradleFile} 中有 spotless`);
    else if (/checkstyle/.test(gradle)) set('lint', `${g} checkstyleMain`, `${gradleFile} 中有 checkstyle`);
  } else if (pkg) {
    const pm = exists('pnpm-lock.yaml') ? 'pnpm' : exists('yarn.lock') ? 'yarn' : 'npm';
    const run = (s) => (pm === 'npm' ? (s === 'test' ? 'npm test' : `npm run ${s}`) : `${pm} ${s}`);
    const scripts = pkg.scripts ?? {};
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (scripts.build) set('build', run('build'), 'package.json scripts.build');
    if (scripts.test && !/no test specified/.test(scripts.test)) set('test', run('test'), 'package.json scripts.test');
    if (scripts.lint) set('lint', run('lint'), 'package.json scripts.lint');
    if (deps.vitest) set('test_single', `npx vitest run {target}`, 'devDependencies 中有 vitest');
    else if (deps.jest) set('test_single', `npx jest {target}`, 'devDependencies 中有 jest');
    else if (deps.mocha) set('test_single', `npx mocha {target}`, 'devDependencies 中有 mocha');
  } else if (exists('go.mod')) {
    set('build', 'go build ./...', 'go.mod');
    set('test', 'go test ./...', 'go.mod');
    set('test_single', 'go test ./... -run {target}', 'go.mod');
    if (['.golangci.yml', '.golangci.yaml', '.golangci.toml'].some(exists)) set('lint', 'golangci-lint run', 'golangci 配置文件');
  } else if (exists('pyproject.toml') || exists('requirements.txt') || exists('setup.py')) {
    const py = read(path.join(root, 'pyproject.toml'));
    const src = exists('pyproject.toml') ? 'pyproject.toml' : exists('requirements.txt') ? 'requirements.txt' : 'setup.py';
    set('test', 'pytest', src);
    set('test_single', 'pytest {target}', src);
    if (/\[tool\.ruff/.test(py) || exists('ruff.toml')) set('lint', 'ruff check .', 'ruff 配置');
    else if (/\[tool\.flake8|flake8/.test(py) || exists('.flake8')) set('lint', 'flake8', 'flake8 配置');
  }

  // 配置中心：构建文件依赖优先，其次配置文件
  const cc = [
    [/spring-cloud-starter-alibaba-nacos-config|nacos-client/, 'nacos'],
    [/apollo-client|apollo-openapi/, 'apollo'],
    [/spring-cloud-starter-config|spring-cloud-config-client/, 'spring-cloud-config'],
  ];
  for (const [re, v] of cc) if (re.test(javaBuild)) { set('config_center', v, `${pom ? 'pom.xml' : gradleFile} 依赖`); break; }
  if (!draft.config_center && (pom || gradleFile)) {
    const conf = findFiles(root, (n) => /^(application|bootstrap)[\w-]*\.(ya?ml|properties)$/.test(n), 50);
    for (const f of conf) {
      const t = read(f);
      const hit = /nacos/i.test(t) ? 'nacos' : /apollo\./.test(t) ? 'apollo' : /spring\.cloud\.config\.uri|spring\.config\.import:\s*.*configserver/.test(t) ? 'spring-cloud-config' : '';
      if (hit) { set('config_center', hit, path.relative(root, f).split(path.sep).join('/')); break; }
    }
  }

  // 定时任务注解
  if (pom || gradleFile) {
    for (const f of findFiles(root, (n) => /\.(java|kt)$/.test(n))) {
      const t = read(f);
      const ann = /@XxlJob\b/.test(t) ? '@XxlJob' : /@Scheduled\b/.test(t) ? '@Scheduled' : /@ElasticJob|implements\s+SimpleJob\b/.test(t) ? '@ElasticJob' : '';
      if (ann) { set('job_annotation', ann, path.relative(root, f).split(path.sep).join('/')); break; }
    }
  }

  return {
    draft,
    evidence,
    unknown: [...Object.keys(draft).filter((k) => !draft[k]), 'deploy.platform', 'deploy.regions', 'data_review'],
    note: '草稿仅供确认：给用户看完整 JSON，确认后再写入 workflow/profile.json；已有非空字段不要被草稿覆盖，除非用户同意。',
  };
}
