#!/usr/bin/env node
// 完整流程的运行记录统一保存在需求 meta.json；读取不创建文件，快速通道不调用写命令。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createWorkflow } from '../core/index.mjs';
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
    const workflow = createWorkflow({ root });
    let out;
    if (action === 'show') {
      out = workflow.runs.status({ branch, id: opts.id ?? null });
    } else if (action === 'snapshot') out = workflow.snapshots.capture({ branch, id: opts.id });
    else if (action === 'start') out = workflow.runs.start({ branch, kind: opts.kind, size: opts.size, input, dir: opts.dir });
    else {
      const expectedRevision = opts['expect-revision'] === undefined ? null : Number(opts['expect-revision']);
      if (action === 'save') out = workflow.runs.save({ branch, id: opts.id, expectedRevision, input });
      else if (action === 'complete') out = workflow.runs.complete({ branch, id: opts.id, expectedRevision, input });
      else if (action === 'cancel') out = workflow.runs.cancel({ branch, id: opts.id, expectedRevision, reason: input.reason });
      else throw new Error(`未知动作：${action}`);
    }
    console.log(JSON.stringify(out, null, 2)); return 0;
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      ...(error.code ? { code: error.code } : {}),
      message: error.message,
      ...(error.details && Object.keys(error.details).length ? { details: error.details } : {}),
    }, null, 2));
    return 1;
  }
}
const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exit(main(process.argv.slice(2)));
