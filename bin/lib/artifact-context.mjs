// 普通聊天也会加载的项目级落盘约定；不依赖 DocNexus 或 skill 是否触发。
import fs from 'node:fs';
import path from 'node:path';
import { HOME, ok } from './core.mjs';

const START = '<!-- workflow-run:artifacts:start -->';
const END = '<!-- workflow-run:artifacts:end -->';
const FILES = ['CLAUDE.md', 'AGENTS.md', 'QWEN.md'];
const BLOCK = [
  START,
  '## 工作流文件落盘边界',
  '',
  '- dev 工作流仅在用户实际调用 `/dev` / `$dev`、点选 dev skill，或明确要求使用 dev / 完整开发工作流时启动。普通分析、问答、代码修改、修 bug、重构、测试、提交代码和推送都不构成启动授权；讨论 dev 或引用命令示例也不构成授权。',
  '- 未获 dev 流程授权时，直接处理当前任务，不自动做工作流开工探测、确认需求名、绑定需求、创建运行或补齐需求 / 方案 / 审查 / 交付文档，也不主动询问是否开启 dev。已授权的同一 dev 任务可按当前阶段续接；只问分析或要求提交代码时仅处理当前请求，不重启或自行推进流程。旧运行、旧产物和分支绑定不构成新任务或新会话的恢复授权。',
  `- 普通聊天中生成的报告、分析、方案、草稿、导出等辅助文件，默认写到项目根的 \`${HOME}/other/\`（需要时创建，可按主题建子目录）。不要因为分支已绑定需求就放进需求目录。`,
  `- \`${HOME}/docs/requirements/\` 只存通过 dev、project-review、create-tech-md-doc、create-release-md-doc 等工作流生成的正式需求产物。普通聊天不得为辅助文件调用 requirement.mjs bind / path / sync 或 run.mjs，不创建或更新需求 meta.json，也不将这些文件计入需求产物和运行状态。`,
  '- 项目源码、测试、配置及已有文件的维护仍遵循项目原目录；工作流自身指定的临时目录、知识库等路径沿用各自规则。用户明确指定输出路径时按用户要求执行，不自动搬移已有文件。',
  END,
].join('\n');

export function writeArtifactContext(root, envs) {
  const files = new Set();
  if (envs.includes('claude')) files.add('CLAUDE.md');
  if (envs.some((e) => ['codex', 'doubao', 'workbuddy'].includes(e))) files.add('AGENTS.md');
  if (envs.includes('qwen')) files.add('QWEN.md');
  for (const file of files) {
    const f = path.join(root, file);
    const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    const a = cur.indexOf(START); const b = cur.indexOf(END);
    const next = a >= 0 && b > a
      ? `${cur.slice(0, a)}${BLOCK}${cur.slice(b + END.length)}`
      : `${cur}${!cur || cur.endsWith('\n\n') ? '' : cur.endsWith('\n') ? '\n' : '\n\n'}${BLOCK}\n`;
    if (next !== cur) { fs.writeFileSync(f, next); ok(`${file} 已写入文件落盘约定（普通聊天产物在 ${HOME}/other/）`); }
  }
}

export function removeArtifactContext(root) {
  for (const file of FILES) {
    const f = path.join(root, file);
    if (!fs.existsSync(f)) continue;
    const cur = fs.readFileSync(f, 'utf8');
    const a = cur.indexOf(START); const b = cur.indexOf(END);
    if (a < 0 || b < a) continue;
    const rest = [cur.slice(0, a).replace(/\n+$/, ''), cur.slice(b + END.length).replace(/^\n+/, '')].filter(Boolean).join('\n\n');
    if (rest) fs.writeFileSync(f, `${rest}\n`); else fs.rmSync(f);
    ok(`${file} 已移除文件落盘约定`);
  }
}
