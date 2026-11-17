#!/usr/bin/env node
// 产物按需求归档：方案、交付说明、审查报告、技术方案、上线方案按需求放在一起，meta.json 汇总需求名、绑定的分支、各产物、
// wiki 发布记录与 DocNexus 沉淀，供 /workflow view 等直接读取。
// 本工具的产出都在项目根的 workflow-run/ 里（需求产物 docs/requirements/、DocNexus 工作区 docnexus/、项目模板 templates/、临时文件 tmp/），
// 不往项目的其他地方写。两种用法：
// 两种用法的目录结构完全一样：产物都在 workflow-run/docs/requirements/<需求名>/<项目名>/，一个需求横跨多个服务时各项目各占一个子目录，
// 所以两种用法之间切换只是换一个 git 仓库来跟踪 workflow-run/，文件不用挪：
//   - 默认：workflow-run/ 随代码提交；项目名没配置时取 git 远端仓库名（第一次 bind 时写进 profile.json，之后固定）
//   - 独立文档仓库：团队文档仓库克隆到 workflow-run/（它自己是 git 仓库，代码仓库忽略它），项目名要先配置（各服务在同一个仓库里，名字由团队定）；
//     文档仓库单独提交（写完由用户确认，可用 artifacts.commit_prompt 关闭提交提示）
// 需求名由用户在流程开始或第一次落盘时给出；用户不给时按分支名生成。分支 → 需求的绑定记在 meta.json 的 branches。
// 说明见 workflow/references/requirements.md。
//
// 用法（在项目根执行；--root 可指定项目根；--branch 缺省为当前 git 分支）：
//   requirement.mjs which [--branch b]                 # 当前分支绑定的需求；没绑定时给出建议名、最近的需求（文档仓库模式还列出其他项目的需求）
//   requirement.mjs bind [--name <需求名>] [--branch b] [--base m]   # 绑定（没有就新建）；不给 --name 按分支名生成
//   requirement.mjs reindex [--branch b | --all]       # 只重建派生索引；不改正文、版本、运行状态或证据
//   requirement.mjs pending [--branch b]               # 文档仓库模式：当前需求在文档仓库里未提交的改动与建议的提交命令
//   requirement.mjs list                               # 所有需求（名称、分支、产物数、更新时间）
//   requirement.mjs config [--project <项目名>] [--commit-prompt on|off] [--local]   # 查看 / 修改产物配置
// 输出 JSON。退出码：0 正常；1 参数错误 / git 失败；2 需要先问用户（还没绑定需求、还没配置项目名）

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWorkflow } from '../core/index.mjs';
import { HOME, setConfig, artifactsConfig, layout, setProfileSource, profileSources } from '../lib/project.mjs';
import { list, pending } from '../lib/requirements.mjs';
export { HOME, REQ_DIR, TEMPLATES_DIR, TMP_DIR, PROFILE_SOURCE, IGNORE_LINE, homeDir, homeIsRepo, dirName, profileDir, artifactsConfig, layout, suggestProject, setConfig, setProfileSource, profileSources, ensureIgnore } from '../lib/project.mjs';
export { requirements, repoRequirements, artifactFiles, find } from '../lib/requirement-read.mjs';
export { OLD_DIR, list, pending } from '../lib/requirements.mjs';
export { FILES, parseFile, parseBranch, parseDocnexus } from '../lib/artifact-model.mjs';
function currentBranch(root) {
  const r = spawnSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

// ------------------------------------------------------------------ CLI
const USAGE = '用法: requirement.mjs which | bind [--name <需求名>] | reindex [--all] | pending | list | config [--project <名>] [--commit-prompt on|off] [--profile-source <环境|路径|auto>] [--local]  （通用：--root <项目根> --branch <分支>）';

function main(argv) {
  let root = process.cwd();
  const o = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') root = path.resolve(argv[++i] ?? '.');
    else if (['--name', '--branch', '--base', '--repo', '--project', '--commit-prompt', '--profile-source'].includes(a)) { if (i + 1 >= argv.length) { console.error(USAGE); return 1; } o[a.slice(2)] = argv[++i]; }
    else if (a === '--all' || a === '--local') o[a.slice(2)] = true;
    else if (a.startsWith('--')) { console.error(USAGE); return 1; }
    else pos.push(a);
  }
  const [cmd, arg] = pos;
  const branch = o.branch ?? currentBranch(root);
  const workflow = createWorkflow({ root });
  const print = (x, code = 0) => { console.log(JSON.stringify(x, null, 2)); return code; };
  const ready = (x) => (x.ok === false && x.need_project ? 2 : 0);
  try {
    switch (cmd) {
    case 'which': { const r = workflow.requirements.which({ branch }); return print(r, ready(r)); }
    case 'bind': { const r = workflow.requirements.bind({ name: o.name, branch, base: o.base }); return print(r, r.ok ? 0 : ready(r) || 1); }
    case 'reindex': {
      if (!o.all && !branch) { console.error('无法确定当前分支，请用 --branch 指定或使用 --all'); return 1; }
      const r = workflow.maintenance.reindex({ branch, all: !!o.all });
      return print(r, r.ok === false ? 1 : 0);
    }
    case 'list': return print(list(root));
    case 'pending': { const r = pending(root, branch); return print(r, ready(r)); }
    case 'config': {
      const patch = {};
      let source = null;
      if (o.repo !== undefined) { console.error(`--repo 已不再支持：独立文档仓库改为把团队文档仓库克隆到项目根的 ${HOME}/（见 workflow/references/requirements.md）`); return 1; }
      if (o.project !== undefined) patch.project = o.project;
      if (o['commit-prompt'] !== undefined) {
        if (!['on', 'off'].includes(o['commit-prompt'])) { console.error('--commit-prompt 取 on / off'); return 1; }
        patch.commit_prompt = o['commit-prompt'] === 'on';
      }
      if (o['profile-source'] !== undefined) source = setProfileSource(root, o['profile-source']);
      if (!Object.keys(patch).length) {
        if (source) return print(source);
        const L = layout(root); const c = artifactsConfig(root);
        return print({ mode: L.mode, repo: L.repo_rel ?? null, project: L.project, commit_prompt: c.commit_prompt, profile_source: c.profile_source, candidates: profileSources(root), ok: L.ok, hint: L.ok ? null : L.hint });
      }
      const configured = setConfig(root, patch, { local: !!o.local });
      return print(source ? { ...configured, profile_source: source } : configured);
    }
      default: console.error(USAGE); return 1;
    }
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
