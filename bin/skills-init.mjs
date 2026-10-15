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
// 安装清单：每个安装目录写 .skills-init.json，记录模板文件的 sha256。重跑时据此判断模板文件是否被手改过
//           （改过的不静默覆盖）、清理模板里已删除的文件；--uninstall 按清单卸载。

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { seedTemplates, updateTemplates, templateStatus, STATUS_TEXT } from './seed-templates.mjs';
import { loadSkills, deriveMeta } from './skills.mjs';

const TPL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(fs.readFileSync(path.join(TPL_DIR, 'package.json'), 'utf8'));
const IS_WIN = process.platform === 'win32';

const ENV_NAMES = ['codex', 'claude', 'doubao', 'qwen'];
const CANON_DIR = path.join('.agents', 'skills'); // 单一来源目录
// skill 列表、用户配置、改名清理、文档模板都来自各 skill 目录的 skill.json（见 bin/skills.mjs）
const META = deriveMeta(loadSkills(TPL_DIR));
const SKILLS = META.skills;
// 用户配置：重跑不覆盖；值为对应空模板（用于判断单一来源中的文件是否还没被填写过）
const USER_FILES = META.userFiles;
// 改过名的 skill：旧名 -> 新名。升级时只清理能确认是本项目安装的旧目录 / 链接（按 SKILL.md 签名判断）
const RENAMED = META.renamed;
const DOCNEXUS_PKG = process.env.DOCNEXUS_PKG || '@rowansenne/docnexus';
const MANIFEST = '.skills-init.json'; // 安装清单，位于每个安装目录（单一来源时只有 .agents/skills 一份）

// ---------------------------------------------------------------- 输出
const step = (m) => console.log(`==> ${m}`);
const ok = (m) => console.log(`    OK  ${m}`);
const warn = (m) => console.error(`    !!  ${m}`);
class CliError extends Error {}
const fail = (m) => { throw new CliError(m); };

// ---------------------------------------------------------------- 参数
const COMMANDS = ['init', 'upgrade', 'doctor', 'uninstall', 'seed-templates'];
const HELP = `用法: skills-init [命令] [选项]

命令：
  init（默认）         安装或重装 skills
  upgrade              按安装清单里的环境与模式非交互升级到当前版本（保留数据库配置；手改过的文件另存 .new）
  doctor               自检：版本、手改 / 缺失文件、软链接、项目画像、DocNexus 模板、数据库连通性、.gitignore
  uninstall            按安装清单卸载本项目装的 skills 与链接（用户配置备份到 tmp/skills/uninstall-backup/）
  seed-templates       只把自带的文档模板导入 DocNexus（docnexus/library/templates/，已有的不覆盖）

init 选项：
  --envs <列表>        环境，逗号分隔：codex,claude,doubao,qwen；all = 全部（不传则交互选择）
  --skip-db            跳过数据库连接配置
  --yes                非交互：使用已有数据库配置；都没有且未 --skip-db 时报错退出
  --with-docnexus      同时接入 DocNexus 文档库（需 Node >= 22.13 与 npm），并导入文档模板
  --copy               不用软链接，各环境独立拷贝
  --seed-templates     安装后把文档模板导入 DocNexus；接入 DocNexus 后文档类 skill 只从知识库取模板
  --uninstall          同 uninstall 命令
seed-templates 选项：
  --update             同时把「导入后未改动、但默认模板有新版」的知识库模板更新为新版
doctor 选项：
  --offline            不测试数据库连通性
通用：
  --project-root <dir> 项目根目录（默认当前目录）
  -v, --version        显示版本
  -h, --help           显示帮助`;

function parseArgs(argv) {
  const o = { cmd: 'init', envs: '', skipDb: false, yes: false, withDocNexus: false, copy: false, seedTemplates: false, update: false, offline: false, root: process.cwd() };
  let cmdGiven = false; // 命令可以出现在选项之间（封装脚本会先传 --project-root）
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) fail(`${a} 需要一个值`); return argv[++i]; };
    switch (a) {
      case '--envs': o.envs = val(); break;
      case '--skip-db': o.skipDb = true; break;
      case '--yes': o.yes = true; break;
      case '--with-docnexus': o.withDocNexus = true; break;
      case '--copy': o.copy = true; break;
      case '--seed-templates': o.seedTemplates = true; break;
      case '--uninstall': o.cmd = 'uninstall'; cmdGiven = true; break;
      case '--offline': o.offline = true; break;
      case '--update': o.update = true; break;
      case '--project-root': o.root = path.resolve(val()); break;
      case '-v': case '--version': console.log(PKG.version); process.exit(0); break;
      case '-h': case '--help': console.log(HELP); process.exit(0); break;
      default:
        if (!cmdGiven && COMMANDS.includes(a)) { o.cmd = a; cmdGiven = true; break; }
        fail(`未知参数: ${a}\n${HELP}`);
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

// ---------------------------------------------------------------- 3a. 安装清单
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const fileHash = (f) => sha256(fs.readFileSync(f));
function readManifest(base) {
  const m = readJson(path.join(base, MANIFEST));
  return m && typeof m === 'object' && m.skills && typeof m.skills === 'object' ? m : null;
}
// 结尾汇总：另存为 .new 的 / 保留用户版本的 / 模板已删除但用户改过而保留的文件
const report = { asNew: [], kept: [], stale: [] };
// 删除 dir 及其上级的空目录，直到 stop（不含）
function removeEmptyDirs(dir, stop) {
  for (let d = dir; d !== stop && d.startsWith(stop + path.sep); d = path.dirname(d)) {
    try { fs.rmdirSync(d); } catch { break; }
  }
}
// 清单里有、新模板里已没有的文件：未被修改时删除，改过的保留并汇总提示
function pruneFile(file, recorded, stop, label) {
  if (!lstat(file)?.isFile()) return;
  if (fileHash(file) !== recorded) { report.stale.push(label); return; }
  fs.rmSync(file);
  removeEmptyDirs(path.dirname(file), stop);
  ok(`已清理模板中已删除的文件 ${label}`);
}

// 模板文件：不存在或未被手改过（与清单记录的哈希一致）时直接写入；手改过的按交互选择 / --yes 另存 .new。
// 没有清单（首次安装或旧版本装的）时无从判断，照旧覆盖。返回本次生成的 .new 文件名（没有则为 null）。
async function installTemplate(dst, content, recorded, hasManifest, ctx, label) {
  if (!fs.existsSync(dst)) { writeFile(dst, content); return null; }
  const cur = fileHash(dst);
  if (cur === sha256(content)) return null;
  if (!hasManifest || cur === recorded) { writeFile(dst, content); return null; }
  let choice = 'new';
  if (!ctx.yes) {
    const a = (await ask(`    ${label} 与上次安装的版本不同（被手动修改过）。o=用新模板覆盖 / k=保留你的版本 / 回车=保留并把新模板另存为 .new: `)).toLowerCase();
    if (a === 'o') choice = 'overwrite';
    else if (a === 'k') choice = 'keep';
  }
  if (choice === 'overwrite') { writeFile(dst, content); ok(`${label} 已用新模板覆盖`); return null; }
  if (choice === 'keep') { report.kept.push(label); return null; }
  writeFile(`${dst}.new`, content);
  report.asNew.push(label);
  return `${path.basename(dst)}.new`;
}

// entry 为 null 表示整个 skill 已从模板中移除
function pruneSkill(base, skill, prevSkill, entry, root) {
  if (!prevSkill) return;
  const dir = path.join(base, skill);
  if (lstat(dir)?.isSymbolicLink()) return;
  const stop = entry ? dir : base;
  for (const [rel, h] of Object.entries(prevSkill.files ?? {})) {
    if (entry && rel in entry.files) continue;
    pruneFile(path.join(dir, rel), h, stop, `${toPosix(path.relative(root, dir))}/${rel}`);
  }
  // 上次生成、这次不再需要的 .new（用户已处理，或这次选了覆盖 / 保留）
  for (const rel of prevSkill.pending ?? []) {
    if (entry?.pending.includes(rel)) continue;
    const f = path.join(dir, rel);
    if (lstat(f)?.isFile()) { fs.rmSync(f); removeEmptyDirs(path.dirname(f), stop); }
  }
}

// ctx: { root, yes, envs, mode }
async function installSkills(base, db, ctx) {
  const prev = readManifest(base);
  const manifest = { installer: PKG.name, version: PKG.version, installedAt: new Date().toISOString(), envs: ctx.envs, mode: ctx.mode, skills: {}, templates: prev?.templates ?? {} };
  for (const skill of SKILLS) {
    const srcDir = path.join(TPL_DIR, skill);
    const dstDir = path.join(base, skill);
    const prevSkill = prev?.skills?.[skill];
    const entry = { files: {}, userFiles: {}, pending: [] };
    const notes = [];
    for (const rel of walk(srcDir)) {
      const outRel = rel.endsWith('.tpl') ? rel.slice(0, -4) : rel;
      const key = `${skill}/${toPosix(outRel)}`;
      const src = path.join(srcDir, rel);
      const dst = path.join(dstDir, outRel);
      if (!(key in USER_FILES)) {
        const content = fs.readFileSync(src);
        const relPosix = toPosix(outRel);
        entry.files[relPosix] = sha256(content);
        const label = `${toPosix(path.relative(ctx.root, dstDir))}/${relPosix}`;
        const pending = await installTemplate(dst, content, prevSkill?.files?.[relPosix], !!prev, ctx, label);
        if (pending) entry.pending.push(path.posix.join(path.posix.dirname(relPosix), pending));
        continue;
      }

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
    // 用户配置只记录存在与否，不记哈希
    for (const key of Object.keys(USER_FILES)) {
      if (key.startsWith(`${skill}/`)) entry.userFiles[key.slice(skill.length + 1)] = fs.existsSync(path.join(base, key));
    }
    pruneSkill(base, skill, prevSkill, entry, ctx.root);
    manifest.skills[skill] = entry;
    ok(`${skill} -> ${dstDir}${notes.length ? `（${notes.join('；')}）` : ''}`);
  }
  // 清单里有、本版本已不再提供的 skill：按同样规则清理
  for (const [skill, prevSkill] of Object.entries(prev?.skills ?? {})) {
    if (!SKILLS.includes(skill)) pruneSkill(base, skill, prevSkill, null, ctx.root);
  }
  writeFile(path.join(base, MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
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
  // 之前 --copy 装在这里的清单：skill 都已换成链接，清单由单一来源那份负责
  if (skipped === 0) fs.rmSync(path.join(dir, MANIFEST), { force: true });
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

// ---------------------------------------------------------------- 3d. 卸载
// 软链接是否指向 absTarget（按解析后的绝对路径比较，兼容 Windows 上 readlink 返回的 \\?\ 前缀）
function linkPointsTo(link, absTarget) {
  let t;
  try { t = fs.readlinkSync(link); } catch { return false; }
  t = t.replace(/^\\\\\?\\/, '');
  const norm = (p) => (IS_WIN ? path.resolve(p).toLowerCase() : path.resolve(p));
  return norm(path.resolve(path.dirname(link), t)) === norm(absTarget);
}
// 删除目录软链接本身（Windows 上目录链接需 rmdir）
function removeLink(p) {
  try { fs.unlinkSync(p); } catch (e) {
    if (e.code === 'EPERM' || e.code === 'EISDIR') fs.rmdirSync(p); else throw e;
  }
}
function rmdirIfEmpty(dir) { try { fs.rmdirSync(dir); return true; } catch { return false; } }

function uninstall(root) {
  const bases = [CANON_DIR, path.join('.claude', 'skills'), path.join('.qwen', 'skills')];
  const found = bases.map((rel) => [rel, readManifest(path.join(root, rel))]).filter(([, m]) => m);
  if (!found.length) { warn(`未找到安装清单（${bases.map((b) => toPosix(path.join(b, MANIFEST))).join(' / ')}），没有可卸载的内容`); return 0; }
  const backupRoot = path.join(root, 'tmp', 'skills', 'uninstall-backup', timestamp());
  const backedUp = [];
  const leftovers = [];

  // 1. .claude / .qwen 下指向单一来源、且在清单里的 skill 链接；用户自己的链接和目录不动
  const canon = found.find(([rel]) => rel === CANON_DIR)?.[1];
  for (const rel of bases.slice(1)) {
    const dir = path.join(root, rel);
    let n = 0;
    for (const skill of Object.keys(canon?.skills ?? {})) {
      const link = path.join(dir, skill);
      if (!lstat(link)?.isSymbolicLink() || !linkPointsTo(link, path.join(root, CANON_DIR, skill))) continue;
      removeLink(link); n++;
    }
    if (n) ok(`已移除 ${toPosix(rel)} 下 ${n} 个指向 ${toPosix(CANON_DIR)} 的软链接`);
  }

  // 2. 各安装目录：按清单删除模板文件；用户配置与手改过的模板文件先备份
  for (const [rel, m] of found) {
    const base = path.join(root, rel);
    for (const [skill, entry] of Object.entries(m.skills)) {
      const dir = path.join(base, skill);
      const st = lstat(dir);
      if (!st || st.isSymbolicLink() || !st.isDirectory()) continue;
      const backup = (f) => {
        const to = path.join(backupRoot, rel, skill, f);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(path.join(dir, f), to);
        backedUp.push(toPosix(path.join(rel, skill, f)));
      };
      const remove = (f) => { fs.rmSync(path.join(dir, f)); };
      const files = [];
      for (const f of Object.keys(entry.userFiles ?? {})) if (lstat(path.join(dir, f))?.isFile()) { backup(f); files.push(f); }
      for (const [f, h] of Object.entries(entry.files ?? {})) {
        if (!lstat(path.join(dir, f))?.isFile()) continue;
        if (fileHash(path.join(dir, f)) === h) remove(f); else backup(f);
        files.push(f);
      }
      for (const f of entry.pending ?? []) if (lstat(path.join(dir, f))?.isFile()) { remove(f); files.push(f); }
      for (const f of files) removeEmptyDirs(path.dirname(path.join(dir, f)), base);
      if (fs.existsSync(dir)) leftovers.push(toPosix(path.join(rel, skill)));
      else ok(`已移除 ${toPosix(path.join(rel, skill))}`);
    }
    fs.rmSync(path.join(base, MANIFEST), { force: true });
  }

  // 3. 清空后的环境目录一并移除（.claude/.qwen 里还有别的东西时保留）
  for (const rel of bases) if (rmdirIfEmpty(path.join(root, rel))) rmdirIfEmpty(path.dirname(path.join(root, rel)));

  step('卸载完成');
  if (backedUp.length) {
    ok(`用户配置与手改过的文件已备份到 ${toPosix(path.relative(root, backupRoot))}/：`);
    for (const f of backedUp) console.log(`      ${f}`);
  }
  for (const d of leftovers) warn(`${d} 中有不在清单里的文件，已保留该目录`);
  console.log('.gitignore 中追加的规则未移除，如不再需要可手动删除。');
  return 0;
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

// ---------------------------------------------------------------- 6. upgrade / doctor
const INSTALL_BASES = [CANON_DIR, path.join('.claude', 'skills'), path.join('.qwen', 'skills')];
// 找到本项目的安装清单（单一来源优先；--copy 安装时各目录各有一份）
function findManifests(root) {
  return INSTALL_BASES.map((rel) => ({ rel, base: path.join(root, rel), m: readManifest(path.join(root, rel)) })).filter((x) => x.m);
}
function cmpVersion(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  return 0;
}

// upgrade = 用清单里记录的环境与模式非交互重装；数据库配置原样保留
function upgradeOptions(o) {
  const found = findManifests(o.root);
  if (!found.length) fail('未找到安装清单（.agents/skills/.skills-init.json 等），无法判断装过哪些环境。请先运行 init。');
  const m = found[0].m;
  const from = m.version ?? '未知';
  if (cmpVersion(from, PKG.version) > 0) warn(`已安装的是 ${from}，比当前包 ${PKG.version} 新；继续会降级。`);
  step(`升级：${from} -> ${PKG.version}（环境 ${(m.envs ?? []).join(',') || '未记录'}，模式 ${m.mode ?? 'symlink'}）`);
  const envs = Array.isArray(m.envs) && m.envs.length ? m.envs.join(',') : '';
  if (!envs) fail('安装清单里没有记录环境，请用 init --envs <列表> 重装。');
  return { ...o, cmd: 'init', envs, copy: m.mode === 'copy', yes: true, skipDb: true };
}

function doctor(root, offline) {
  const errors = [];
  const warns = [];
  const bad = (m) => { errors.push(m); console.log(`    XX  ${m}`); };
  const meh = (m) => { warns.push(m); warn(m); };
  step(`skills-init doctor（${PKG.version}）  ${root}`);

  const [maj] = process.versions.node.split('.').map(Number);
  if (maj < 18) bad(`Node v${process.versions.node} 低于 18`); else ok(`Node v${process.versions.node}`);

  const found = findManifests(root);
  if (!found.length) { bad('未找到安装清单：本项目还没用 skills-init 安装过（或是清单功能之前的旧版本安装，重跑 init 即可生成）'); return 1; }
  const m = found[0].m;
  const c = cmpVersion(m.version ?? '0', PKG.version);
  if (c < 0) meh(`已安装 ${m.version}，当前包是 ${PKG.version}：运行 skills-init upgrade 升级`);
  else if (c > 0) meh(`已安装 ${m.version}，比当前包 ${PKG.version} 新（当前包版本过旧）`);
  else ok(`已安装版本 ${m.version}（环境 ${(m.envs ?? []).join(',')}，模式 ${m.mode}）`);

  step('文件完整性');
  for (const { rel, base, m: man } of found) {
    let modified = 0, missing = 0;
    for (const [skill, entry] of Object.entries(man.skills)) {
      const dir = path.join(base, skill);
      if (!fs.existsSync(dir)) { bad(`${toPosix(path.join(rel, skill))} 不存在：运行 skills-init upgrade 恢复`); continue; }
      for (const [f, h] of Object.entries(entry.files ?? {})) {
        const file = path.join(dir, f);
        const label = toPosix(path.join(rel, skill, f));
        if (!fs.existsSync(file)) { missing++; meh(`缺少 ${label}：运行 skills-init upgrade 恢复`); }
        else if (fileHash(file) !== h) { modified++; meh(`${label} 被手动修改过（升级时不会被覆盖，新模板另存 .new）`); }
      }
      for (const f of entry.pending ?? []) if (fs.existsSync(path.join(dir, f))) meh(`${toPosix(path.join(rel, skill, f))} 待合并：对比后删除`);
    }
    if (!modified && !missing) ok(`${toPosix(rel)}：${Object.keys(man.skills).length} 个 skill 的模板文件与安装时一致`);
  }

  const canon = found.find((x) => x.rel === CANON_DIR);
  if (canon && m.mode !== 'copy') {
    step('软链接');
    for (const env of ['claude', 'qwen']) {
      if (!(m.envs ?? []).includes(env)) continue;
      const dir = path.join(root, `.${env}`, 'skills');
      let good = 0;
      for (const skill of Object.keys(canon.m.skills)) {
        const link = path.join(dir, skill);
        const st = lstat(link);
        if (!st) bad(`.${env}/skills/${skill} 不存在：运行 skills-init upgrade 重建`);
        else if (!st.isSymbolicLink()) { if (!readManifest(dir)) meh(`.${env}/skills/${skill} 是普通目录而非软链接（可能是建链接失败后的独立拷贝）`); else good++; }
        else if (!fs.existsSync(link)) bad(`.${env}/skills/${skill} 是断开的软链接`);
        else good++;
      }
      if (good === Object.keys(canon.m.skills).length) ok(`.${env}/skills 全部指向 ${toPosix(CANON_DIR)}`);
    }
  }

  // 画像 / DocNexus / 数据库：调用已安装的 resolve.mjs，与 skill 运行时的判定完全一致
  const skillsBase = (canon ?? found[0]).base;
  const resolveJs = path.join(skillsBase, 'workflow', 'scripts', 'resolve.mjs');
  step('项目画像与增强能力');
  let st = null;
  if (fs.existsSync(resolveJs)) {
    const r = spawnSync(process.execPath, [resolveJs, '--root', root, 'status'], { encoding: 'utf8' });
    try { st = JSON.parse(r.stdout); } catch { bad(`resolve.mjs status 执行失败：${(r.stderr || '').trim().split('\n')[0]}`); }
  } else bad('缺少 workflow/scripts/resolve.mjs：运行 skills-init upgrade');
  if (st) {
    if (st.profile.ok) ok('项目画像已填写'); else meh(`项目画像未完成（空字段：${st.profile.empty.join('、')}）：运行 /workflow profile`);
    if (st.wiki.ok) ok('wiki 已配置'); else console.log('    --  wiki 未配置（可选；也可能通过 wiki MCP 提供）');
    if (st.docnexus.ok) {
      if (!reportTemplateStatus(root, meh)) ok('DocNexus 已接入，文档模板齐全且与默认模板同步（或为团队定制版）');
      for (const f of st.docnexus.stale_project_templates) meh(`${f} 在接入 DocNexus 后已不再生效，建议删除`);
    } else console.log('    --  DocNexus 未接入（可选）');
    if (!st.database.ok) console.log('    --  数据库未配置（可选）');
  }

  if (st?.database.ok) {
    step(offline ? '数据库（--offline，跳过连通性测试）' : '数据库连通性（只读 SELECT 1）');
    const queryJs = path.join(skillsBase, 'database-query', 'scripts', 'query.mjs');
    for (const [name, info] of Object.entries(st.database.connections)) {
      if (offline) { ok(`${name}：${info.driver}，${info.readonly ? '只读' : '可写'}`); continue; }
      const r = spawnSync(process.execPath, [queryJs, '--conn', name, '--timeout', '10', '--format', 'tsv', 'SELECT 1'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const msg = (r.stderr || '').trim().split('\n')[0];
      if (r.status === 0) ok(`${name}：连接正常（${info.readonly ? '只读' : '可写'}）`);
      else if (r.status === 3) console.log(`    --  ${name}：${msg}`);
      else meh(`${name}：${msg || '连接失败'}`);
    }
  }

  step('.gitignore');
  const gi = path.join(root, '.gitignore');
  const lines = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8').split(/\r?\n/).map((l) => l.trim()) : [];
  const need = ['**/database-query/config.json', '**/wiki-config.json'];
  const lack = need.filter((r) => !lines.includes(r));
  if (lack.length) bad(`.gitignore 缺少 ${lack.join(' ')}：凭据可能被提交，重跑 skills-init upgrade 补齐`); else ok('凭据文件已被忽略');

  console.log(`\n${errors.length} 个错误，${warns.length} 个警告`);
  return errors.length ? 1 : 0;
}

// ---------------------------------------------------------------- 7. DocNexus 模板导入记录（存于安装清单 templates 字段）
function templateRecords(root) { return findManifests(root)[0]?.m.templates ?? {}; }
function saveTemplateRecords(root, recs) {
  if (!Object.keys(recs).length) return;
  const found = findManifests(root)[0];
  if (!found) return; // 没有安装清单（只单独跑了 seed-templates）：无处记录，之后 doctor 显示为 untracked
  found.m.templates = { ...(found.m.templates ?? {}), ...recs };
  writeFile(path.join(found.base, MANIFEST), JSON.stringify(found.m, null, 2) + '\n');
}
// 打印需要关注的模板状态，返回是否有需要处理的
function reportTemplateStatus(root, say = warn) {
  const list = templateStatus(root, TPL_DIR, templateRecords(root)).filter((s) => !['current', 'edited'].includes(s.status));
  for (const s of list) say(`DocNexus 模板 ${s.file}：${STATUS_TEXT[s.status]}${s.status === 'customized' || s.status === 'untracked' ? `（默认模板：${s.defaultPath}）` : ''}`);
  return list.length > 0;
}

// ================================================================= main
async function main() {
  let o = parseArgs(process.argv.slice(2));
  if (o.cmd === 'uninstall') { step(`按安装清单卸载 ${o.root} 中的 skills`); return uninstall(o.root); }
  if (o.cmd === 'doctor') return doctor(o.root, o.offline);
  if (o.cmd === 'seed-templates') {
    step('导入文档模板到 DocNexus');
    try {
      const r = seedTemplates(o.root, TPL_DIR, { ok, warn, version: PKG.version });
      saveTemplateRecords(o.root, r.records);
      let failed = r.failed.length;
      if (o.update) {
        step('更新导入后未改动的模板（--update）');
        const u = updateTemplates(o.root, TPL_DIR, templateRecords(o.root), { ok, warn, version: PKG.version });
        saveTemplateRecords(o.root, u.records);
        failed += u.failed.length;
      }
      reportTemplateStatus(o.root);
      return failed ? 1 : 0;
    } catch (e) { warn(e.message); return 1; }
  }
  if (o.cmd === 'upgrade') o = upgradeOptions(o);
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

  removeRenamed(o.root);
  const ctx = { root: o.root, yes: o.yes, envs: sel, mode: o.copy ? 'copy' : 'symlink' };
  for (const [name, dir] of targets) {
    const abs = path.resolve(o.root, dir);
    step(`安装到 ${name}  ->  ${abs}`);
    await installSkills(abs, db, ctx);
  }
  for (const [name, dir] of links) {
    step(`链接 ${name}  ->  ${path.join(o.root, dir)}`);
    if (!linkSkills(o.root, name, dir)) await installSkills(path.join(o.root, dir), db, { ...ctx, mode: 'copy-fallback' });
  }
  rl?.close(); // 模板冲突时可能还要询问，装完再关

  updateGitignore(o.root, o.withDocNexus);
  const docnexus = o.withDocNexus ? setupDocNexus(o.root, sel) : 'skipped';
  let seedFailed = false;
  // 接入 DocNexus 后文档类 skill 只从知识库取模板，所以 --with-docnexus 时一并导入（已有的不覆盖）
  if ((o.seedTemplates || o.withDocNexus) && docnexus !== 'failed') {
    step('导入文档模板到 DocNexus（--seed-templates）');
    try {
      const r = seedTemplates(o.root, TPL_DIR, { ok, warn, version: PKG.version });
      saveTemplateRecords(o.root, r.records);
      seedFailed = r.failed.length > 0;
    } catch (e) { warn(e.message); seedFailed = true; }
  }

  step('安装完成，启用方式');
  console.log('  codex     : 重启 codex 后自动发现项目级 skills（.agents/skills）；也可 /use project-review 手动加载');
  console.log('  claude    : Claude Code 自动发现 .claude/skills，无需额外配置');
  console.log('  doubao    : 豆包办公自动发现 .agents/skills（新会话生效）');
  console.log('  qwen      : Qwen Code 自动发现 .qwen/skills；/skills 面板可查看与切换');
  if (db) ok('database-query 连接已生成并写入；凭据已加入 .gitignore，请勿提交。');
  else if (fs.existsSync(path.join(o.root, CANON_DIR, 'database-query', 'config.json'))) ok('database-query/config.json 已存在，保留不动。');
  else warn('注意：本次未写入数据库连接。可重跑补配，或手动放置 database-query/config.json（已有的保留不动）。');
  warn('注意：md-to-wiki 的 wiki 连接（wiki-config.json）默认留空（enabled=false），未配置前 md-to-wiki 与 create-*-md-doc 的 --prd 增强不启动。');
  warn('        启用方法：填写 .agents/skills/md-to-wiki/wiki-config.json（enabled: true + base_url + api_token），或接入对应环境的 wiki MCP。重跑不会覆盖已填写的配置。');
  if (docnexus === 'ok') ok('DocNexus 已接入：dev / project-review 会按 docnexus-recall 查项目约定；文档类 skill 只从 docnexus/library/templates/ 取模板；任何写入 DocNexus 的操作都需你授权。');
  // 已接入 DocNexus：缺模板时文档类 skill 会停下来要求导入；默认模板有新版时提示更新或合并
  if (fs.existsSync(path.join(o.root, 'docnexus', 'project.json'))) reportTemplateStatus(o.root);
  if (docnexus === 'failed') warn('注意：DocNexus 接入失败（见上方输出），其他 skills 不受影响；修复后可重跑（加 --with-docnexus）。');
  if (report.asNew.length) {
    warn('以下文件被手动修改过，已保留你的版本，新模板另存为同目录的 <文件名>.new（对比合并后删除 .new，或用新模板覆盖原文件）：');
    for (const f of report.asNew) warn(`  ${f}  ->  ${path.basename(f)}.new`);
  }
  if (report.kept.length) warn(`以下文件按你的选择保留了修改，未更新为新模板：${report.kept.join('、')}`);
  if (report.stale.length) warn(`以下文件已不在新模板中，但被手动修改过，保留未删除：${report.stale.join('、')}`);
  console.log('先运行 /workflow profile 填写项目画像；说明见 skills-init README。');
  // skills 已装好，但显式要求的 DocNexus 未接入：返回非 0 便于自动化感知
  return docnexus === 'failed' || seedFailed ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => {
  rl?.close();
  if (e instanceof CliError) { console.error(`错误: ${e.message}`); process.exit(1); }
  console.error(e); process.exit(1);
});
