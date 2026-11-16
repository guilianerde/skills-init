#!/usr/bin/env node
// 内部程序入口示例：只读查询目标项目的需求绑定和当前运行。
// 用法：node examples/workflow-core.mjs --root <绝对项目路径> --branch <分支>
import path from 'node:path';

import { createWorkflow } from '../workflow/core/index.mjs';

function option(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

const root = option(process.argv.slice(2), '--root');
const branch = option(process.argv.slice(2), '--branch');
if (!root || !branch) {
  console.error('用法：node examples/workflow-core.mjs --root <绝对项目路径> --branch <分支>');
  process.exit(1);
}

const workflow = createWorkflow({ root: path.resolve(root) });
const result = {
  root: workflow.root,
  requirement: workflow.requirements.which({ branch }),
  run: workflow.runs.status({ branch }),
};
console.log(JSON.stringify(result, null, 2));
