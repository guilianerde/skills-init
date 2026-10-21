// 卸载：按安装清单移除文件与软链接，用户配置与手改文件先备份

import fs from 'node:fs';
import path from 'node:path';
import { IS_WIN, CANON_DIR, INSTALL_BASES, MANIFEST, step, ok, warn, toPosix, fileHash, readManifest, removeEmptyDirs, lstat, timestamp, removeLink, docnexusInternal } from './core.mjs';
import { removeDocNexusContext } from './docnexus.mjs';

// 软链接是否指向 absTarget（按解析后的绝对路径比较，兼容 Windows 上 readlink 返回的 \\?\ 前缀）
export function linkPointsTo(link, absTarget) {
  let t;
  try { t = fs.readlinkSync(link); } catch { return false; }
  t = t.replace(/^\\\\\?\\/, '');
  const norm = (p) => (IS_WIN ? path.resolve(p).toLowerCase() : path.resolve(p));
  return norm(path.resolve(path.dirname(link), t)) === norm(absTarget);
}
// 删除目录软链接本身（Windows 上目录链接需 rmdir）
export function rmdirIfEmpty(dir) { try { fs.rmdirSync(dir); return true; } catch { return false; } }

export function uninstall(root) {
  const bases = INSTALL_BASES;
  const found = bases.map((rel) => [rel, readManifest(path.join(root, rel))]).filter(([, m]) => m);
  if (!found.length) { warn(`未找到安装清单（${bases.map((b) => toPosix(path.join(b, MANIFEST))).join(' / ')}），没有可卸载的内容`); return 0; }
  const backupRoot = path.join(root, 'workflow-run', 'tmp', 'uninstall-backup', timestamp());
  const backedUp = [];
  const leftovers = [];

  // 1. .claude / .qwen / .codebuddy 下指向单一来源、且在清单里的 skill 链接；用户自己的链接和目录不动
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

  // 1b. 移除指向 .docnexus/skills 的入口及上下文；运行环境和知识输出保留。
  {
    const src = path.join(docnexusInternal(root), 'skills');
    let n = 0;
    for (const rel of bases) {
      const dir = path.join(root, rel);
      for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
        const link = path.join(dir, name);
        if (lstat(link)?.isSymbolicLink() && linkPointsTo(link, path.join(src, name))) { removeLink(link); n++; }
      }
    }
    const files = removeDocNexusContext(root);
    if (n || files.length) ok(`已移除指向 ${toPosix(path.relative(root, src))} 的 ${n} 个 DocNexus skill 链接${files.length ? `，以及 ${files.join('、')} 里的 DocNexus 段落` : ''}（.docnexus/ 运行环境与 workflow-run/docnexus/ 知识输出保留）`);
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
      for (const f of files) removeEmptyDirs(path.dirname(path.join(dir, f)), base);
      if (fs.existsSync(dir)) leftovers.push(toPosix(path.join(rel, skill)));
      else ok(`已移除 ${toPosix(path.join(rel, skill))}`);
    }
    fs.rmSync(path.join(base, MANIFEST), { force: true });
  }

  // 3. 清空后的环境目录一并移除（.claude / .qwen / .codebuddy 里还有别的东西时保留）
  for (const rel of bases) if (rmdirIfEmpty(path.join(root, rel))) rmdirIfEmpty(path.dirname(path.join(root, rel)));

  step('卸载完成');
  if (backedUp.length) {
    ok(`用户配置与手改过的文件已备份到 ${toPosix(path.relative(root, backupRoot))}/：`);
    for (const f of backedUp) console.log(`      ${f}`);
  }
  for (const d of leftovers) warn(`${d} 中有不在清单里的文件，已保留该目录`);
  console.log('.gitignore 中追加的规则未移除，如不再需要可手动删除。.docnexus/ 运行环境及 workflow-run/（需求产物、DocNexus 知识、项目模板）没有删除。');
  return 0;
}
