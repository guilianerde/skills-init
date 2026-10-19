// 安装：模板文件写入（带清单与手改保护）、单一来源软链接（独立拷贝切换为链接时合并用户配置）、.gitignore

import fs from 'node:fs';
import path from 'node:path';
import { TPL_DIR, PKG, CANON_DIR, INSTALL_BASES, SKILLS, SKILL_LIST, USER_FILES, MANIFEST, ok, warn, readJson, walk, toPosix, sameFile, writeFile, render, sha256, fileHash, readManifest, removeEmptyDirs, lstat, timestamp, removeLink, HOME } from './core.mjs';
import { writeDbConfig } from './db.mjs';
import { layout, ensureIgnore, homeIsRepo, migrateLayout, IGNORE_LINE, TMP_DIR } from '../../workflow/scripts/requirement.mjs';
import { detectEnv } from '../../workflow/scripts/resolve.mjs';

// 结尾汇总：被手改过、已用新版覆盖（原文件已备份）的 / 模板已删除、手改过而备份后删除的文件 /
// 没有安装清单、内容与新版不同而备份后覆盖的文件（无从判断是否手改）
export const report = { overwritten: [], removed: [], unlisted: [], unlistedDirs: [], backupDir: null };

// skills 目录里的文件一律以安装包为准：手改过的先备份到 <项目根>/workflow-run/tmp/upgrade-backup/<时间>/（同一次运行共用一个目录），
// 再覆盖或删除。项目自己的定制应放在不会被升级覆盖的地方：workflow/profile.json、DocNexus（文档模板只能在这里定制）、CLAUDE.md / AGENTS.md
let stamp = null;
function backup(root, file) {
  stamp ??= timestamp();
  const dir = path.join(root, TMP_DIR, 'upgrade-backup', stamp);
  const rel = path.relative(root, file);
  const target = path.join(dir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(file, target);
  report.backupDir = toPosix(path.relative(root, dir));
}

// 清单里有、新模板里已没有的文件：删除；手改过的先备份
export function pruneFile(file, recorded, stop, label, root) {
  if (!lstat(file)?.isFile()) return;
  if (fileHash(file) !== recorded) { backup(root, file); report.removed.push(label); }
  fs.rmSync(file);
  removeEmptyDirs(path.dirname(file), stop);
  ok(`已清理模板中已删除的文件 ${label}`);
}

// 模板文件：总是写成新版。和上次安装记录的哈希不同（被手改过）时先备份原文件。
// 没有清单时无从判断是否手改，内容不同就备份后覆盖（单独汇总，不报「手动修改过」）
export function installTemplate(dst, content, recorded, hasManifest, ctx, label) {
  if (!fs.existsSync(dst)) { writeFile(dst, content); return; }
  const cur = fileHash(dst);
  if (cur === sha256(content)) return;
  if (!hasManifest) { backup(ctx.root, dst); report.unlisted.push(label); }
  else if (cur !== recorded) { backup(ctx.root, dst); report.overwritten.push(label); }
  writeFile(dst, content);
}

// entry 为 null 表示整个 skill 已从模板中移除
export function pruneSkill(base, skill, prevSkill, entry, root) {
  if (!prevSkill) return;
  const dir = path.join(base, skill);
  if (lstat(dir)?.isSymbolicLink()) return;
  const stop = entry ? dir : base;
  for (const [rel, h] of Object.entries(prevSkill.files ?? {})) {
    if (entry && rel in entry.files) continue;
    pruneFile(path.join(dir, rel), h, stop, `${toPosix(path.relative(root, dir))}/${rel}`, root);
  }
}

// ctx: { root, yes, envs, mode, skills }；skills 为本次要装的 skill（--skills 子集加依赖，缺省为全部）
export async function installSkills(base, db, ctx) {
  const selected = ctx.skills ?? SKILLS;
  const prev = readManifest(base);
  const unlistedBefore = report.unlisted.length;
  const manifest = { installer: PKG.name, version: PKG.version, installedAt: new Date().toISOString(), envs: ctx.envs, mode: ctx.mode, skills: {}, templates: prev?.templates ?? {} };
  for (const skill of selected) {
    const srcDir = path.join(TPL_DIR, skill);
    const dstDir = path.join(base, skill);
    const prevSkill = prev?.skills?.[skill];
    const entry = { files: {}, userFiles: {} };
    const notes = [];
    // skill 自己的文件 + skill.json 中 shared 声明的共享文件（源在仓库 shared/，装到 references/ 下）
    const sources = walk(srcDir).map((rel) => ({ rel, src: path.join(srcDir, rel) }));
    for (const name of SKILL_LIST.find((x) => x.name === skill)?.shared ?? []) {
      sources.push({ rel: path.join('references', name), src: path.join(TPL_DIR, 'shared', name) });
    }
    for (const { rel, src } of sources) {
      const outRel = rel.endsWith('.tpl') ? rel.slice(0, -4) : rel;
      const key = `${skill}/${toPosix(outRel)}`;
      const dst = path.join(dstDir, outRel);
      if (!(key in USER_FILES)) {
        const content = fs.readFileSync(src);
        const relPosix = toPosix(outRel);
        entry.files[relPosix] = sha256(content);
        const label = `${toPosix(path.relative(ctx.root, dstDir))}/${relPosix}`;
        installTemplate(dst, content, prevSkill?.files?.[relPosix], !!prev, ctx, label);
        continue;
      }

      if (key === 'database-query/references/schema.md') {
        if (fs.existsSync(dst)) notes.push('schema.md 已存在，保留不覆盖');
        else if (db) writeFile(dst, render(fs.readFileSync(src, 'utf8'), db.conn));
      } else if (key === 'workflow/profile.json') {
        if (fs.existsSync(dst)) notes.push('profile.json 已存在，保留不覆盖');
        else { writeFile(dst, fs.readFileSync(src)); notes.push('profile.json 首次使用时由 agent 推断并经你确认后填写'); }
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
  for (const [skill, prevSkill] of Object.entries(prev?.skills ?? {})) {
    if (selected.includes(skill)) continue;
    // 之前装过、这次没选中的 skill：原样保留（卸载请用 uninstall），清单记录沿用
    if (SKILLS.includes(skill)) manifest.skills[skill] = prevSkill;
    // 清单里有、本版本已不再提供的 skill：按同样规则清理
    else pruneSkill(base, skill, prevSkill, null, ctx.root);
  }
  if (report.unlisted.length > unlistedBefore) report.unlistedDirs.push(toPosix(path.relative(ctx.root, base)));
  writeFile(path.join(base, MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
}


// ---------------------------------------------------------------- 3b. 软链接到单一来源
// 用户配置是否仍是「未填写」：与模板逐字节相同，或 JSON 里每个值都为空 / false / 与模板默认值相同。
export function isBlankJson(v, tpl) {
  if (v === null || v === undefined || v === '' || v === false) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.entries(v).every(([k, x]) => isBlankJson(x, tpl && typeof tpl === 'object' ? tpl[k] : undefined));
  return tpl !== undefined && v === tpl;
}
export function isBlank(file, tplRel) {
  if (!fs.existsSync(file)) return true;
  const tpl = tplRel ? path.join(TPL_DIR, tplRel) : null;
  if (tpl && sameFile(file, tpl)) return true;
  if (!file.endsWith('.json')) return fs.readFileSync(file, 'utf8').trim() === '';
  const v = readJson(file);
  if (v === null) return false; // 解析不了：当作用户写过的内容，避免误覆盖
  return isBlankJson(v, tpl ? readJson(tpl) : undefined);
}

// 独立拷贝（--copy 或建不了链接时装的）换成链接：拷贝里填过的用户配置先并入单一来源
export function migrateCopy(root, old, skill) {
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
  for (const [src, dst] of plan) writeFile(dst, fs.readFileSync(src));
  return true;
}


// 能否在 dir 里创建目录软链接。先探测再动旧目录：建不了链接时旧拷贝原样保留、只更新模板。
// 环境变量 WORKFLOW_RUN_NO_SYMLINK=1 可强制走独立拷贝（测试与无法建链接的环境用）。
export function symlinkSupported(dir) {
  if (process.env.WORKFLOW_RUN_NO_SYMLINK === '1') return false;
  // 清掉之前异常退出留下的探测链接
  for (const f of fs.readdirSync(dir)) if (f.startsWith('.workflow-run-probe-') && lstat(path.join(dir, f))?.isSymbolicLink()) removeLink(path.join(dir, f));
  const probe = path.join(dir, `.workflow-run-probe-${process.pid}`);
  try {
    fs.symlinkSync('.', probe, 'dir');
  } catch (e) {
    if (e.code === 'EPERM' || e.code === 'EACCES' || e.code === 'ENOTSUP') return false;
    throw e;
  }
  removeLink(probe);
  return true;
}

// 返回 false 表示不能建软链接（调用方退回独立拷贝）
export function linkSkills(root, envName, rel, skills = SKILLS) {
  const dir = path.join(root, rel);
  fs.mkdirSync(dir, { recursive: true });
  if (!symlinkSupported(dir)) {
    warn(`${envName}：无法创建软链接（Windows 需开启开发者模式或以管理员运行，或设置了 WORKFLOW_RUN_NO_SYMLINK=1），改为独立拷贝到 ${dir}`);
    return false;
  }
  let skipped = 0;
  for (const skill of skills) {
    const link = path.join(dir, skill);
    const target = path.join('..', '..', CANON_DIR, skill);
    const st = lstat(link);
    if (st?.isSymbolicLink()) {
      if (path.normalize(fs.readlinkSync(link)) === path.normalize(target)) continue;
      removeLink(link);
    } else if (st?.isDirectory()) {
      if (!migrateCopy(root, link, skill)) { skipped++; continue; }
      const bak = path.join(root, TMP_DIR, 'backup', timestamp(), envName);
      fs.mkdirSync(bak, { recursive: true });
      fs.renameSync(link, path.join(bak, skill));
      ok(`${toPosix(rel)}/${skill} 的独立拷贝已并入单一来源，原目录备份到 ${toPosix(path.relative(root, bak))}/${skill}`);
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

// ---------------------------------------------------------------- 4. .gitignore 保护
// workflow-run/ 是独立文档仓库时整个忽略（它自己提交）；否则只忽略其中的临时文件。
// DocNexus 的依赖与检索库由它自带的 docnexus/.gitignore 忽略，随工作区走，两种模式都不用这里加规则
export function updateGitignore(root, withCodeGraph = false) {
  const gi = path.join(root, '.gitignore');
  const rules = ['**/database-query/config.json', '**/wiki-config.json', '**/workflow/profile.local.json', homeIsRepo(root) ? `/${HOME}/` : `/${TMP_DIR}/`];
  if (withCodeGraph) rules.push('.codegraph/'); // 本地索引（SQLite），各人各建
  const existing = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8').split(/\r?\n/).map((l) => l.trim()) : [];
  const missing = rules.filter((r) => !existing.includes(r));
  if (!missing.length) { ok('.gitignore 已包含全部规则'); return; }
  fs.appendFileSync(gi, `\n# Agent skills generated rules (credentials + tmp artifacts; do not commit)\n${missing.join('\n')}\n`);
  ok(`.gitignore 已追加：${missing.join(' ')}`);
}

// workflow-run/：.ignore 加上需求目录（不参与代码搜索）；是独立文档仓库时还没配项目名就提示
// 本机系统与终端写进各安装目录的 workflow/profile.local.json（个人设置，已在 .gitignore 里），skill 从 resolve.mjs 的 env 读，
// 不用每次对话再探测。每次安装 / 升级都重新检测（换了终端、拷到别的机器后重跑即可）
export function recordEnv(root) {
  const env = detectEnv();
  const files = [];
  for (const base of INSTALL_BASES) {
    const dir = path.join(root, base, 'workflow');
    if (lstat(path.join(root, base, 'workflow'))?.isSymbolicLink() || !fs.existsSync(path.join(dir, 'SKILL.md'))) continue;
    const f = path.join(dir, 'profile.local.json');
    const cur = readJson(f) ?? {};
    if (cur.env?.os !== env.os || cur.env?.shell !== env.shell) writeFile(f, JSON.stringify({ ...cur, env }, null, 2) + '\n');
    files.push(toPosix(path.relative(root, f)));
  }
  if (files.length) ok(`本机环境：${env.os} / ${env.shell}（写入 ${files.join('、')}，不提交；skill 写命令按它来）`);
  return env;
}

// workflow-run/ 是独立文档仓库时，tmp/（本机临时文件）不能进文档仓库：写进它的 .git/info/exclude（只在本机生效，不改仓库内容）
export function excludeHomeTmp(root) {
  if (!homeIsRepo(root)) return false;
  const f = path.join(root, HOME, '.git', 'info', 'exclude');
  const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  if (cur.split(/\r?\n/).some((l) => l.trim() === '/tmp/')) return false;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}# workflow-run：本机临时文件\n/tmp/\n`);
  ok(`${HOME}/tmp/ 已加入文档仓库的 .git/info/exclude（不会提交到文档仓库）`);
  return true;
}

export function setupHome(root) {
  if (ensureIgnore(root)) ok(`.ignore 已加上 ${IGNORE_LINE}（需求产物不参与代码搜索）`);
  excludeHomeTmp(root);
  const L = layout(root);
  if (L.mode === 'repo' && !L.ok) warn(`${HOME}/ 是独立的文档仓库，还没配置本项目的项目名：${L.hint}`);
  reportMigration(migrateLayout(root));
}

// 旧结构（<需求>/ 下直接放文件）迁到 <需求>/<项目名>/ 的结果
export function reportMigration(r) {
  if (r.moved.length) {
    const reqs = [...new Set(r.moved.map((m) => path.posix.dirname(m.from)))];
    ok(`需求产物已迁到新结构 <需求>/${r.project}/（${reqs.length} 个需求、${r.moved.length} 个文件，被 git 跟踪的用 git mv）：${reqs.join('、')}`);
    ok(`项目名 ${r.project} 记在 workflow/profile.json；迁移的改动（含 profile.json）需要你提交`);
  }
  for (const s of r.skipped) warn(`${s.dir} 没有迁移：${s.reason}。处理后重跑 npx @rowansenne/workflow-run upgrade`);
}
