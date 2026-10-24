#!/usr/bin/env node
// 按分支汇总各 skill 的产物：方案、交付说明、审查报告、技术方案、上线方案，以及它们的 wiki 发布记录。
// 产物按需求归档在 workflow-run/docs/requirements/<需求>/<项目>/（两种模式结构相同，见 requirement.mjs）。
// 直接扫描 Markdown，从元信息行读分支（「分支：」「对比分支：」），
// 从第一行的 <!-- md-to-wiki: ... --> 读发布记录（md-to-wiki 上传后写入）。只读。
//
// 用法（在项目根执行；--root 可指定项目根）：
//   node .agents/skills/workflow/scripts/artifacts.mjs [--branch <分支>]   # 缺省为当前 git 分支
//   node .agents/skills/workflow/scripts/artifacts.mjs --all                # 所有分支
// 输出 JSON。退出码：0 正常；1 参数错误或无法确定分支

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runState } from '../lib/runs.mjs';
import { KINDS } from '../lib/artifact-model.mjs';
import { loadWorkspace, projectArtifacts, artifactEntry, readGitArtifacts } from '../lib/workspace-read.mjs';
export { KINDS, parseBranch, parseWiki } from '../lib/artifact-model.mjs';
export { localBranches } from '../lib/workspace-read.mjs';

export function collect(root, { allProjects = false, workspace = null } = {}) {
  const data = workspace ?? loadWorkspace(root, { allProjects });
  return projectArtifacts(data, allProjects).filter((a) => a.source === 'worktree').map(artifactEntry);
}

export function collectGit(root, ref) {
  return readGitArtifacts(root, ref).map(artifactEntry);
}

// 下一步建议：按链路顺序找第一个缺的环节，再看哪些文档还没发布到 wiki
export function nextSteps(latest) {
  const steps = [];
  if (!latest.review) steps.push('project-review：合并前审查本分支');
  if (!latest.tech) steps.push('create-tech-md-doc：生成技术方案（M / L 规模需求）');
  if (!latest.release) steps.push(`create-release-md-doc：生成上线方案${latest.tech ? `（自动引用 ${latest.tech.path}）` : ''}`);
  for (const k of ['tech', 'release']) {
    const a = latest[k];
    if (a && !a.wiki) steps.push(`md-to-wiki：发布 ${a.path}（尚无发布记录）`);
    else if (a && a.wiki && a.wiki.at && a.mtime > Date.parse(a.wiki.at) + 1000) steps.push(`md-to-wiki：${a.path} 在上次发布后改过，可重新发布到 pageId ${a.wiki.pageId}`);
  }
  // 有交付说明或审查报告就能汇总出 PR / MR 描述
  if (latest.delivery || latest.review) steps.push('提 PR / MR：运行 workflow/scripts/pr-desc.mjs 按本分支产物生成描述（创建 PR 需用户同意）');
  return steps;
}

export function branchView(root, branch, workspace = loadWorkspace(root)) {
  const items = collect(root, { workspace }).filter((a) => a.branch === branch);
  const latest = {};
  for (const a of items) latest[a.kind] = a; // 已按时间升序，最后一个即最新
  const strip = ({ mtime, ...a }) => a;
  const execution = runState(root, branch, workspace);
  return {
    branch,
    artifacts: items.map(strip),
    latest: Object.fromEntries(KINDS.map((k) => [k.kind, latest[k.kind] ? strip(latest[k.kind]) : null])),
    execution,
    next: execution.current && execution.current.status !== 'completed' ? [execution.next] : nextSteps(latest),
  };
}

function currentBranch(root) {
  // symbolic-ref 在还没有提交的新分支上也能取到名字；detached HEAD 时失败
  const r = spawnSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

function main(argv) {
  let root = process.cwd();
  let branch = null;
  let all = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = path.resolve(argv[++i] ?? '.');
    else if (argv[i] === '--branch') branch = argv[++i] ?? null;
    else if (argv[i] === '--all') all = true;
    else { console.error('用法: artifacts.mjs [--root <项目根>] [--branch <分支> | --all]'); return 1; }
  }
  const workspace = loadWorkspace(root);
  if (all) {
    const branches = [...new Set([...workspace.artifacts.map((a) => a.branch), ...workspace.runs.map((r) => r.branch)].filter(Boolean))].sort();
    const unknown = collect(root, { workspace }).filter((a) => !a.branch).map((a) => a.path);
    console.log(JSON.stringify({ branches: branches.map((b) => branchView(root, b, workspace)), without_branch: unknown }, null, 2));
    return 0;
  }
  branch ??= currentBranch(root);
  if (!branch) { console.error('无法确定当前分支（不在 git 仓库或处于 detached HEAD），请用 --branch 指定'); return 1; }
  console.log(JSON.stringify(branchView(root, branch, workspace), null, 2));
  return 0;
}

const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exit(main(process.argv.slice(2)));
