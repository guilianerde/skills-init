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

// Maven settings.xml：注释里的示例节点不是有效配置（mvn 也会忽略），解析前先去掉 <!-- ... -->
export function stripXmlComments(xml) {
  return xml.replace(/<!--[\s\S]*?-->/g, '');
}
const localRepositoryOf = (xml) => /<localRepository>\s*([^<\s]+)\s*<\/localRepository>/.exec(xml)?.[1] ?? '';

// 开发环境配置（toolchain）：JDK / Maven / Gradle / Node 的位置。
// 值来自本机当前环境（进程变量、用户目录下的配置文件），但画像会随代码提交、别的机器未必一样，
// 所以每个值都带 evidence 说明依据；写入前由 resolve.mjs env --check 在本机核对存在性，再由用户确认。
// 项目文件（pom.xml 要求的 JDK 版本、.nvmrc 锁定的 Node 版本）只作为对照依据写进 evidence，不当路径用。
export function inferToolchain(root, { env = process.env } = {}) {
  const tc = { java_home: '', maven: { settings: '', repository: '' }, gradle_user_home: '', node: '' };
  const evidence = {};
  const set = (k, v, why) => { const [a, b] = k.split('.'); if (v && !(b ? tc[a][b] : tc[a])) { if (b) tc[a][b] = v; else tc[a] = v; evidence[k] = why; } };
  const exists = (f) => fs.existsSync(path.join(root, f));
  const home = env.HOME || env.USERPROFILE || '';
  const at = (...p) => (home ? path.join(home, ...p) : '');
  const file = (p) => p && fs.existsSync(p);
  const dir = (p) => { try { return !!p && fs.statSync(p).isDirectory(); } catch { return false; } };

  // 项目是否用 Java / Node，决定该推断哪些工具链
  const pom = read(path.join(root, 'pom.xml'));
  const gradleFile = ['build.gradle.kts', 'build.gradle'].find(exists);
  const javaProject = !!(pom || gradleFile || exists('.java-version'));
  const nodeProject = exists('package.json') || exists('.nvmrc') || exists('.node-version');

  // JDK：先记下项目要求的版本（只作依据，版本不是路径），路径取本机 JAVA_HOME；没有就问用户
  if (javaProject) {
    if (pom) {
      const src = /<(?:maven\.compiler\.)?(?:source|release|target)>([\d.]+)</.exec(pom)?.[1]
        ?? /<java\.version>([\d.]+)</.exec(pom)?.[1];
      if (src) evidence['java_home.version'] = `pom.xml 要求 JDK ${src}（版本不是路径，需用户给出安装位置）`;
    }
    if (env.JAVA_HOME) set('java_home', env.JAVA_HOME, '本机 JAVA_HOME（别的机器可能不同，先确认）');
  }

  // Maven：settings.xml 与本地仓库。
  // Maven 实际会合并全局（$MAVEN_HOME/conf/settings.xml）与用户级（~/.m2/settings.xml）两份配置，用户级优先
  // （见 https://maven.apache.org/settings.html），所以以用户级为主、全局只作补充依据，两者都记下来。
  if (javaProject && !gradleFile) {
    const globalSettings = env.MAVEN_HOME ? path.join(env.MAVEN_HOME, 'conf', 'settings.xml') : '';
    const userSettings = at('.m2', 'settings.xml');
    const hasGlobal = file(globalSettings);
    const hasUser = file(userSettings);
    const settings = hasUser ? userSettings : (hasGlobal ? globalSettings : '');
    if (settings) {
      set('maven.settings', settings, hasUser
        ? `用户级 settings.xml（优先于全局${hasGlobal ? ` ${globalSettings}` : ''}；Maven 会合并两份，用户配置生效）`
        : `全局 settings.xml（没有用户级 ~/.m2/settings.xml，Maven 只用这一份）`);
      if (hasUser && hasGlobal) evidence['maven.settings.global'] = `同时存在全局 ${globalSettings}，Maven 会合并、以用户级为准；改镜像 / 私服通常改这一份`;
    }
    // 本地仓库：按「有效配置」推断 —— 用户级 settings.xml 里的 <localRepository> 优先，
    // 其次全局 settings.xml，最后才是默认目录。注释里的示例不算（mvn 自己也会忽略）。
    const userRepo = localRepositoryOf(stripXmlComments(read(userSettings)));
    const globalRepo = localRepositoryOf(stripXmlComments(read(globalSettings)));
    const localRepo = userRepo || globalRepo || '';
    if (localRepo) set('maven.repository', localRepo, `${userRepo ? path.basename(userSettings) : path.basename(globalSettings || 'settings.xml')} 里的 <localRepository>`);
    else if (dir(at('.m2', 'repository'))) set('maven.repository', at('.m2', 'repository'), '默认本地仓库目录 ~/.m2/repository');
  }

  // Gradle：GRADLE_USER_HOME，默认 ~/.gradle
  if (gradleFile) {
    if (env.GRADLE_USER_HOME) set('gradle_user_home', env.GRADLE_USER_HOME, '本机 GRADLE_USER_HOME');
    else if (dir(at('.gradle'))) set('gradle_user_home', at('.gradle'), '默认 Gradle 用户目录 ~/.gradle');
  }

  // Node：项目锁定的版本优先（.nvmrc / .node-version / package.json engines），其次本机 node 所在目录
  if (nodeProject) {
    const pinned = read(path.join(root, '.nvmrc')).trim() || read(path.join(root, '.node-version')).trim();
    const engines = readJson(path.join(root, 'package.json'))?.engines?.node ?? '';
    if (pinned || engines) evidence['node.version'] = `${pinned ? '.nvmrc / .node-version' : 'package.json engines'} 要求 Node ${pinned || engines}（不是路径；用 nvm 等版本管理器时给出对应目录）`;
    const nodeDir = env.NODE_HOME || (process.execPath && path.dirname(process.execPath));
    if (nodeDir) set('node', nodeDir, '当前运行本脚本的 Node 所在目录（别的机器可能不同）');
  }

  // 只推断，不写文件；展开与存在性核对交给 resolve.mjs env --check
  return { toolchain: tc, evidence };
}

export function inferProfile(root, { env = process.env } = {}) {
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

  // 开发环境配置（toolchain）：路径多半是本机值，写入前必须用 env --check 核对并让用户确认
  const { toolchain, evidence: tcEvidence } = inferToolchain(root, { env });
  for (const [k, v] of Object.entries(tcEvidence)) evidence[`toolchain.${k}`] = v;

  const tcEmpty = [
    ...(toolchain.java_home ? [] : ['toolchain.java_home']),
    ...(toolchain.maven.settings ? [] : ['toolchain.maven.settings']),
    ...(toolchain.maven.repository ? [] : ['toolchain.maven.repository']),
    ...(toolchain.gradle_user_home ? [] : ['toolchain.gradle_user_home']),
    ...(toolchain.node ? [] : ['toolchain.node']),
  ];

  return {
    draft: { ...draft, toolchain },
    evidence,
    unknown: [...Object.keys(draft).filter((k) => !draft[k]), ...tcEmpty, 'deploy.platform', 'deploy.regions', 'data_review'],
    note: '草稿仅供确认：给用户看完整 JSON，确认后再写入 workflow/profile.json；已有非空字段不要被草稿覆盖，除非用户同意。toolchain 的路径多是本机值，先用 resolve.mjs env --check 核对存在性再写；团队画像里对不上的写进个人的 profile.local.json。',
  };
}
