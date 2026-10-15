#!/usr/bin/env node
// 按分支汇总各 skill 的产物：开发方案、交付说明、审查报告、技术方案、上线方案，以及它们的 wiki 发布记录。
// 不另存记录文件：直接扫描 docs/skills/<skill>/ 下的 Markdown，从元信息行读分支（「分支：」「对比分支：」），
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

// 产物种类 → 产出它的 skill 目录与文件名前缀；顺序即链路顺序
export const KINDS = [
  { kind: 'plan', skill: 'dev', prefix: 'plan-', label: '开发方案' },
  { kind: 'delivery', skill: 'dev', prefix: 'delivery-', label: '交付说明' },
  { kind: 'review', skill: 'project-review', prefix: 'review-', label: '审查报告' },
  { kind: 'tech', skill: 'create-tech-md-doc', prefix: 'tech-doc', label: '技术方案' },
  { kind: 'release', skill: 'create-release-md-doc', prefix: 'release-doc', label: '上线方案' },
];

const HEAD_LINES = 20;
const toPosix = (p) => p.split(path.sep).join('/');

// 元信息行里的分支：「对比分支：`dev` ←→ `main`」取 dev；「分支：feature/x」「分支：`feature/x`」
export function parseBranch(text) {
  const head = text.split(/\r?\n/).slice(0, HEAD_LINES).join('\n');
  const m = head.match(/(?:对比)?分支[：:]\s*`?([^`\s｜|←，,）)]+)`?/);
  return m && !/^[{<]/.test(m[1]) ? m[1] : null; // 未填写的模板占位符不算
}

export function parseWiki(text) {
  const m = /^<!-- md-to-wiki: ([^\n]*?) -->/.exec(text);
  if (!m) return null;
  const kv = Object.fromEntries([...m[1].matchAll(/(\w+)=(\S+)/g)].map((x) => [x[1], x[2]]));
  return kv.pageId ? { pageId: kv.pageId, version: kv.version ? Number(kv.version) : null, url: kv.url ?? null, at: kv.at ?? null } : null;
}

const fileDate = (name) => { const m = name.match(/(\d{4})(\d{2})(\d{2})(?:_v(\d+))?\.md$/); return m ? `${m[1]}-${m[2]}-${m[3]}${m[4] ? `#${m[4].padStart(3, '0')}` : ''}` : ''; };

export function collect(root) {
  const out = [];
  for (const k of KINDS) {
    const dir = path.join(root, 'docs', 'skills', k.skill);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.md') || !name.startsWith(k.prefix)) continue;
      const file = path.join(dir, name);
      const text = fs.readFileSync(file, 'utf8');
      out.push({
        kind: k.kind, label: k.label, path: toPosix(path.relative(root, file)), branch: parseBranch(text),
        date: fileDate(name), mtime: fs.statSync(file).mtimeMs, wiki: parseWiki(text),
      });
    }
  }
  // 同一天的多版（_v2、_v3）与无日期文件按修改时间排
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.mtime - b.mtime);
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
  return steps;
}

export function branchView(root, branch) {
  const items = collect(root).filter((a) => a.branch === branch);
  const latest = {};
  for (const a of items) latest[a.kind] = a; // 已按时间升序，最后一个即最新
  const strip = ({ mtime, ...a }) => a;
  return {
    branch,
    artifacts: items.map(strip),
    latest: Object.fromEntries(KINDS.map((k) => [k.kind, latest[k.kind] ? strip(latest[k.kind]) : null])),
    next: nextSteps(latest),
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
  if (all) {
    const branches = [...new Set(collect(root).map((a) => a.branch).filter(Boolean))].sort();
    const unknown = collect(root).filter((a) => !a.branch).map((a) => a.path);
    console.log(JSON.stringify({ branches: branches.map((b) => branchView(root, b)), without_branch: unknown }, null, 2));
    return 0;
  }
  branch ??= currentBranch(root);
  if (!branch) { console.error('无法确定当前分支（不在 git 仓库或处于 detached HEAD），请用 --branch 指定'); return 1; }
  console.log(JSON.stringify(branchView(root, branch), null, 2));
  return 0;
}

const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exit(main(process.argv.slice(2)));
