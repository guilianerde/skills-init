// 项目布局与配置；不依赖需求写入或任何命令入口。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const INSTALL_BASES = ['.agents/skills', '.claude/skills', '.qwen/skills', '.codebuddy/skills'];
const INSTALL_ALIASES = {
  codex: '.agents/skills',
  doubao: '.agents/skills',
  claude: '.claude/skills',
  qwen: '.qwen/skills',
  workbuddy: '.codebuddy/skills',
};
const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const toPosix = (p) => p.split(path.sep).join('/');
const relOf = (root, abs) => toPosix(path.relative(root, abs));

// 本工具在项目里的唯一目录
export const HOME = 'workflow-run';
export const REQ_DIR = `${HOME}/docs/requirements`;
export const TEMPLATES_DIR = `${HOME}/templates`;
export const TMP_DIR = `${HOME}/tmp`;
export const PROFILE_SOURCE = `${HOME}/profile-source.json`;
export const IGNORE_LINE = `${HOME}/docs/`;
export const homeDir = (root) => path.join(root, HOME);
// workflow-run/ 自己是 git 仓库（团队文档仓库克隆到这里）= 独立文档仓库模式
export const homeIsRepo = (root) => fs.existsSync(path.join(root, HOME, '.git'));
// 产物种类 → 需求目录里的文件名（只放最新版 <base>.md；版本号在 meta.json 的 versions，旧版归档为 <base>_v<N>.md）
// 需求名 / 项目名 → 目录名：保留中文，去掉路径与文件系统不允许的字符，空白换成 -
export function dirName(name) {
  const s = String(name).normalize('NFC').trim()
    .replace(/[\\/:*?"<>|#%{}^~[\]`'$&@!=+,;]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return [...s].slice(0, 60).join('') || 'unnamed';
}

// ------------------------------------------------------------------ 配置与布局
const profileError = (message, code, details = {}) => Object.assign(new Error(message), { code, details });
const candidateDirs = (root) => INSTALL_BASES
  .map((base) => ({ base, dir: path.join(root, base, 'workflow') }))
  .filter(({ dir }) => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } });
const samePath = (a, b) => path.relative(path.resolve(a), path.resolve(b)) === '';
const profileFiles = (dir) => ['profile.json', 'profile.local.json'].map((name) => {
  const file = path.join(dir, name);
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
});
// --copy 初次安装的各副本通常完全相同；只有 profile.json / profile.local.json
// 这两个团队与个人配置都相同时，任选一个才不改变画像语义。
const equivalentProfiles = (candidates) => {
  if (candidates.length < 2) return true;
  const first = profileFiles(candidates[0].dir);
  return candidates.slice(1).every(({ dir }) => {
    const current = profileFiles(dir);
    return current.every((value, index) => (value === null ? first[index] === null : first[index] !== null && value.equals(first[index])));
  });
};
const sourceFile = (root) => path.join(root, PROFILE_SOURCE);
const PROFILE_SOURCE_HINT = '运行 requirement.mjs config --profile-source <codex|claude|qwen|workbuddy|路径> 明确选择';
const sourceError = (message, details) => profileError(
  `${message}；${PROFILE_SOURCE_HINT}`,
  'PROJECT_CONFIG_AMBIGUOUS',
  { reason: 'invalid_source', source_file: PROFILE_SOURCE, hint: PROFILE_SOURCE_HINT, ...details },
);
const readProfileSource = (root, candidates) => {
  const file = sourceFile(root);
  if (!fs.existsSync(file)) return null;
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw sourceError(`profile 来源文件不是合法 JSON：${PROFILE_SOURCE}`, { paths: candidates.map(({ base }) => `${base}/workflow`) });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.profile_dir !== 'string' || !value.profile_dir.trim()) {
    throw sourceError(`profile 来源文件缺少非空 profile_dir：${PROFILE_SOURCE}`, { paths: candidates.map(({ base }) => `${base}/workflow`) });
  }
  const configured = candidates.find(({ dir }) => samePath(dir, path.resolve(root, value.profile_dir)));
  if (!configured) {
    throw sourceError(`profile 来源不存在或不是受支持的安装目录：${value.profile_dir}`, {
      profile_dir: value.profile_dir,
      paths: candidates.map(({ base }) => `${base}/workflow`),
    });
  }
  return { ...configured, selected_by: 'profile-source', source_file: PROFILE_SOURCE };
};

// 项目配置只能来自目标业务项目。规范位置优先；没有规范位置时，只允许一个真实配置目录。
// 多个不同拷贝会改变基线、产物项目和工具链，不能按目录枚举顺序静默任选。
export function resolveProfileDir(root) {
  const candidates = candidateDirs(root);
  const configured = readProfileSource(root, candidates);
  if (configured) return { ...configured, source: configured.base, candidates };
  if (!candidates.length) {
    return { dir: path.join(root, INSTALL_BASES[0], 'workflow'), source: null, selected_by: null, candidates: [] };
  }
  const canonical = candidates.find(({ base }) => base === INSTALL_BASES[0]);
  if (canonical) return { ...canonical, source: canonical.base, selected_by: 'canonical', candidates };

  const unique = [];
  const byRealPath = new Map();
  for (const candidate of candidates) {
    let real;
    try {
      real = fs.realpathSync.native(candidate.dir);
    } catch {
      real = path.resolve(candidate.dir);
    }
    if (!byRealPath.has(real)) byRealPath.set(real, candidate);
  }
  unique.push(...byRealPath.values());
  if (unique.length > 1 && !equivalentProfiles(unique)) {
    const paths = unique.map(({ dir }) => path.relative(root, dir).split(path.sep).join('/'));
    throw profileError(
      `目标项目存在多个内容不同的 workflow 配置目录，无法唯一选择：${paths.join('、')}；${PROFILE_SOURCE_HINT}`,
      'PROJECT_CONFIG_AMBIGUOUS',
      {
        reason: 'different_profiles',
        paths,
        source_file: PROFILE_SOURCE,
        hint: PROFILE_SOURCE_HINT,
      },
    );
  }
  return {
    ...unique[0],
    source: unique[0].base,
    selected_by: unique.length === 1 ? 'only_candidate' : 'equivalent_profiles',
    candidates,
  };
}

export function profileSources(root) {
  return candidateDirs(root).map(({ base, dir }) => ({
    env: Object.entries(INSTALL_ALIASES).find(([, value]) => value === base)?.[0] ?? base,
    base,
    dir: relOf(root, dir),
  }));
}

// 显式选择只接受目标项目内受支持的安装目录；auto 清除选择并恢复自动解析。
export function setProfileSource(root, value) {
  const file = sourceFile(root);
  const requested = String(value ?? '').trim();
  if (!requested) throw new Error('profile 来源不能为空');
  if (['auto', 'default'].includes(requested.toLowerCase())) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return { ok: true, cleared: true, file: null, candidates: profileSources(root) };
  }
  const alias = INSTALL_ALIASES[requested.toLowerCase()];
  const requestedPath = alias ? path.join(root, alias, 'workflow') : path.resolve(root, requested);
  const supported = candidateDirs(root).find(({ dir }) => samePath(dir, requestedPath));
  if (!supported) {
    throw profileError(
      `profile 来源不存在或不是受支持的安装目录：${requested}；${PROFILE_SOURCE_HINT}`,
      'PROJECT_CONFIG_AMBIGUOUS',
      { reason: 'invalid_source', requested, hint: PROFILE_SOURCE_HINT, paths: profileSources(root).map(({ dir }) => dir), source_file: PROFILE_SOURCE },
    );
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ profile_dir: relOf(root, supported.dir) }, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return {
    ok: true,
    cleared: false,
    file: PROFILE_SOURCE,
    profile_dir: relOf(root, supported.dir),
    candidates: profileSources(root),
  };
}

export function profileDir(root) {
  return resolveProfileDir(root).dir;
}

// workflow/profile.json 的 artifacts，profile.local.json（个人设置，不提交）覆盖其上
export function artifactsConfig(root) {
  const resolved = resolveProfileDir(root);
  const dir = resolved.dir;
  const team = readJson(path.join(dir, 'profile.json'))?.artifacts ?? {};
  const mine = readJson(path.join(dir, 'profile.local.json'))?.artifacts ?? {};
  const c = { ...team, ...mine };
  return {
    project: c.project ? String(c.project) : '',
    commit_prompt: c.commit_prompt !== false,
    profile_dir: dir,
    profile_source: {
      selected_by: resolved.selected_by ?? null,
      ...(resolved.source_file ? { config: resolved.source_file } : {}),
    },
  };
}

// 产物位置：两种模式都是 workflow-run/docs/requirements/<需求>/<项目>/。
// mode 只决定谁来提交（project = 随代码提交，repo = workflow-run/ 是独立的文档仓库）、引用怎么写、项目名能不能自动取
export function layout(root, cfg = artifactsConfig(root)) {
  const home = homeDir(root);
  const base = path.join(root, REQ_DIR);
  if (!homeIsRepo(root)) {
    const project = cfg.project ? dirName(cfg.project) : suggestProject(root);
    return { mode: 'project', ok: true, base, home, repo: null, project, project_configured: !!cfg.project, commit_prompt: cfg.commit_prompt, reqDir: (slug) => path.join(base, slug, project), ref: (abs) => relOf(root, abs) };
  }
  const repoName = remoteName(home);
  const L = { mode: 'repo', base, home, repo: home, repo_rel: HOME, repo_name: repoName, project: cfg.project ? dirName(cfg.project) : null, project_configured: !!cfg.project, commit_prompt: cfg.commit_prompt };
  L.reqDir = (slug) => path.join(base, slug, L.project ?? '_');
  // 文档里引用产物用「文档仓库名:仓库内路径」，各服务、各人的克隆里都一样
  L.ref = (abs) => `${repoName}:${toPosix(path.relative(home, abs))}`;
  if (!L.project) return { ...L, ok: false, need_project: true, suggested_project: suggestProject(root), hint: '文档仓库模式需要项目名（产物放在 workflow-run/docs/requirements/<需求名>/<项目名>/），只需配置一次：问用户这个项目在文档仓库里叫什么（默认 suggested_project），然后运行 config --project <项目名>' };
  return { ...L, ok: true };
}

// 文档仓库名：它的 git 远端仓库名，没有远端时用 workflow-run
const remoteNames = new Map();
function remoteName(home) {
  if (!remoteNames.has(home)) {
    const url = git(home, ['remote', 'get-url', 'origin']).stdout?.trim();
    remoteNames.set(home, url ? url.replace(/[/\\]+$/, '').replace(/\.git$/, '').split(/[/\\:]/).pop() || HOME : HOME);
  }
  return remoteNames.get(home);
}

// 项目名建议：git 远端仓库名，取不到用项目目录名
export function suggestProject(root) {
  const url = git(root, ['remote', 'get-url', 'origin']).stdout?.trim();
  const name = url ? url.replace(/[/\\]+$/, '').replace(/\.git$/, '').split(/[/\\:]/).pop() : path.basename(path.resolve(root));
  return dirName(name);
}

export function setConfig(root, patch, { local = false } = {}) {
  const dir = profileDir(root);
  const f = path.join(dir, local ? 'profile.local.json' : 'profile.json');
  const cur = readJson(f) ?? {};
  const a = { ...(cur.artifacts ?? {}) };
  if (patch.project !== undefined) a.project = dirName(patch.project);
  if (patch.commit_prompt !== undefined) a.commit_prompt = patch.commit_prompt;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(f, `${JSON.stringify({ ...cur, artifacts: a }, null, 2)}\n`);
  const L = layout(root);
  return { file: relOf(root, f), artifacts: a, effective: { mode: L.mode, repo: L.repo_rel ?? null, project: L.project, commit_prompt: L.commit_prompt, ok: L.ok, hint: L.ok ? null : L.hint } };
}

// .ignore 里加上需求目录（ripgrep 与 agent 的搜索跳过它；git 不受影响）。返回是否改动
export function ensureIgnore(root) {
  const f = path.join(root, '.ignore');
  const text = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  const norm = (l) => l.trim().replace(/^\//, '').replace(/\/$/, '');
  if (text.split(/\r?\n/).some((l) => norm(l) === norm(IGNORE_LINE))) return false;
  const add = `# workflow-run：需求产物（方案、交付说明、审查报告、技术 / 上线方案）不参与代码搜索，检索交给 DocNexus\n${IGNORE_LINE}\n`;
  fs.writeFileSync(f, text ? `${text.replace(/\s*$/, '')}\n\n${add}` : add);
  return true;
}


const PROFILE_FIELDS = ['main_branch', 'build', 'test', 'test_single', 'lint', 'config_center', 'deploy.platform', 'deploy.regions', 'job_annotation'];
const PROFILE_REQUIRED = ['main_branch', 'build', 'test'];

const OS_NAMES = { win32: 'windows', darwin: 'macos', linux: 'linux' };
export function detectEnv() {
  const os = OS_NAMES[process.platform] ?? process.platform;
  let shell;
  if (process.platform === 'win32') {
    shell = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { stdio: 'ignore', timeout: 15000 }).status === 0 ? 'pwsh' : 'powershell';
  } else shell = path.basename(process.env.SHELL || 'sh');
  return { os, shell };
}
// 终端的写法提示：PowerShell 5.1 没有 && / ||，pwsh 7 有
export const SHELL_NOTES = {
  powershell: 'Windows PowerShell 5.1：没有 && 和 ||，多条命令用 ; 分开；不要用 2>/dev/null、grep、head 等 Unix 命令',
  pwsh: 'PowerShell 7：支持 &&；不要用 2>/dev/null、grep、head 等 Unix 命令',
};
export function readEnv(root) {
  const rec = readJson(path.join(profileDir(root), 'profile.local.json'))?.env;
  const env = rec?.os ? { os: rec.os, shell: rec.shell ?? null, source: 'install' } : { os: OS_NAMES[process.platform] ?? process.platform, shell: null, source: 'runtime' };
  const note = SHELL_NOTES[env.shell];
  return { ...env, ...(note ? { note } : {}) };
}

// 开发环境配置（toolchain）：画像里的路径可能写 $JAVA_HOME / ${VAR} / %VAR% / ~，用 env_vars 与进程环境展开。
// env_vars 优先（画像里显式声明的是对的），缺失的键回退到本机进程环境（HOME、USERPROFILE 这类）。
// 展开后为空 = 变量确实没配（不是「留空」，要报出来）；路径里有空格照常，不做 shell 求值。
const VAR_RE = /\$\{(\w+)\}|\$(\w+)|%(\w+)%/g;
export function expandPath(v, vars = {}, env = process.env) {
  if (typeof v !== 'string' || !v) return { raw: v ?? '', resolved: '', missing: [] };
  const look = (n) => (vars[n] !== undefined && vars[n] !== '' ? vars[n] : (env[n] ?? ''));
  const home = look('HOME') || look('USERPROFILE') || '';
  let s = v;
  if (s === '~' || s.startsWith('~/') || s.startsWith('~\\')) s = home ? path.join(home, s.slice(2)) : s;
  const missing = [];
  for (const m of v.matchAll(VAR_RE)) { const n = m[1] ?? m[2] ?? m[3]; if (!look(n)) missing.push(n); }
  const resolved = s.replace(VAR_RE, (m, a, b, c) => look(a ?? b ?? c)).replace(/[\\/]+$/, '');
  return { raw: v, resolved, missing };
}

// 画像里的 toolchain（profile.json）与个人覆盖（profile.local.json），逐个子字段合并，后者优先。
// 「没声明」和「显式写空」是两回事：本机写 "" 表示**不使用**团队那个值（用工具自己的默认配置），
// 所以要按 null / "" 区分来源，不能只看值真不真。
export function readToolchain(root) {
  const dir = profileDir(root);
  const team = readJson(path.join(dir, 'profile.json')) ?? {};
  const mine = readJson(path.join(dir, 'profile.local.json')) ?? {};
  const declared = (o) => typeof o === 'string';
  // 个人声明过（含 ""）就以个人为准；否则用团队值。cleared 表示被个人显式留空
  const merge = (t, m) => {
    if (declared(m)) return m === '' ? { value: '', source: 'local', cleared: true } : { value: m, source: 'local' };
    if (declared(t) && t !== '') return { value: t, source: 'team' };
    return { value: '', source: null };
  };
  const vars = { ...(team.env_vars ?? {}), ...(mine.env_vars ?? {}) };
  const fields = {
    java_home: merge(team.toolchain?.java_home, mine.toolchain?.java_home),
    'maven.settings': merge(team.toolchain?.maven?.settings, mine.toolchain?.maven?.settings),
    'maven.repository': merge(team.toolchain?.maven?.repository, mine.toolchain?.maven?.repository),
    gradle_user_home: merge(team.toolchain?.gradle_user_home, mine.toolchain?.gradle_user_home),
    node: merge(team.toolchain?.node, mine.toolchain?.node),
  };
  const out = {};
  const cleared = [];
  for (const [k, { value, source, cleared: c }] of Object.entries(fields)) {
    if (c) { cleared.push(k); continue; } // 个人明确不用这个字段：不展开、不校验、也不报缺失
    if (value) out[k] = { ...expandPath(value, vars), source };
  }
  // toolchain 为空时也给出 env_vars，便于 agent 知道该用什么变量写路径
  return { fields: out, env_vars: vars, cleared, configured: Object.keys(out).length > 0 };
}

// 每个字段的路径在本机是否存在（写入画像前、构建跑不起来时核对用）。
// 只判断存在性，不判断版本对不对；current 是本机当前进程的值，便于和画像对照
export function checkToolchain(root, { env = process.env } = {}) {
  const tc = readToolchain(root);
  const check = (f) => {
    // 变量没配时展开结果可能是别处真存在的路径（$MISSING/bin 展开成 /bin），必须按「没配」算不通过
    let exists = false;
    try { exists = !f.missing.length && !!f.resolved && fs.existsSync(f.resolved); } catch { exists = false; }
    const kind = exists ? (() => { try { return fs.statSync(f.resolved).isDirectory() ? 'dir' : 'file'; } catch { return 'other'; } })() : null;
    return { ...f, exists, kind, ...(f.missing.length ? { unset_vars: f.missing } : {}), ...(f.raw !== f.resolved ? { expanded: true } : {}) };
  };
  const fields = Object.fromEntries(Object.entries(tc.fields).map(([k, f]) => [k, check(f)]));
  const bad = Object.entries(fields).filter(([, f]) => !f.exists).map(([k]) => k);
  return {
    fields, configured: tc.configured, env_vars: tc.env_vars, ok: bad.length === 0,
    missing: bad,
    // 个人在 profile.local.json 里显式留空、表示不用团队那个值的字段（用工具默认配置）
    ...(tc.cleared.length ? { cleared: tc.cleared } : {}),
    // 本机当前值：和画像对不上时，多半是画像抄的是别人的机器
    current: { JAVA_HOME: env.JAVA_HOME ?? null, MAVEN_HOME: env.MAVEN_HOME ?? null, GRADLE_USER_HOME: env.GRADLE_USER_HOME ?? null, node: path.dirname(process.execPath) },
    how: tc.configured ? (bad.length ? `核对 toolchain 里不存在或变量没配的字段：${bad.join('、')}（本机值见 current）；改本机的那份用 profile.local.json，见 workflow/references/profile.md` : null) : '还没有配置开发环境：运行 /workflow profile 由脚本推断后确认，见 workflow/references/profile.md',
  };
}

export function readProfile(root) {
  const f = path.join(profileDir(root), 'profile.json');
  const profile = readJson(f);
  const get = (k) => k.split('.').reduce((o, p) => (o == null ? undefined : o[p]), profile);
  const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);
  const empty = profile ? PROFILE_FIELDS.filter((k) => isEmpty(get(k))) : PROFILE_FIELDS;
  return {
    path: relOf(root, f), exists: !!profile, profile: profile ?? {}, empty, env: readEnv(root), toolchain: readToolchain(root),
    complete: !!profile && PROFILE_REQUIRED.every((k) => !empty.includes(k)),
  };
}
