// 项目布局与配置；不依赖需求写入或任何命令入口。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SKILLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INSTALL_BASES = ['.agents/skills', '.claude/skills', '.qwen/skills', '.codebuddy/skills'];
const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const toPosix = (p) => p.split(path.sep).join('/');
const relOf = (root, abs) => toPosix(path.relative(root, abs));

// 本工具在项目里的唯一目录
export const HOME = 'workflow-run';
export const REQ_DIR = `${HOME}/docs/requirements`;
export const TEMPLATES_DIR = `${HOME}/templates`;
export const TMP_DIR = `${HOME}/tmp`;
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
// 画像所在目录：本脚本所在的 skills 目录；从安装包调用时（安装器）到项目里已安装的 skills 目录找
export function profileDir(root) {
  const own = path.join(SKILLS_DIR, 'workflow');
  if (fs.existsSync(path.join(own, 'profile.json')) || fs.existsSync(path.join(own, 'profile.local.json'))) return own;
  for (const b of INSTALL_BASES) { const d = path.join(root, b, 'workflow'); if (fs.existsSync(path.join(d, 'profile.json'))) return d; }
  return own;
}

// workflow/profile.json 的 artifacts，profile.local.json（个人设置，不提交）覆盖其上
export function artifactsConfig(root) {
  const dir = profileDir(root);
  const team = readJson(path.join(dir, 'profile.json'))?.artifacts ?? {};
  const mine = readJson(path.join(dir, 'profile.local.json'))?.artifacts ?? {};
  const c = { ...team, ...mine };
  return { project: c.project ? String(c.project) : '', commit_prompt: c.commit_prompt !== false, profile_dir: dir };
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
export function readEnv() {
  const rec = readJson(path.join(SKILLS_DIR, 'workflow', 'profile.local.json'))?.env;
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
  if (s === '~' || s.startsWith('~/') || s.startsWith('~\\')) s = home ? home + s.slice(1) : s;
  const missing = [];
  for (const m of v.matchAll(VAR_RE)) { const n = m[1] ?? m[2] ?? m[3]; if (!look(n)) missing.push(n); }
  const resolved = s.replace(VAR_RE, (m, a, b, c) => look(a ?? b ?? c)).replace(/[\\/]+$/, '');
  return { raw: v, resolved, missing };
}

// 画像里的 toolchain（profile.json）与个人覆盖（profile.local.json），逐个子字段合并，后者优先。
// 「没声明」和「显式写空」是两回事：本机写 "" 表示**不使用**团队那个值（用工具自己的默认配置），
// 所以要按 null / "" 区分来源，不能只看值真不真。
export function readToolchain(root) {
  const dir = path.join(SKILLS_DIR, 'workflow');
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
  const f = path.join(SKILLS_DIR, 'workflow', 'profile.json');
  const profile = readJson(f);
  const get = (k) => k.split('.').reduce((o, p) => (o == null ? undefined : o[p]), profile);
  const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);
  const empty = profile ? PROFILE_FIELDS.filter((k) => isEmpty(get(k))) : PROFILE_FIELDS;
  return {
    path: relOf(root, f), exists: !!profile, profile: profile ?? {}, empty, env: readEnv(), toolchain: readToolchain(root),
    complete: !!profile && PROFILE_REQUIRED.every((k) => !empty.includes(k)),
  };
}
