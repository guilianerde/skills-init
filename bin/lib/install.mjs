// 安装：模板文件写入（带清单与手改保护）、单一来源软链接与旧拷贝迁移、改名清理、.gitignore

import fs from 'node:fs';
import path from 'node:path';
import { TPL_DIR, PKG, CANON_DIR, SKILLS, USER_FILES, RENAMED, MANIFEST, ok, warn, readJson, walk, toPosix, sameFile, writeFile, render, sha256, fileHash, readManifest, removeEmptyDirs, lstat, timestamp } from './core.mjs';
import { ask } from './prompt.mjs';
import { writeDbConfig } from './db.mjs';

// 结尾汇总：另存为 .new 的 / 保留用户版本的 / 模板已删除但用户改过而保留的文件
export const report = { asNew: [], kept: [], stale: [] };
// 清单里有、新模板里已没有的文件：未被修改时删除，改过的保留并汇总提示
export function pruneFile(file, recorded, stop, label) {
  if (!lstat(file)?.isFile()) return;
  if (fileHash(file) !== recorded) { report.stale.push(label); return; }
  fs.rmSync(file);
  removeEmptyDirs(path.dirname(file), stop);
  ok(`已清理模板中已删除的文件 ${label}`);
}

// 模板文件：不存在或未被手改过（与清单记录的哈希一致）时直接写入；手改过的按交互选择 / --yes 另存 .new。
// 没有清单（首次安装或旧版本装的）时无从判断，照旧覆盖。返回本次生成的 .new 文件名（没有则为 null）。
export async function installTemplate(dst, content, recorded, hasManifest, ctx, label) {
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
export function pruneSkill(base, skill, prevSkill, entry, root) {
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
export async function installSkills(base, db, ctx) {
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


// ---------------------------------------------------------------- 3b. 软链接到单一来源
// 用户配置是否仍是「未填写」：与模板逐字节相同，或 JSON 里每个值都为空 / false / 与模板默认值相同。
// 按内容判断而不是只比对字节，因为旧版本的模板（如 dev/profile.json）和新模板字段不同。
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
  // 旧版本画像在 dev/profile.json，迁到 workflow/profile.json
  if (skill === 'dev' && !consider(path.join(old, 'profile.json'), 'workflow/profile.json', 'workflow/profile.json.tpl')) return false;
  for (const [src, dst] of plan) writeFile(dst, fs.readFileSync(src));
  return true;
}


// 能否在 dir 里创建目录软链接。先探测再动旧目录：建不了链接时旧拷贝原样保留、只更新模板。
// 环境变量 SKILLS_INIT_NO_SYMLINK=1 可强制走独立拷贝（测试与无法建链接的环境用）。
export function symlinkSupported(dir) {
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
export function linkSkills(root, envName, rel) {
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
export function removeRenamed(root) {
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
export function updateGitignore(root, withDocNexus) {
  const gi = path.join(root, '.gitignore');
  const rules = ['**/database-query/config.json', '**/wiki-config.json', '/tmp/'];
  if (withDocNexus) rules.push('node_modules/');
  const existing = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8').split(/\r?\n/).map((l) => l.trim()) : [];
  const missing = rules.filter((r) => !existing.includes(r));
  if (!missing.length) { ok('.gitignore 已包含全部规则'); return; }
  fs.appendFileSync(gi, `\n# Agent skills generated rules (credentials + tmp artifacts; do not commit)\n${missing.join('\n')}\n`);
  ok(`.gitignore 已追加：${missing.join(' ')}`);
}
