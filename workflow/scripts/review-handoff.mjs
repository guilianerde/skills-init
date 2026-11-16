#!/usr/bin/env node
// 只交接事实与证据，不交接实现者自审结论；生成过程不推进运行。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createWorkflow } from '../core/index.mjs';
import {
  createCodeHandoff,
  createDocumentHandoff,
  writeReviewPacket,
} from '../core/review-handoff.mjs';

export const handoff = createCodeHandoff;
export const documentHandoff = createDocumentHandoff;

export function main(argv) {
  try {
    const args = [...argv];
    const options = {};
    while (args.length) {
      const key = args.shift();
      if (!['--root', '--branch', '--id', '--depth', '--capabilities', '--kind', '--draft'].includes(key) || !args.length) {
        throw new Error(`未知或缺少值的参数：${key}`);
      }
      options[key.slice(2)] = args.shift();
    }
    const root = path.resolve(options.root ?? '.');
    const branch = options.branch ?? spawnSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout?.trim();
    if (!options.id) throw new Error('需要 --id <运行id>');
    const capabilities = options.capabilities
      ? JSON.parse(fs.readFileSync(path.resolve(root, options.capabilities), 'utf8'))
      : null;
    if (options.kind || options.draft) {
      if (!['requirement', 'plan'].includes(options.kind) || !options.draft || options.depth || options.capabilities) {
        throw new Error('文档审查使用 --kind requirement|plan --draft <草稿.md>');
      }
    }
    const text = options.draft ? fs.readFileSync(path.resolve(root, options.draft), 'utf8') : null;
    const workflow = createWorkflow({ root });
    const packet = workflow.reviews.prepare({
      branch,
      id: options.id,
      kind: options.kind ?? null,
      text,
      depth: options.depth ?? '标准',
      capabilities,
    });
    const out = { ok: true, path: packet.path, packet: packet.packet };
    console.log(JSON.stringify(out, null, 2));
    return 0;
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

export { writeReviewPacket };

const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exit(main(process.argv.slice(2)));
