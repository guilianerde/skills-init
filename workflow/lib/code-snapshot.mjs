// 证据绑定到 Git 基线、HEAD 及工作区内容；不输出文件正文，也不把工作流自己的产出算作代码变化。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { matchGlob } from './path-match.mjs';

export const hash = (value) => createHash('sha256').update(value).digest('hex');
const INTERNAL = ['workflow-run/**', '.docnexus/**', '.codegraph/**', '.agents/skills/**', '.claude/skills/**', '.qwen/skills/**', '.codebuddy/skills/**'];
const git = (root, args, encoding = 'utf8') => {
  const r = spawnSync('git', args, { cwd: root, encoding, maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`代码快照失败：git ${args[0]}：${r.stderr?.toString().trim() || r.error?.message}`);
  return r.stdout;
};

export function assertWorkingBranch(root, run) {
  const top = git(root, ['rev-parse', '--show-toplevel']).trim();
  if (fs.realpathSync.native(top) !== fs.realpathSync.native(root)) throw new Error('请在业务 Git 项目根生成证据');
  const branch = git(root, ['symbolic-ref', '--short', 'HEAD']).trim();
  if (branch !== run.branch) throw new Error('代码快照必须在运行所属的实际工作分支生成，请先切换分支');
  return branch;
}

export function codeSnapshot(root, run) {
  const branch = assertWorkingBranch(root, run);
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  const base = run.scope?.base || 'main';
  const baseCommit = git(root, ['rev-parse', '--verify', `${base}^{commit}`]).trim();
  const mergeBase = git(root, ['merge-base', baseCommit, head]).trim();
  const exclude = [...INTERNAL, ...(run.scope?.exclude ?? [])];
  const names = new Set([
    ...git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0'),
    ...git(root, ['ls-tree', '-r', '--name-only', '-z', mergeBase]).split('\0'),
  ].filter((p) => p && !exclude.some((g) => matchGlob(p, g))));
  const entries = [...names].sort().map((file) => {
    const abs = path.join(root, file);
    let stat;
    try { stat = fs.lstatSync(abs); } catch (e) { if (e.code === 'ENOENT') return [file, 'deleted']; throw e; }
    if (stat.isSymbolicLink()) return [file, 'symlink', fs.readlinkSync(abs)];
    // dirty 标记不能代表具体内容；脏子模块须先处理，不能复用含糊的证据。
    if (stat.isDirectory()) {
      if (git(abs, ['status', '--porcelain', '--untracked-files=all']).trim()) throw new Error(`子模块／嵌套仓库有未提交内容，先处理后生成快照：${file}`);
      return [file, 'submodule', git(abs, ['rev-parse', 'HEAD']).trim()];
    }
    return [file, stat.mode & 0o111 ? 'executable' : 'file', hash(fs.readFileSync(abs))];
  });
  const snapshot = { branch, base, base_commit: baseCommit, merge_base: mergeBase, head, scope: run.scope, files: entries.length };
  return { ...snapshot, digest: hash(JSON.stringify({ ...snapshot, entries })) };
}

export function assertSnapshot(root, run, snapshot) {
  const current = codeSnapshot(root, run);
  if (!snapshot?.digest || snapshot.digest !== current.digest) throw new Error('代码或基线已变化，原验证／审查证据已失效；重新生成快照、验证并审查');
  return current;
}
