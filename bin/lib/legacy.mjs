// 旧包 @rowansenne/skills-init 留下的东西：不迁移，只检测并给出要执行的命令。
// 有旧数据目录或旧安装清单时停下（否则会另建一个 workflow-run/，产物分成两处；升级也找不到清单）

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { HOME, MANIFEST, INSTALL_BASES, toPosix } from './core.mjs';

export const OLD_HOME = 'skills-init';
export const OLD_MANIFEST = '.skills-init.json';
const OLD_MARK = '<!-- skills-init:docnexus:start -->';

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

// 返回 { block: 必须先处理的步骤, notes: 建议顺手处理的 }；都为空表示没有旧版痕迹
export function findLegacy(root) {
  const block = [];
  const notes = [];
  if (isDir(path.join(root, OLD_HOME))) {
    if (fs.existsSync(path.join(root, HOME))) {
      block.push(`${OLD_HOME}/ 和 ${HOME}/ 同时存在：把 ${OLD_HOME}/ 里的产物、docnexus/、templates/ 手动并进 ${HOME}/ 后删掉 ${OLD_HOME}/`);
    } else {
      const tracked = spawnSync('git', ['ls-files', '--', OLD_HOME], { cwd: root, encoding: 'utf8' }).stdout?.trim();
      block.push(`数据目录改名（产物、DocNexus、项目模板都在里面）：${tracked ? 'git mv' : 'mv'} ${OLD_HOME} ${HOME}`);
    }
  }
  for (const rel of INSTALL_BASES) {
    const old = path.join(root, rel, OLD_MANIFEST);
    if (!fs.existsSync(old) || fs.existsSync(path.join(root, rel, MANIFEST))) continue;
    block.push(`安装清单改名：mv ${toPosix(path.join(rel, OLD_MANIFEST))} ${toPosix(path.join(rel, MANIFEST))}`);
  }
  for (const f of ['CLAUDE.md', 'AGENTS.md']) {
    if (read(path.join(root, f)).includes(OLD_MARK)) notes.push(`${f}：删掉 <!-- skills-init:docnexus:start --> 到 <!-- skills-init:docnexus:end --> 之间的旧段落（upgrade 会写新的）`);
  }
  for (const f of ['.gitignore', '.ignore']) {
    if (read(path.join(root, f)).split(/\r?\n/).some((l) => l.includes(`${OLD_HOME}/`))) notes.push(`${f}：含 ${OLD_HOME}/ 的旧规则可以删掉（upgrade 会补上 ${HOME}/ 的规则）`);
  }
  return { block, notes };
}

export function legacyMessage({ block, notes }) {
  const lines = [`本项目是旧包 @rowansenne/skills-init 装的（现在叫 @rowansenne/workflow-run，项目里的目录也从 ${OLD_HOME}/ 改成 ${HOME}/），不会自动迁移。在项目根依次执行：`];
  block.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
  for (const s of notes) lines.push(`  - ${s}`);
  lines.push('然后重新运行 npx @rowansenne/workflow-run upgrade（mv 在 PowerShell 里同样可用）');
  return lines.join('\n');
}
