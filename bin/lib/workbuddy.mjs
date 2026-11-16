import fs from 'node:fs';
import path from 'node:path';
import { TPL_DIR, lstat, ok, sameFile, warn } from './core.mjs';

const commandPath = '.codebuddy/commands/dev.md';
const template = path.join(TPL_DIR, 'bin', 'workbuddy', 'dev.md');

function commandFile(root) {
  const projectDir = path.join(root, '.codebuddy');
  const commandsDir = path.join(projectDir, 'commands');
  for (const dir of [projectDir, commandsDir]) {
    const st = lstat(dir);
    if (st && !st.isDirectory()) return null;
  }
  return path.join(root, commandPath);
}

export function installWorkBuddyDevCommand(root) {
  const file = commandFile(root);
  if (!file) { warn(`无法安装 ${commandPath}，命令目录不是普通目录`); return; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.copyFileSync(template, file, fs.constants.COPYFILE_EXCL);
    ok(`已安装 WorkBuddy /dev 项目命令：${commandPath}`);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!lstat(file)?.isFile() || !sameFile(file, template)) warn(`保留已有的 WorkBuddy 项目命令：${commandPath}`);
  }
}

export function removeWorkBuddyDevCommand(root) {
  const file = commandFile(root);
  if (!file || !lstat(file)?.isFile() || !sameFile(file, template)) return;
  fs.unlinkSync(file);
  try { fs.rmdirSync(path.dirname(file)); } catch { /* 目录内可能有其他命令 */ }
  ok(`已移除 WorkBuddy /dev 项目命令：${commandPath}`);
}
