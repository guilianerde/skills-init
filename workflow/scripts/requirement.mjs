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
// 需求目录写进项目根 .ignore，不参与代码搜索。旧版本（随代码提交时没有 <项目名>/ 这一层）的产物由安装器 upgrade 时迁移（migrateLayout）
// 需求名由用户在流程开始或第一次落盘时给出；用户不给时按分支名生成。分支 → 需求的绑定记在 meta.json 的 branches。
// 说明见 workflow/references/requirements.md。
//
// 用法（在项目根执行；--root 可指定项目根；--branch 缺省为当前 git 分支）：
//   requirement.mjs which [--branch b]                 # 当前分支绑定的需求；没绑定时给出建议名、最近的需求（文档仓库模式还列出其他项目的需求）
//   requirement.mjs bind [--name <需求名>] [--branch b] [--base m]   # 绑定（没有就新建）；不给 --name 按分支名生成
//   requirement.mjs path <plan|delivery|review|tech|release> [--branch b]   # 本次落盘的文件路径（文件名固定；已有时上一版复制到
//                                                     # workflow-run/tmp/old-artifacts/<种类>_v<N>.md，输出 previous）
//   requirement.mjs sync [<需求目录或其中的文件> | --all]  # 按目录里的文件重建 meta.json；指定了目录 / 文件时确认新版本号、输出归档了哪些上一版；
//                                                     # 文档仓库模式下带上提交提示
//   requirement.mjs pending [--branch b]               # 文档仓库模式：当前需求在文档仓库里未提交的改动与建议的提交命令
//   requirement.mjs list                               # 所有需求（名称、分支、产物数、更新时间）
//   requirement.mjs config [--project <项目名>] [--commit-prompt on|off] [--local]   # 查看 / 修改产物配置
// 输出 JSON。退出码：0 正常；1 参数错误 / git 失败；2 需要先问用户（还没绑定需求、还没配置项目名）

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HOME, setConfig, artifactsConfig, layout } from '../lib/project.mjs';
import { which, bind, nextPath, list, pending, sync } from '../lib/requirements.mjs';
import { requirements, find } from '../lib/requirement-read.mjs';
export { HOME, REQ_DIR, TEMPLATES_DIR, TMP_DIR, IGNORE_LINE, homeDir, homeIsRepo, dirName, profileDir, artifactsConfig, layout, suggestProject, setConfig, ensureIgnore } from '../lib/project.mjs';
export { requirements, repoRequirements, artifactFiles, find } from '../lib/requirement-read.mjs';
export { OLD_DIR, sync, which, bind, nextPath, list, pending, legacyRequirements, migrateLayout } from '../lib/requirements.mjs';
export { FILES, parseFile, parseBranch, parseDocnexus } from '../lib/artifact-model.mjs';
function currentBranch(root) {
  const r = spawnSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

// ------------------------------------------------------------------ CLI
const USAGE = '用法: requirement.mjs which | bind [--name <需求名>] | path <plan|delivery|review|tech|release> | sync [<目录|文件> | --all] | pending | list | config [--project <名>] [--commit-prompt on|off] [--local]  （通用：--root <项目根> --branch <分支>）';

function main(argv) {
  let root = process.cwd();
  const o = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') root = path.resolve(argv[++i] ?? '.');
    else if (['--name', '--branch', '--base', '--repo', '--project', '--commit-prompt'].includes(a)) { if (i + 1 >= argv.length) { console.error(USAGE); return 1; } o[a.slice(2)] = argv[++i]; }
    else if (a === '--all' || a === '--local') o[a.slice(2)] = true;
    else if (a.startsWith('--')) { console.error(USAGE); return 1; }
    else pos.push(a);
  }
  const [cmd, arg] = pos;
  const branch = o.branch ?? currentBranch(root);
  const print = (x, code = 0) => { console.log(JSON.stringify(x, null, 2)); return code; };
  const ready = (x) => (x.ok === false && x.need_project ? 2 : 0);
  switch (cmd) {
    case 'which': { const r = which(root, branch); return print(r, ready(r)); }
    case 'bind': { const r = bind(root, { name: o.name, branch, base: o.base }); return print(r, r.ok ? 0 : ready(r) || 1); }
    case 'path': { const r = nextPath(root, arg, branch); return print(r.out, r.code); }
    case 'list': return print(list(root));
    case 'pending': { const r = pending(root, branch); return print(r, ready(r)); }
    case 'config': {
      const patch = {};
      if (o.repo !== undefined) { console.error(`--repo 已不再支持：独立文档仓库改为把团队文档仓库克隆到项目根的 ${HOME}/（见 workflow/references/requirements.md）`); return 1; }
      if (o.project !== undefined) patch.project = o.project;
      if (o['commit-prompt'] !== undefined) {
        if (!['on', 'off'].includes(o['commit-prompt'])) { console.error('--commit-prompt 取 on / off'); return 1; }
        patch.commit_prompt = o['commit-prompt'] === 'on';
      }
      if (!Object.keys(patch).length) { const L = layout(root); const c = artifactsConfig(root); return print({ mode: L.mode, repo: L.repo_rel ?? null, project: L.project, commit_prompt: c.commit_prompt, ok: L.ok, hint: L.ok ? null : L.hint }); }
      return print(setConfig(root, patch, { local: !!o.local }));
    }
    case 'sync': {
      const L = layout(root);
      if (o.all) return print(requirements(root, L).map((r) => ({ dir: r.dir, artifacts: sync(root, r.dir).artifacts.length })));
      let target = null;
      if (arg) {
        const abs = path.resolve(root, arg);
        target = requirements(root, L).find((r) => abs === r.abs || abs.startsWith(r.abs + path.sep)) ?? null;
      } else target = find(root, branch, L);
      if (!target) { console.error('不在当前项目的需求目录下，或当前分支没有绑定需求'); return 1; }
      const m = sync(root, target.dir, { bump: true });
      const out = { dir: target.dir, name: m.name, artifacts: m.artifacts.length, latest: m.latest, versions: m.versions ?? {} };
      if (m.archived.length) {
        const to = path.posix.dirname(m.archived[0].file);
        out.archived = { files: m.archived, dir: to, hint: `上一版已归档到 ${to}/（不提交），目录里只留最新版。告诉用户归档了哪些文件，请用户确认不再需要后自己删除；不要替用户删` };
      }
      // 文档仓库模式：写完产物后提示提交（由用户确认；artifacts.commit_prompt 关闭时不提示）
      if (L.mode === 'repo') {
        const pd = pending(root, branch, target.dir);
        out.commit = pd.commit_prompt && pd.files?.length ? { repo: pd.repo, files: pd.files, suggested_message: pd.suggested_message, commands: pd.commands, hint: '文档仓库有未提交的产物：把改动和建议的提交信息给用户看，用户确认后再执行 commands；推送另外问用户' } : null;
      }
      return print(out);
    }
    default: console.error(USAGE); return 1;
  }
}

const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exit(main(process.argv.slice(2)));
