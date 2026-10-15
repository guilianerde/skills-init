// 公共常量与工具：路径、输出、文件读写、安装清单读取

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSkills, deriveMeta, withDependencies } from '../skills.mjs';

export const TPL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PKG = JSON.parse(fs.readFileSync(path.join(TPL_DIR, 'package.json'), 'utf8'));
export const IS_WIN = process.platform === 'win32';

export const ENV_NAMES = ['codex', 'claude', 'doubao', 'qwen'];
export const CANON_DIR = path.join('.agents', 'skills'); // 单一来源目录
// skill 列表、用户配置、改名清理、文档模板都来自各 skill 目录的 skill.json（见 bin/skills.mjs）
export const SKILL_LIST = loadSkills(TPL_DIR);
export const META = deriveMeta(SKILL_LIST);
// --skills 子集：加上 requires 依赖后的安装列表
export const resolveSkillSelection = (names) => withDependencies(SKILL_LIST, names);
export const SKILLS = META.skills;
// 用户配置：重跑不覆盖；值为对应空模板（用于判断单一来源中的文件是否还没被填写过）
export const USER_FILES = META.userFiles;
// 改过名的 skill：旧名 -> 新名。升级时只清理能确认是本项目安装的旧目录 / 链接（按 SKILL.md 签名判断）
export const RENAMED = META.renamed;
export const DOCNEXUS_PKG = process.env.DOCNEXUS_PKG || '@rowansenne/docnexus';
export const MANIFEST = '.skills-init.json'; // 安装清单，位于每个安装目录（单一来源时只有 .agents/skills 一份）

// ---------------------------------------------------------------- 输出
export const step = (m) => console.log(`==> ${m}`);
export const ok = (m) => console.log(`    OK  ${m}`);
export const warn = (m) => console.error(`    !!  ${m}`);
export class CliError extends Error {}
export const fail = (m) => { throw new CliError(m); };

export function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

export function walk(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else if (e.isFile() && e.name !== '.DS_Store') out.push(path.relative(base, p));
  }
  return out;
}
export const toPosix = (p) => p.split(path.sep).join('/');
export const sameFile = (a, b) => fs.existsSync(a) && fs.existsSync(b) && fs.readFileSync(a).equals(fs.readFileSync(b));
export function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
export function render(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
export const fileHash = (f) => sha256(fs.readFileSync(f));
export function readManifest(base) {
  const m = readJson(path.join(base, MANIFEST));
  return m && typeof m === 'object' && m.skills && typeof m.skills === 'object' ? m : null;
}

// 删除 dir 及其上级的空目录，直到 stop（不含）
export function removeEmptyDirs(dir, stop) {
  for (let d = dir; d !== stop && d.startsWith(stop + path.sep); d = path.dirname(d)) {
    try { fs.rmdirSync(d); } catch { break; }
  }
}

export function lstat(p) { try { return fs.lstatSync(p); } catch { return null; } }
// 删除软链接本身（不碰目标）。Windows 上指向目录的软链接 / junction 被当成目录：unlink 报 EPERM / EISDIR，
// fs.rmSync 也会报「Path is a directory」，要用 rmdir 删；不存在时什么都不做
export function removeLink(p) {
  try { fs.unlinkSync(p); } catch (e) {
    if (e.code === 'ENOENT') return;
    if (e.code === 'EPERM' || e.code === 'EISDIR') fs.rmdirSync(p); else throw e;
  }
}
export function timestamp() {
  const d = new Date(); const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}

export const INSTALL_BASES = [CANON_DIR, path.join('.claude', 'skills'), path.join('.qwen', 'skills')];
// 找到本项目的安装清单（单一来源优先；--copy 安装时各目录各有一份）
export function findManifests(root) {
  return INSTALL_BASES.map((rel) => ({ rel, base: path.join(root, rel), m: readManifest(path.join(root, rel)) })).filter((x) => x.m);
}
export function cmpVersion(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  return 0;
}
