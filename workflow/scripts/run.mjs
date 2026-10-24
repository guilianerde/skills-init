#!/usr/bin/env node
// 完整流程的运行记录统一保存在需求 meta.json；读取不创建文件，快速通道不调用写命令。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { STATUS_LABELS, runState, startRun, changeRun } from '../lib/runs.mjs';
export { FLOWS, STATUS_LABELS, allRuns, branchRuns, runState, startRun, changeRun } from '../lib/runs.mjs';
const branchOf = (root) => spawnSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout?.trim() || null;

function main(argv) {
  const opts = {}; const args = [...argv]; const action = args.shift();
  try {
    while (args.length) {
      const key = args.shift();
      if (!['--root', '--branch', '--dir', '--id', '--kind', '--size', '--input', '--expect-revision'].includes(key) || !args.length) throw new Error(`未知或缺少值的参数：${key}`);
      opts[key.slice(2)] = args.shift();
    }
    const root = path.resolve(opts.root ?? '.'); const branch = opts.branch ?? branchOf(root);
    if (!branch) throw new Error('无法确定当前分支，请用 --branch 指定');
    const input = opts.input ? JSON.parse(fs.readFileSync(opts.input === '-' ? 0 : path.resolve(root, opts.input), 'utf8')) : {};
    let out;
    if (action === 'show') {
      out = runState(root, branch);
      if (opts.id) {
        out.current = out.runs.find((r) => r.id === opts.id) ?? null;
        if (!out.current) throw new Error('当前分支没有这个运行');
        out.next = `${STATUS_LABELS[out.current.status]}：${out.current.stage}（${out.current.id}）`;
      }
    } else if (action === 'start') out = startRun(root, { branch, kind: opts.kind, size: opts.size, input, dir: opts.dir });
    else out = changeRun(root, { branch, id: opts.id, revision: opts['expect-revision'] === undefined ? null : Number(opts['expect-revision']), input, action });
    console.log(JSON.stringify(out, null, 2)); return 0;
  } catch (e) { console.error(e.message); return 1; }
}
const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exit(main(process.argv.slice(2)));
