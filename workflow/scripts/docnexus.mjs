#!/usr/bin/env node
// 在 workflow-run/ 下运行 DocNexus（它的项目根），不用先 cd、不用拼 &&，bash / zsh / PowerShell / cmd 里写法一样。
// docnexus 系列 skill 里的 `./docnexus/node_modules/.bin/docnexus <参数>` 换成 `node <skills>/workflow/scripts/docnexus.mjs <参数>`，
// `node docnexus/skills/<...>.mjs <参数>` 换成 `node <skills>/workflow/scripts/docnexus.mjs --node docnexus/skills/<...>.mjs <参数>`。
// 参数里的路径（草稿、docnexus/library/<path>）照旧相对 workflow-run/。输出与退出码原样透传。
//
// 用法（在项目根执行；--root 可指定项目根，须放在最前面）：
//   node .agents/skills/workflow/scripts/docnexus.mjs recall "订单幂等" --limit 5
//   node .agents/skills/workflow/scripts/docnexus.mjs --node docnexus/skills/docnexus-library/scripts/query-documents.mjs --category dev-notes
// 退出码：DocNexus 的退出码；DocNexus 没装时为 1

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { docnexusRoot, docnexusBin } from './resolve.mjs';

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// CLI 的入口 JS：直接用 node 跑，Windows 上不经过 .cmd 和 shell，参数不会被转义坏
// 包名取 workflow-run/docnexus/package.json 的依赖（安装器用 npm install --prefix 装的）
export function cliEntry(root) {
  const dn = path.join(docnexusRoot(root), 'docnexus');
  const name = Object.keys(readJson(path.join(dn, 'package.json'))?.dependencies ?? {}).find((n) => /(^|\/)docnexus$/.test(n));
  if (!name) return null;
  const pkgDir = path.join(dn, 'node_modules', ...name.split('/'));
  const bin = readJson(path.join(pkgDir, 'package.json'))?.bin;
  const rel = typeof bin === 'string' ? bin : bin?.docnexus;
  return rel && fs.existsSync(path.join(pkgDir, rel)) ? path.join(pkgDir, rel) : null;
}

export function run(root, args, opts = {}) {
  const cwd = docnexusRoot(root);
  const o = { cwd, stdio: 'inherit', ...opts };
  if (args[0] === '--node') {
    if (!args[1]) return { status: 1, error: '--node 后面要跟脚本路径（相对 workflow-run/）' };
    return spawnSync(process.execPath, [path.resolve(cwd, args[1]), ...args.slice(2)], o);
  }
  const entry = cliEntry(root);
  if (entry) return spawnSync(process.execPath, [entry, ...args], o);
  const bin = docnexusBin(root);
  if (!bin) return { status: 1, error: 'DocNexus 没装：重跑 npx @rowansenne/workflow-run 并加 --with-docnexus' };
  return spawnSync(path.resolve(root, bin), args, { ...o, shell: process.platform === 'win32' });
}

function main(argv) {
  let root = process.cwd();
  if (argv[0] === '--root') { root = path.resolve(argv[1] ?? '.'); argv = argv.slice(2); }
  const r = run(root, argv);
  if (r.error) console.error(typeof r.error === 'string' ? r.error : r.error.message);
  return r.status ?? 1;
}

const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exit(main(process.argv.slice(2)));
