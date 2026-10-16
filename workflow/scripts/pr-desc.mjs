#!/usr/bin/env node
// 生成 PR / MR 描述：把本分支已落盘的交付说明、审查报告、技术方案、上线方案汇总成审查人要看的内容，
// 让产物进入团队真正看的地方。没有交付说明时（S 规模快速通道、或没走 dev）退回用 git 提交记录与改动文件列表。
// 只读：只输出文本（--out 时写到指定文件），不创建 PR、不推送。
//
// 用法（在项目根执行；--root 可指定项目根）：
//   node .agents/skills/workflow/scripts/pr-desc.mjs [--branch <分支>] [--base <基线>] [--out <文件>]
// 分支缺省为当前 git 分支；基线缺省为 workflow/profile.json 的 main_branch，再缺省为 main。
// 退出码：0 正常；1 参数错误或无法确定分支

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { branchView } from './artifacts.mjs';
import { readProfile } from './resolve.mjs';
import { sections, section, tableRows, isEmpty } from './doc-sections.mjs';

const git = (root, args) => { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; };
const keep = (body) => (body && !isEmpty(body) ? body : null);
const LEVEL_RE = /CRITICAL|HIGH/i;

export function buildDescription(root, branch, base) {
  const view = branchView(root, branch);
  const read = (a) => (a ? fs.readFileSync(path.join(root, a.path), 'utf8') : null);
  const { delivery, review, plan, tech, release } = view.latest;
  const L = [];
  const add = (title, body) => { if (body) L.push(`## ${title}`, '', body, ''); };

  if (delivery) {
    const s = sections(read(delivery));
    add('做了什么', keep(section(s, '结果')));
    add('已确认的决定', keep(section(s, '已确认的决定')));
    add('改动', keep(section(s, '改动')));
    add('根因', keep(section(s, '根因')));
    add('验证', keep(section(s, '验证')));
    const cfg = section(s, '配置清单');
    const sql = keep(section(s, 'SQL'));
    const deploy = [tableRows(cfg).length ? cfg : null, sql ? `SQL 脚本（未执行）：\n\n${sql}` : null].filter(Boolean).join('\n\n');
    add('上线注意（配置 / SQL）', deploy || null);
  } else {
    const log = git(root, ['log', '--no-merges', '--format=- %s', `${base}..${branch}`]);
    const stat = git(root, ['diff', '--stat', `${base}...${branch}`]);
    add('提交', log || null);
    add('改动文件', stat ? `\`\`\`\n${stat}\n\`\`\`` : null);
    L.push('> 本分支没有落盘的交付说明（S 规模快速通道或未走 dev），以上按 git 记录生成；验证结果请作者补充。', '');
  }

  if (review) {
    const s = sections(read(review));
    const open = tableRows(section(s, '严重问题')).filter((c) => LEVEL_RE.test(c[1] ?? ''));
    const summary = keep(section(s, '结论摘要'));
    const lines = [summary, open.length ? `报告中的 CRITICAL / HIGH（${open.length} 条）：\n\n${open.map((c) => `- ${c[1]} ${c[2]}：${c[3]}`).join('\n')}` : '没有 CRITICAL / HIGH。', `完整报告：\`${review.path}\``].filter(Boolean);
    add('代码审查', lines.join('\n\n'));
    add('影响面', keep(section(s, '影响面')));
  }

  const docs = [['开发方案', plan], ['交付说明', delivery], ['审查报告', review], ['技术方案', tech], ['上线方案', release]]
    .filter(([, a]) => a).map(([label, a]) => `- ${label}：\`${a.path}\`${a.wiki?.url ? `（wiki：${a.wiki.url}）` : a.wiki ? `（wiki pageId ${a.wiki.pageId}）` : ''}`);
  add('相关文档', docs.length ? docs.join('\n') : null);
  return { branch, base, sources: Object.fromEntries(Object.entries(view.latest).map(([k, a]) => [k, a?.path ?? null])), markdown: L.join('\n').trim() + '\n' };
}

function main(argv) {
  let root = process.cwd(); let branch = null; let base = null; let out = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = path.resolve(argv[++i] ?? '.');
    else if (argv[i] === '--branch') branch = argv[++i] ?? null;
    else if (argv[i] === '--base') base = argv[++i] ?? null;
    else if (argv[i] === '--out') out = argv[++i] ?? null;
    else { console.error('用法: pr-desc.mjs [--root <项目根>] [--branch <分支>] [--base <基线>] [--out <文件>]'); return 1; }
  }
  branch ??= git(root, ['symbolic-ref', '--short', 'HEAD']);
  if (!branch) { console.error('无法确定当前分支（不在 git 仓库或处于 detached HEAD），请用 --branch 指定'); return 1; }
  base ??= readProfile(root).profile.main_branch || 'main';
  const r = buildDescription(root, branch, base);
  if (out) { fs.mkdirSync(path.dirname(path.resolve(root, out)), { recursive: true }); fs.writeFileSync(path.resolve(root, out), r.markdown); console.error(`已写入 ${out}`); }
  else process.stdout.write(r.markdown);
  return 0;
}

const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exit(main(process.argv.slice(2)));
