#!/usr/bin/env node
// skills-init — 项目级 Agent Skills 一键初始化（Node 版，跨平台单一实现）
//
// 用法：
//   npx @rowansenne/skills-init [选项]                 # 在项目根执行
//   node skills-init/bin/skills-init.mjs [选项]        # 仓库放在 <项目根>/skills-init/ 时
//   ./skills-init/init-skills.sh / .\skills-init\init-skills.ps1   # 薄封装，等价于上一行
//
// 单一来源：skills 只完整安装到 .agents/skills（codex / doubao 直接使用）；
//           .claude/skills、.qwen/skills 下按 skill 建相对软链接指向它；--copy 退回各环境独立拷贝。
// 重跑安全：SKILL.md / references / 模板会更新；用户已填写的 wiki-config.json、schema.md、
//           workflow/profile.json 保留不覆盖；database-query/config.json 仅在本次提供了数据库配置时写入。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TPL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(fs.readFileSync(path.join(TPL_DIR, 'package.json'), 'utf8'));
const IS_WIN = process.platform === 'win32';

const ENV_NAMES = ['codex', 'claude', 'doubao', 'qwen'];
const CANON_DIR = path.join('.agents', 'skills'); // 单一来源目录
const SKILLS = ['workflow', 'dev', 'project-review', 'database-query', 'md-to-wiki', 'create-tech-md-doc', 'create-release-md-doc'];
// 用户配置：重跑不覆盖；值为对应空模板（用于判断单一来源中的文件是否还没被填写过）
const USER_FILES = {
  'database-query/config.json': null,
  'database-query/references/schema.md': null,
  'md-to-wiki/wiki-config.json': 'md-to-wiki/wiki-config.json.tpl',
  'workflow/profile.json': 'workflow/profile.json.tpl',
};
// 改过名的 skill：旧名 -> 新名。升级时只清理能确认是本项目安装的旧目录 / 链接（按 SKILL.md 签名判断）
const RENAMED = { 'code-review': { to: 'project-review', signature: /^name:\s*code-review\s*$[\s\S]*?description:\s*"Review source code \(/m } };
const DOCNEXUS_PKG = process.env.DOCNEXUS_PKG || '@rowansenne/docnexus';

// ---------------------------------------------------------------- 输出
const step = (m) => console.log(`==> ${m}`);
const ok = (m) => console.log(`    OK  ${m}`);
const warn = (m) => console.error(`    !!  ${m}`);
class CliError extends Error {}
const fail = (m) => { throw new CliError(m); };

// ---------------------------------------------------------------- 参数
const HELP = `用法: skills-init [选项]

  --envs <列表>        环境，逗号分隔：codex,claude,doubao,qwen；all = 全部（不传则交互选择）
  --skip-db            跳过数据库连接配置
  --yes                非交互：使用已有数据库配置；都没有且未 --skip-db 时报错退出
  --with-docnexus      同时接入 DocNexus 文档库（需 Node >= 22.13 与 npm）
  --copy               不用软链接，各环境独立拷贝
  --project-root <dir> 项目根目录（默认当前目录）
  -v, --version        显示版本
  -h, --help           显示帮助`;

function parseArgs(argv) {
  const o = { envs: '', skipDb: false, yes: false, withDocNexus: false, copy: false, root: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) fail(`${a} 需要一个值`); return argv[++i]; };
    switch (a) {
      case '--envs': o.envs = val(); break;
      case '--skip-db': o.skipDb = true; break;
      case '--yes': o.yes = true; break;
      case '--with-docnexus': o.withDocNexus = true; break;
      case '--copy': o.copy = true; break;
      case '--project-root': o.root = path.resolve(val()); break;
      case '-v': case '--version': console.log(PKG.version); process.exit(0); break;
      case '-h': case '--help': console.log(HELP); process.exit(0); break;
      default: fail(`未知参数: ${a}\n${HELP}`);
    }
  }
  if (!fs.existsSync(o.root) || !fs.statSync(o.root).isDirectory()) fail(`项目根目录不存在: ${o.root}`);
  return o;
}

// ---------------------------------------------------------------- 交互输入（TTY 与管道输入都支持）
let rl, lines;
function input() {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
    lines = rl[Symbol.asyncIterator]();
  }
  return rl;
}
async function ask(prompt, { hidden = false } = {}) {
  const r = input();
  process.stdout.write(prompt);
  let muted = false;
  if (hidden && process.stdin.isTTY) {
    const orig = r._writeToOutput;
    r._writeToOutput = (s) => { if (!muted) orig.call(r, s); };
    muted = true;
    const res = await lines.next();
    muted = false;
    r._writeToOutput = orig;
    process.stdout.write('\n');
    return res.done ? '' : res.value.trim();
  }
  const res = await lines.next();
  if (hidden) process.stdout.write('\n');
  return res.done ? '' : res.value.trim();
}

// ---------------------------------------------------------------- 1. 环境选择
async function resolveEnvs(o) {
  if (o.envs) {
    if (o.envs.trim().toLowerCase() === 'all') return [...ENV_NAMES];
    // PowerShell 把未加引号的 codex,claude 当数组再以空格拼接，所以逗号和空白都当分隔符
    const sel = o.envs.split(/[,，\s]+/).map((s) => s.trim().toLowerCase()).filter((s) => ENV_NAMES.includes(s));
    return sel.length ? [...new Set(sel)].sort() : [...ENV_NAMES];
  }
  step('选择要安装 skills 的环境');
  console.log('  1) codex     -> .agents/skills （Codex 项目级，与豆包共用）');
  console.log('  2) claude    -> .claude/skills （Claude Code 项目级）');
  console.log('  3) doubao    -> .agents/skills （豆包办公项目级）');
  console.log('  4) qwen      -> .qwen/skills   （Qwen Code 项目级）');
  const choice = await ask('输入编号（逗号分隔，如 1,3；直接回车 = 全部）: ');
  if (!choice) return [...ENV_NAMES];
  const sel = choice.split(/[,，\s]+/).filter((p) => /^[1-4]$/.test(p)).map((p) => ENV_NAMES[Number(p) - 1]);
  if (!sel.length) { warn('未识别到有效编号，按全部安装'); return [...ENV_NAMES]; }
  return [...new Set(sel)].sort();
}

// ---------------------------------------------------------------- 2. 数据库连接配置
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
// 已有配置中的默认连接：default_connection → default → 第一个连接
function defaultConn(cfg) {
  const conns = cfg?.connections;
  if (!conns || typeof conns !== 'object') return null;
  const name = cfg.default_connection && conns[cfg.default_connection] ? cfg.default_connection
    : conns.default ? 'default' : Object.keys(conns)[0];
  return name ? { name, conn: conns[name] } : null;
}
function findExistingDbConfig(root) {
  for (const rel of ['.codex/database-query/config.json', '.agents/skills/database-query/config.json',
    '.claude/skills/database-query/config.json', '.qwen/skills/database-query/config.json']) {
    const f = path.join(root, rel);
    const cfg = readJson(f);
    const d = defaultConn(cfg);
    if (d?.conn?.host) return { file: f, cfg, ...d };
  }
  return null;
}
// 返回 { name, conn, reused, sourceCfg }；null 表示跳过
async function getDb(o) {
  const existing = findExistingDbConfig(o.root);
  if (existing && existing.conn.database) {
    const c = existing.conn;
    const pw = c.password_env ? `$${c.password_env}` : c.password ? '****' : '';
    step('数据库连接配置');
    console.log(`    检测到现有配置: ${existing.file}`);
    console.log(`    连接=${existing.name}  driver=${c.driver || 'mysql'}  host=${c.host}:${c.port ?? '?'}  db=${c.database}  user=${c.user || ''}  password=${pw}  readonly=${c.readonly === false ? 'false' : 'true'}`);
    const db = { name: existing.name, conn: c, reused: true, sourceCfg: existing.cfg };
    if (o.yes) { ok('非交互模式，使用现有配置'); return db; }
    const a = (await ask('使用此配置？[Y=使用 / n=重新填写 / s=跳过数据库]: ')).toLowerCase();
    if (a === 's' || a === 'skip') return null;
    if (a !== 'n') return db;
  }
  if (o.yes) return null;
  step('填写数据库连接（写入 database-query/config.json 的 default 连接，并加入 .gitignore）');
  const driver = (await ask('数据库驱动 [mysql]: ')) || 'mysql';
  const host = await ask('数据库主机: ');
  const portStr = await ask('端口: ');
  const database = await ask('数据库名: ');
  const user = await ask('用户名: ');
  const password = await ask('密码（留空则改用环境变量，推荐）: ', { hidden: true });
  const passwordEnv = password ? '' : ((await ask('密码所在的环境变量名 [DB_PASSWORD]: ')) || 'DB_PASSWORD');
  const ro = (await ask('设为只读连接？[Y/n]: ')).toLowerCase();
  const port = /^\d+$/.test(portStr) ? Number(portStr) : (driver === 'postgresql' ? 5432 : 3306);
  if (!host || !database || !user) { warn('主机/库名/用户不能为空，跳过数据库配置'); return null; }
  const conn = { driver, host, port, database, user };
  if (password) conn.password = password; else conn.password_env = passwordEnv;
  conn.readonly = ro !== 'n';
  return { name: 'default', conn, reused: false };
}

// ---------------------------------------------------------------- 3. 安装
function walk(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else if (e.isFile() && e.name !== '.DS_Store') out.push(path.relative(base, p));
  }
  return out;
}
const toPosix = (p) => p.split(path.sep).join('/');
const sameFile = (a, b) => fs.existsSync(a) && fs.existsSync(b) && fs.readFileSync(a).equals(fs.readFileSync(b));
function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
function render(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

function installSkills(base, db) {
  for (const skill of SKILLS) {
    const srcDir = path.join(TPL_DIR, skill);
    const dstDir = path.join(base, skill);
    const notes = [];
    for (const rel of walk(srcDir)) {
      const outRel = rel.endsWith('.tpl') ? rel.slice(0, -4) : rel;
      const key = `${skill}/${toPosix(outRel)}`;
      const src = path.join(srcDir, rel);
      const dst = path.join(dstDir, outRel);
      if (!(key in USER_FILES)) { writeFile(dst, fs.readFileSync(src)); continue; }

      if (key === 'database-query/references/schema.md') {
        if (fs.existsSync(dst)) notes.push('schema.md 已存在，保留不覆盖');
        else if (db) writeFile(dst, render(fs.readFileSync(src, 'utf8'), db.conn));
      } else if (key === 'workflow/profile.json') {
        const legacy = path.join(base, 'dev', 'profile.json');
        if (fs.existsSync(dst)) notes.push('profile.json 已存在，保留不覆盖');
        else if (fs.existsSync(legacy) && !isBlank(legacy)) {
          // 旧版本画像放在 dev/ 下：字段兼容，原样迁移（新增字段缺失时视为空）
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.renameSync(legacy, dst);
          notes.push('已把旧的 dev/profile.json 迁移为 workflow/profile.json');
        } else if (fs.existsSync(legacy)) {
          fs.rmSync(legacy); // 旧版本的空画像：直接换成新模板
          writeFile(dst, fs.readFileSync(src));
          notes.push('旧的空 dev/profile.json 已替换为 workflow/profile.json');
        } else { writeFile(dst, fs.readFileSync(src)); notes.push('profile.json 首次使用时由 agent 推断并经你确认后填写'); }
      } else if (fs.existsSync(dst)) notes.push(`${path.basename(dst)} 已存在，保留不覆盖`);
      else writeFile(dst, fs.readFileSync(src));
    }
    if (skill === 'database-query') notes.push(writeDbConfig(path.join(dstDir, 'config.json'), db));
    ok(`${skill} -> ${dstDir}${notes.length ? `（${notes.join('；')}）` : ''}`);
  }
}

// config.json 不来自模板：沿用已有配置时原样保留；新填写的连接写入 default，并保留文件中的其他连接
function writeDbConfig(dst, db) {
  if (!db) return fs.existsSync(dst) ? 'config.json 已存在，保留不覆盖' : '未生成 config.json（未配置数据库）';
  if (db.reused && fs.existsSync(dst)) return 'config.json 沿用已有配置';
  const base = readJson(dst) || (db.reused ? db.sourceCfg : null) || {};
  const cfg = { ...base, connections: { ...(base.connections || {}), [db.name]: db.conn } };
  if (!cfg.default_connection || !cfg.connections[cfg.default_connection]) cfg.default_connection = db.name;
  writeFile(dst, JSON.stringify(cfg, null, 2) + '\n');
  return `config.json 已写入（连接 ${db.name}，${db.conn.readonly === false ? '可写' : '只读'}）`;
}

// ---------------------------------------------------------------- 3b. 软链接到单一来源
// 用户配置是否仍是「未填写」：与模板逐字节相同，或 JSON 里每个值都为空 / false / 与模板默认值相同。
// 按内容判断而不是只比对字节，因为旧版本的模板（如 dev/profile.json）和新模板字段不同。
function isBlankJson(v, tpl) {
  if (v === null || v === undefined || v === '' || v === false) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.entries(v).every(([k, x]) => isBlankJson(x, tpl && typeof tpl === 'object' ? tpl[k] : undefined));
  return tpl !== undefined && v === tpl;
}
function isBlank(file, tplRel) {
  if (!fs.existsSync(file)) return true;
  const tpl = tplRel ? path.join(TPL_DIR, tplRel) : null;
  if (tpl && sameFile(file, tpl)) return true;
  if (!file.endsWith('.json')) return fs.readFileSync(file, 'utf8').trim() === '';
  const v = readJson(file);
  if (v === null) return false; // 解析不了：当作用户写过的内容，避免误覆盖
  return isBlankJson(v, tpl ? readJson(tpl) : undefined);
}

function migrateCopy(root, old, skill) {
  const canon = path.join(root, CANON_DIR);
  // 迁移计划：先全部检查，确认没有冲突再写，避免写了一半又因冲突保留旧目录
  const plan = [];
  const consider = (src, key, tpl) => {
    const dst = path.join(canon, key);
    if (isBlank(src, tpl)) return true;                       // 旧拷贝里没填过：跳过，不算冲突
    if (isBlank(dst, tpl) || sameFile(src, dst)) { plan.push([src, dst]); return true; }
    warn(`${old} 与 ${toPosix(CANON_DIR)}/${key} 内容不同，无法自动合并：保留旧目录、未建链接。请手动合并后删除旧目录再重跑。`);
    return false;
  };
  for (const [key, tpl] of Object.entries(USER_FILES)) {
    if (!key.startsWith(`${skill}/`)) continue;
    if (!consider(path.join(old, key.slice(skill.length + 1)), key, tpl)) return false;
  }
  // 旧版本画像在 dev/profile.json，迁到 workflow/profile.json
  if (skill === 'dev' && !consider(path.join(old, 'profile.json'), 'workflow/profile.json', 'workflow/profile.json.tpl')) return false;
  for (const [src, dst] of plan) writeFile(dst, fs.readFileSync(src));
  return true;
}

function lstat(p) { try { return fs.lstatSync(p); } catch { return null; } }
function timestamp() {
  const d = new Date(); const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}

// 能否在 dir 里创建目录软链接。先探测再动旧目录：建不了链接时旧拷贝原样保留、只更新模板。
// 环境变量 SKILLS_INIT_NO_SYMLINK=1 可强制走独立拷贝（测试与无法建链接的环境用）。
function symlinkSupported(dir) {
  if (process.env.SKILLS_INIT_NO_SYMLINK === '1') return false;
  const probe = path.join(dir, `.skills-init-probe-${process.pid}`);
  try {
    fs.symlinkSync('.', probe, 'dir');
    return true;
  } catch (e) {
    if (e.code === 'EPERM' || e.code === 'EACCES' || e.code === 'ENOTSUP') return false;
    throw e;
  } finally {
    fs.rmSync(probe, { force: true });
  }
}

// 返回 false 表示不能建软链接（调用方退回独立拷贝）
function linkSkills(root, envName, rel) {
  const dir = path.join(root, rel);
  fs.mkdirSync(dir, { recursive: true });
  if (!symlinkSupported(dir)) {
    warn(`${envName}：无法创建软链接（Windows 需开启开发者模式或以管理员运行，或设置了 SKILLS_INIT_NO_SYMLINK=1），改为独立拷贝到 ${dir}`);
    return false;
  }
  let skipped = 0;
  for (const skill of SKILLS) {
    const link = path.join(dir, skill);
    const target = path.join('..', '..', CANON_DIR, skill);
    const st = lstat(link);
    if (st?.isSymbolicLink()) {
      if (path.normalize(fs.readlinkSync(link)) === path.normalize(target)) continue;
      fs.rmSync(link, { force: true });
    } else if (st?.isDirectory()) {
      if (!migrateCopy(root, link, skill)) { skipped++; continue; }
      const bak = path.join(root, 'tmp', 'skills', 'backup', timestamp(), envName);
      fs.mkdirSync(bak, { recursive: true });
      fs.renameSync(link, path.join(bak, skill));
      ok(`${toPosix(rel)}/${skill} 旧的独立拷贝已并入单一来源，原目录备份到 ${toPosix(path.relative(root, bak))}/${skill}`);
    } else if (st) {
      warn(`${link} 已存在且不是目录或软链接，跳过`); skipped++; continue;
    }
    fs.symlinkSync(target, link, 'dir');
  }
  if (skipped === 0) ok(`${envName} -> ${toPosix(rel)}（软链接到 ${toPosix(CANON_DIR)}）`);
  else warn(`${envName} -> ${toPosix(rel)}：${skipped} 个 skill 未建链接（见上方提示），其余已软链接到 ${toPosix(CANON_DIR)}`);
  return true;
}

// ---------------------------------------------------------------- 3c. 清理改名前的旧 skill
function removeRenamed(root) {
  const dirs = [CANON_DIR, path.join('.claude', 'skills'), path.join('.qwen', 'skills')];
  for (const [oldName, { to, signature }] of Object.entries(RENAMED)) {
    for (const rel of dirs) {
      const p = path.join(root, rel, oldName);
      const st = lstat(p);
      if (!st) continue;
      if (st.isSymbolicLink()) {
        if (path.normalize(fs.readlinkSync(p)) !== path.normalize(path.join('..', '..', CANON_DIR, oldName))) continue;
        fs.rmSync(p, { force: true });
      } else if (st.isDirectory()) {
        const md = path.join(p, 'SKILL.md');
        if (!fs.existsSync(md) || !signature.test(fs.readFileSync(md, 'utf8'))) {
          warn(`${toPosix(path.join(rel, oldName))} 不是本项目安装的旧版 skill，保留不动`);
          continue;
        }
        fs.rmSync(p, { recursive: true, force: true });
      } else continue;
      ok(`已移除旧名 ${toPosix(path.join(rel, oldName))}（已改名为 ${to}）`);
    }
  }
}

// ---------------------------------------------------------------- 4. .gitignore 保护
function updateGitignore(root, withDocNexus) {
  const gi = path.join(root, '.gitignore');
  const rules = ['**/database-query/config.json', '**/wiki-config.json', '/tmp/'];
  if (withDocNexus) rules.push('node_modules/');
  const existing = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8').split(/\r?\n/).map((l) => l.trim()) : [];
  const missing = rules.filter((r) => !existing.includes(r));
  if (!missing.length) { ok('.gitignore 已包含全部规则'); return; }
  fs.appendFileSync(gi, `\n# Agent skills generated rules (credentials + tmp artifacts; do not commit)\n${missing.join('\n')}\n`);
  ok(`.gitignore 已追加：${missing.join(' ')}`);
}

// ---------------------------------------------------------------- 5. DocNexus（可选）
function run(cmd, args, cwd, quiet = false) {
  const r = spawnSync(cmd, args, { cwd, stdio: quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit', shell: IS_WIN });
  return r.status === 0;
}
function checkNodeForDocNexus() {
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 22 || (maj === 22 && min < 13)) fail(`--with-docnexus 需要 Node >= 22.13，当前为 v${process.versions.node}。请升级 Node 后重试，或去掉 --with-docnexus。`);
  if (spawnSync(IS_WIN ? 'npm.cmd' : 'npm', ['-v'], { stdio: 'ignore', shell: IS_WIN }).status !== 0) fail('--with-docnexus 需要 npm，但未找到。请安装后重试，或去掉 --with-docnexus。');
  ok(`Node v${process.versions.node}`);
}
function docnexusAgent(sel) {
  const c = sel.includes('claude');
  const x = sel.includes('codex') || sel.includes('doubao');
  return c && x ? 'all' : c ? 'claude' : x ? 'codex' : 'none';
}
function linkQwenDocNexus(root) {
  const srcRoot = path.join(root, 'docnexus', 'skills');
  const dst = path.join(root, '.qwen', 'skills');
  fs.mkdirSync(dst, { recursive: true });
  let n = 0;
  for (const e of fs.existsSync(srcRoot) ? fs.readdirSync(srcRoot, { withFileTypes: true }) : []) {
    if (!e.isDirectory()) continue;
    const link = path.join(dst, e.name);
    const st = lstat(link);
    if (st && !st.isSymbolicLink()) { warn(`${link} 已存在且不是软链接，跳过（如需改用 DocNexus 版本请先移除）`); continue; }
    if (st) fs.rmSync(link, { force: true });
    try { fs.symlinkSync(path.join('..', '..', 'docnexus', 'skills', e.name), link, 'dir'); n++; }
    catch (err) { warn(`qwen：无法创建软链接 ${link}（${err.code}）`); }
  }
  ok(`qwen：已链接 ${n} 个 DocNexus skill -> .qwen/skills（docnexus 本身不支持 qwen，由本工具补链）`);
}
function setupDocNexus(root, sel) {
  const agent = docnexusAgent(sel);
  step(`接入 DocNexus（npm i -D ${DOCNEXUS_PKG}；docnexus init --agent ${agent}）`);
  if (!fs.existsSync(path.join(root, 'package.json'))) warn('项目根没有 package.json，npm 会新建一个（仅记录 devDependency）');
  if (!run(IS_WIN ? 'npm.cmd' : 'npm', ['i', '-D', DOCNEXUS_PKG], root)) { warn('npm 安装 DocNexus 失败，已跳过 DocNexus 接入（skills 已正常安装）'); return 'failed'; }
  const bin = path.join(root, 'node_modules', '.bin', IS_WIN ? 'docnexus.cmd' : 'docnexus');
  if (!fs.existsSync(bin)) { warn('未找到 node_modules/.bin/docnexus，已跳过 DocNexus 接入'); return 'failed'; }
  if (!run(bin, ['init', '--agent', agent], root, true)) {
    warn(`docnexus init 失败，已跳过 DocNexus 接入（可在项目根手动执行 ./node_modules/.bin/docnexus init --agent ${agent}）`);
    return 'failed';
  }
  ok('docnexus init 完成：docnexus/ 工作区 + skills（docnexus/skills）');
  const where = { all: '.claude/skills 与 .agents/skills，并写入 CLAUDE.md / AGENTS.md', claude: '.claude/skills，并写入 CLAUDE.md', codex: '.agents/skills，并写入 AGENTS.md' }[agent];
  if (where) ok(`已链接到 ${where} 的 DocNexus 段落`);
  if (sel.includes('doubao')) ok('doubao 与 codex 共用 .agents/skills，按 codex 接入');
  if (sel.includes('qwen')) {
    linkQwenDocNexus(root);
    warn(agent === 'codex' || agent === 'all'
      ? 'qwen：docnexus 不会写 QWEN.md；需要自动召回时可在 QWEN.md 引用 AGENTS.md 中的 DocNexus 段落，或在 .qwen/settings.json 的 context.fileName 加入 AGENTS.md'
      : 'qwen：docnexus 不会写 QWEN.md；需要自动召回时可执行 ./node_modules/.bin/docnexus init --agent codex 生成 AGENTS.md 的 DocNexus 段落，再在 QWEN.md 引用它或在 .qwen/settings.json 的 context.fileName 加入 AGENTS.md（会同时链接到 .agents/skills）');
  }
  return 'ok';
}

// ================================================================= main
async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.withDocNexus) { step('检查 DocNexus 依赖'); checkNodeForDocNexus(); }

  const sel = await resolveEnvs(o);
  step(`目标环境：${sel.join(' ')}`);

  let db = null;
  if (!o.skipDb) {
    if (o.yes && !findExistingDbConfig(o.root)) {
      fail('非交互模式(--yes)但未找到已有数据库配置（.codex/ 或各环境 database-query/config.json），请去掉 --yes 手动输入，或加 --skip-db。');
    }
    db = await getDb(o);
  }

  // 安装目标：单一来源模式下 .agents/skills 只装一次，其余环境建链接；--copy 时各环境各装一份
  const targets = [];
  const links = [];
  if (o.copy) {
    if (sel.includes('codex') || sel.includes('doubao')) targets.push(['codex/doubao', CANON_DIR]);
    if (sel.includes('claude')) targets.push(['claude', path.join('.claude', 'skills')]);
    if (sel.includes('qwen')) targets.push(['qwen', path.join('.qwen', 'skills')]);
  } else {
    targets.push(['单一来源', CANON_DIR]);
    if (sel.includes('claude')) links.push(['claude', path.join('.claude', 'skills')]);
    if (sel.includes('qwen')) links.push(['qwen', path.join('.qwen', 'skills')]);
  }
  if (sel.includes('codex') && !o.yes) {
    const a = (await ask('是否同时安装到 Codex 用户级 ~/.codex/skills（所有项目可用）？[y/N]: ')).toLowerCase();
    if (a === 'y') targets.push(['codex(user)', path.join(os.homedir(), '.codex', 'skills')]);
  }
  rl?.close();

  removeRenamed(o.root);
  for (const [name, dir] of targets) {
    const abs = path.resolve(o.root, dir);
    step(`安装到 ${name}  ->  ${abs}`);
    installSkills(abs, db);
  }
  for (const [name, dir] of links) {
    step(`链接 ${name}  ->  ${path.join(o.root, dir)}`);
    if (!linkSkills(o.root, name, dir)) installSkills(path.join(o.root, dir), db);
  }

  updateGitignore(o.root, o.withDocNexus);
  const docnexus = o.withDocNexus ? setupDocNexus(o.root, sel) : 'skipped';

  step('安装完成，启用方式');
  console.log('  codex     : 重启 codex 后自动发现项目级 skills（.agents/skills）；也可 /use project-review 手动加载');
  console.log('  claude    : Claude Code 自动发现 .claude/skills，无需额外配置');
  console.log('  doubao    : 豆包办公自动发现 .agents/skills（新会话生效）');
  console.log('  qwen      : Qwen Code 自动发现 .qwen/skills；/skills 面板可查看与切换');
  if (db) ok('database-query 连接已生成并写入；凭据已加入 .gitignore，请勿提交。');
  else warn('注意：本次未写入数据库连接。可重跑补配，或手动放置 database-query/config.json（已有的保留不动）。');
  warn('注意：md-to-wiki 的 wiki 连接（wiki-config.json）默认留空（enabled=false），未配置前 md-to-wiki 与 create-*-md-doc 的 --prd 增强不启动。');
  warn('        启用方法：填写 .agents/skills/md-to-wiki/wiki-config.json（enabled: true + base_url + api_token），或接入对应环境的 wiki MCP。重跑不会覆盖已填写的配置。');
  if (docnexus === 'ok') ok('DocNexus 已接入：dev / project-review 会按 docnexus-recall 查项目约定；任何写入 DocNexus 的操作都需你授权。');
  if (docnexus === 'failed') warn('注意：DocNexus 接入失败（见上方输出），其他 skills 不受影响；修复后可重跑（加 --with-docnexus）。');
  console.log('先运行 /workflow profile 填写项目画像；说明见 skills-init README。');
  // skills 已装好，但显式要求的 DocNexus 未接入：返回非 0 便于自动化感知
  return docnexus === 'failed' ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => {
  rl?.close();
  if (e instanceof CliError) { console.error(`错误: ${e.message}`); process.exit(1); }
  console.error(e); process.exit(1);
});
