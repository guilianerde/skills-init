// CodeGraph（https://github.com/colbymchenry/codegraph）：预建的代码知识图谱（符号、调用边、影响面），100% 本地。
// --with-codegraph 时：没有 CLI 就 npm 全局安装 → 给 claude / codex 写项目级 MCP 配置 → 建本项目索引（.codegraph/）。
// doubao / qwen / workbuddy 不在 CodeGraph 支持的 agent 里，skill 在这些环境直接调用 codegraph CLI。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { IS_WIN, CODEGRAPH_PKG, step, ok, warn } from './core.mjs';

// 只在本工具发起的调用里不上报使用统计；用户全局的 telemetry 设置不改，安装结束时提示怎么关
const ENV = { ...process.env, DO_NOT_TRACK: '1' };

export function codegraphVersion(cwd) {
  const r = spawnSync('codegraph', ['--version'], { cwd, encoding: 'utf8', shell: IS_WIN, env: ENV, timeout: 30000 });
  if (r.status !== 0) return null;
  const m = /(\d+\.\d+\.\d+)/.exec(`${r.stdout}${r.stderr}`);
  return m ? m[1] : 'unknown';
}

export const codegraphIndexed = (root) => fs.existsSync(path.join(root, '.codegraph'));

// 我们的环境 → codegraph install 的 target id；doubao / qwen / workbuddy 没有对应 target
const TARGETS = { claude: 'claude', codex: 'codex' };

const run = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: IS_WIN, env: ENV }).status === 0;

export function setupCodeGraph(root, sel) {
  step(`接入 CodeGraph 代码图谱（${CODEGRAPH_PKG}）`);
  let ver = codegraphVersion(root);
  if (!ver) {
    ok(`未找到 codegraph 命令，执行 npm i -g ${CODEGRAPH_PKG}`);
    if (!run(IS_WIN ? 'npm.cmd' : 'npm', ['i', '-g', CODEGRAPH_PKG], root) || !(ver = codegraphVersion(root))) {
      warn(`安装 CodeGraph 失败，已跳过（skills 已正常安装）。可手动 npm i -g ${CODEGRAPH_PKG} 后重跑 --with-codegraph`);
      return 'failed';
    }
  }
  ok(`codegraph ${ver}`);

  const targets = [...new Set(sel.map((e) => TARGETS[e]).filter(Boolean))];
  if (targets.length) {
    // local：MCP 配置写进本项目（claude：.mcp.json、.claude/settings.json、.claude/CLAUDE.md；codex：.codex/config.toml、AGENTS.md）
    if (!run('codegraph', ['install', `--target=${targets.join(',')}`, '--location=local', '--yes'], root)) {
      warn('codegraph install 失败，已跳过 MCP 配置；skills 仍会通过 codegraph CLI 使用图谱');
    } else {
      ok(`已为 ${targets.join('、')} 写入项目级 CodeGraph MCP 配置（重启 agent 生效）`);
      if (targets.includes('codex')) warn('Codex 只在受信任的项目里加载 .codex/config.toml：在 Codex 里把本项目设为 trusted 后生效');
    }
  }
  const cliOnly = sel.filter((e) => !TARGETS[e]);
  if (cliOnly.length) ok(`${cliOnly.join('、')}：CodeGraph 不支持写 MCP 配置，skills 在这些环境直接调用 codegraph CLI`);

  step('建立本项目的代码图谱索引（codegraph init，大项目需要几分钟）');
  if (!run('codegraph', ['init', root, '--yes'], root) || !codegraphIndexed(root)) {
    warn(`codegraph init 失败，已跳过建索引（可在项目根手动执行 codegraph init）`);
    return 'failed';
  }
  ok('索引已建在 .codegraph/（已加入 .gitignore）；之后 agent 使用期间自动增量同步');
  warn('CodeGraph 默认上报匿名使用统计（不含代码、路径、符号名）；如需关闭：codegraph telemetry off');
  return 'ok';
}
