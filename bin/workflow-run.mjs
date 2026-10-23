#!/usr/bin/env node
// workflow-run — 项目级 Agent Skills 一键初始化（Node 版，跨平台单一实现）
//
// 用法：
//   npx @rowansenne/workflow-run [命令] [选项]          # 在项目根执行（唯一的安装方式）
//
// 单一来源：skills 只完整安装到 .agents/skills（codex / doubao 直接使用）；
//           .claude/skills、.qwen/skills、.codebuddy/skills（WorkBuddy）下按 skill 建相对软链接指向它；--copy 退回各环境独立拷贝。
// 重跑安全：SKILL.md / references / 模板会更新；用户已填写的 wiki-config.json、schema.md、
//           workflow/profile.json 保留不覆盖；database-query/config.json 仅在本次提供了数据库配置时写入。
// 安装清单：每个安装目录写 .workflow-run.json，记录模板文件的 sha256。重跑时据此判断模板文件是否被手改过
//           （改过的不静默覆盖）、清理模板里已删除的文件；--uninstall 按清单卸载。
//
// 本文件只做参数解析与命令调度，实现在 bin/lib/：core（常量与工具）、prompt（交互输入）、db（数据库配置）、
// install（安装 / 软链接 / 改名清理 / .gitignore）、uninstall、docnexus（接入与模板记录）、doctor（upgrade / doctor）。

import fs from 'node:fs';
import path from 'node:path';
import { seedTemplates, updateTemplates } from './seed-templates.mjs';
import { TPL_DIR, PKG, ENV_NAMES, CANON_DIR, LINK_ENVS, HOME, SKILLS, resolveSkillSelection, step, ok, warn, CliError, fail, isAdminTerminal } from './lib/core.mjs';
import { ask, closePrompt } from './lib/prompt.mjs';
import { findExistingDbConfig, getDb } from './lib/db.mjs';
import { report, installSkills, linkSkills, updateGitignore, setupHome, recordEnv } from './lib/install.mjs';
import { setupCodeGraph } from './lib/codegraph.mjs';
import { uninstall } from './lib/uninstall.mjs';
import { checkNodeForDocNexus, setupDocNexus, refreshDocNexusLinks, cleanupLegacyDocNexus, templateRecords, saveTemplateRecords, reportTemplateStatus, installedSkills, docnexusConnected, printTemplateDiffs } from './lib/docnexus.mjs';
import { upgradeOptions, doctor } from './lib/doctor.mjs';
import { docsRepo } from './lib/docsrepo.mjs';
import { findLegacy, legacyMessage } from './lib/legacy.mjs';

// ---------------------------------------------------------------- 参数
const COMMANDS = ['init', 'upgrade', 'doctor', 'uninstall', 'seed-templates', 'report', 'feedback', 'view', 'docs-repo'];
const HELP = `用法: workflow-run [命令] [选项]

命令：
  init（默认）         安装或重装 skills
  upgrade              按安装清单里的环境与模式非交互升级到当前版本（保留数据库配置等用户配置；skills 文件一律更新为新版，手改过的先备份到 workflow-run/tmp/upgrade-backup/）；
                       加 --with-docnexus 时把 DocNexus 包也升到最新版（@latest），刷新 skill 链接与 CLAUDE.md / AGENTS.md 段落，并导入新增的文档模板（只新增，不覆盖已有模板）；不加则 DocNexus 包原地不动，只顺带导入新增模板
  doctor               自检：版本、手改 / 缺失文件、软链接、项目画像、DocNexus 模板、数据库连通性、.gitignore
  uninstall            按安装清单卸载本项目装的 skills 与链接（用户配置备份到 workflow-run/tmp/uninstall-backup/）
  seed-templates       只把自带的文档模板导入 DocNexus（workflow-run/docnexus/library/templates/，已有的不覆盖）
  report               本地效果报告：只读统计 workflow-run/docs/requirements/ 下的产物（审查发现与修复率、需求澄清、DocNexus 沉淀与复用、各分支链路）
  feedback             运行反馈汇总：dev / project-review 每次运行追加到 workflow-run/feedback/<用户>.jsonl 的过程记录（提问轮数、跳过的步骤、不清楚的规则），精简 skill 的依据；--json 输出 JSON
  view                 项目文档视图：按需求浏览方案、交付、审查（含复审修复情况）、技术 / 上线方案，生成本地静态页面
  docs-repo <仓库地址> 改用团队文档仓库：克隆到 workflow-run/、代码仓库忽略它、配置本项目的项目名、接上仓库里的 DocNexus；
                       不带地址时显示当前状态

init 选项：
  --envs <列表>        环境，逗号分隔：codex,claude,doubao,qwen,workbuddy；all = 全部（不传则交互选择）
  --skip-db            跳过数据库连接配置
  --yes                非交互：使用已有数据库配置；都没有且未 --skip-db 时报错退出
  --with-docnexus      同时接入 DocNexus 文档库（装在 workflow-run/docnexus/，需 Node >= 22.13 与 npm），并导入文档模板
  --with-codegraph     同时接入 CodeGraph 代码图谱：没有 codegraph 命令时 npm 全局安装，为 claude / codex 写项目级 MCP 配置，并建本项目索引（.codegraph/）
  --copy               不用软链接，各环境独立拷贝
  --skills <列表>      只装这些 skill（逗号分隔），自动带上 skill.json 里 requires 声明的依赖；缺省为全部
  --seed-templates     安装后把文档模板导入 DocNexus；接入 DocNexus 后文档类 skill 只从知识库取模板
  --uninstall          同 uninstall 命令
seed-templates 选项：
  --update             同时把「导入后未改动、但默认模板有新版」的知识库模板更新为新版
  --diff               不写入，只打印团队改过的模板与新默认模板的差异（customized / untracked），供手动合并
doctor 选项：
  --offline            不测试数据库连通性
report 选项：
  --since <YYYY-MM-DD> 只统计该日期起的产物
  --json               输出 JSON
  --all-branches       同时用 git 只读扫描所有本地分支里提交过的产物（默认只看工作区）
docs-repo 选项：
  --project <名称>     本项目在文档仓库里的名字（默认沿用已配置的，其次 git 远端仓库名）；只改项目名时可不带地址
view 选项：
  --out <文件>         页面写到哪里（默认 workflow-run/tmp/view/index.html）
  --open               生成后用默认浏览器打开
通用：
  --project-root <dir> 项目根目录（默认当前目录）
  -v, --version        显示版本
  -h, --help           显示帮助`;

function parseArgs(argv) {
  const o = { cmd: 'init', envs: '', skipDb: false, yes: false, withDocNexus: false, withCodeGraph: false, copy: false, seedTemplates: false, update: false, diff: false, skills: '', offline: false, root: process.cwd() };
  let cmdGiven = false; // 命令可以出现在选项之间（封装脚本会先传 --project-root）
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) fail(`${a} 需要一个值`); return argv[++i]; };
    switch (a) {
      case '--envs': o.envs = val(); break;
      case '--skip-db': o.skipDb = true; break;
      case '--yes': o.yes = true; break;
      case '--with-docnexus': o.withDocNexus = true; break;
      case '--with-codegraph': o.withCodeGraph = true; break;
      case '--copy': o.copy = true; break;
      case '--skills': o.skills = val(); break;
      case '--seed-templates': o.seedTemplates = true; break;
      case '--uninstall': o.cmd = 'uninstall'; cmdGiven = true; break;
      case '--offline': o.offline = true; break;
      case '--update': o.update = true; break;
      case '--diff': o.diff = true; break;
      case '--since': o.since = val(); break;
      case '--json': o.json = true; break;
      case '--all-branches': o.allBranches = true; break;
      case '--out': o.out = val(); break;
      case '--open': o.open = true; break;
      case '--project-root': o.root = path.resolve(val()); break;
      case '--project': o.project = val(); break;
      case '-v': case '--version': console.log(PKG.version); process.exit(0); break;
      case '-h': case '--help': console.log(HELP); process.exit(0); break;
      default:
        if (!cmdGiven && COMMANDS.includes(a)) { o.cmd = a; cmdGiven = true; break; }
        if (o.cmd === 'docs-repo' && !o.url && !a.startsWith('-')) { o.url = a; break; }
        fail(`未知参数: ${a}\n${HELP}`);
    }
  }
  if (!fs.existsSync(o.root) || !fs.statSync(o.root).isDirectory()) fail(`项目根目录不存在: ${o.root}`);
  return o;
}


// ---------------------------------------------------------------- 1. 环境选择
async function resolveEnvs(o) {
  if (o.envs) {
    if (o.envs.trim().toLowerCase() === 'all') return [...ENV_NAMES];
    // PowerShell 把未加引号的 codex,claude 当数组再以空格拼接，所以逗号和空白都当分隔符
    const sel = o.envs.split(/[,，\s]+/).map((s) => s.trim().toLowerCase()).filter((s) => ENV_NAMES.includes(s));
    return sel.length ? [...new Set(sel)].sort() : [...ENV_NAMES];
  }
  step('选择要安装 skills 的环境');
  console.log('  1) codex     -> .agents/skills （Codex 项目级，与豆包共用）');
  console.log('  2) claude    -> .claude/skills （Claude Code 项目级）');
  console.log('  3) doubao    -> .agents/skills （豆包办公项目级）');
  console.log('  4) qwen      -> .qwen/skills   （Qwen Code 项目级）');
  console.log('  5) workbuddy -> .codebuddy/skills（腾讯 WorkBuddy 项目级）');
  const choice = await ask('输入编号（逗号分隔，如 1,3；直接回车 = 全部）: ');
  if (!choice) return [...ENV_NAMES];
  const sel = choice.split(/[,，\s]+/).filter((p) => /^[1-5]$/.test(p)).map((p) => ENV_NAMES[Number(p) - 1]);
  if (!sel.length) { warn('未识别到有效编号，按全部安装'); return [...ENV_NAMES]; }
  return [...new Set(sel)].sort();
}


// ================================================================= main
async function main() {
  let o = parseArgs(process.argv.slice(2));
  // 旧包 skills-init 留下的数据目录 / 安装清单：给出改名命令后停下，不自动迁移
  const legacy = findLegacy(o.root);
  if (legacy.block.length) fail(legacyMessage(legacy));
  for (const s of legacy.notes) warn(`旧版残留：${s}`);
  if (Number(process.versions.node.split('.')[0]) < 22) warn(`当前 Node v${process.versions.node} 低于 22：workflow-run 只在 Node 22 / 24 上测试（18、20 已停止维护），建议升级`);
  if (o.cmd === 'uninstall') { step(`按安装清单卸载 ${o.root} 中的 skills`); return uninstall(o.root); }
  if (o.cmd === 'doctor') return doctor(o.root, o.offline);
  if (o.cmd === 'docs-repo') return docsRepo(o.root, { url: o.url, project: o.project });
  if (o.cmd === 'report') {
    const { main: report } = await import(new URL('../workflow/scripts/report.mjs', import.meta.url));
    return report(['--root', o.root, ...(o.since ? ['--since', o.since] : []), ...(o.json ? ['--json'] : []), ...(o.allBranches ? ['--all-branches'] : [])]);
  }
  if (o.cmd === 'feedback') {
    const { main: feedback } = await import(new URL('../workflow/scripts/feedback.mjs', import.meta.url));
    return feedback(['--root', o.root, 'summary', ...(o.json ? ['--json'] : [])]);
  }
  if (o.cmd === 'view') {
    const { main: view } = await import(new URL('../workflow/scripts/view.mjs', import.meta.url));
    return view(['--root', o.root, ...(o.out ? ['--out', o.out] : []), ...(o.open ? ['--open'] : [])]);
  }
  if (o.cmd === 'seed-templates' && o.diff) {
    step('团队改过的模板与新默认模板的差异（只读，不写入 DocNexus）');
    printTemplateDiffs(o.root);
    return 0;
  }
  if (o.cmd === 'seed-templates') {
    step('导入文档模板到 DocNexus');
    try {
      const r = seedTemplates(o.root, TPL_DIR, { ok, warn, version: PKG.version, skills: installedSkills(o.root) });
      saveTemplateRecords(o.root, r.records);
      let failed = r.failed.length;
      if (o.update) {
        step('更新导入后未改动的模板（--update）');
        const u = updateTemplates(o.root, TPL_DIR, templateRecords(o.root), { ok, warn, version: PKG.version, skills: installedSkills(o.root) });
        saveTemplateRecords(o.root, u.records);
        failed += u.failed.length;
      }
      reportTemplateStatus(o.root);
      return failed ? 1 : 0;
    } catch (e) { warn(e.message); return 1; }
  }
  // Windows：安装 / 升级只在管理员终端进行（建目录软链接需要该权限），否则直接停下，不做任何改动
  if (!isAdminTerminal()) {
    const args = process.argv.slice(2);
    const again = `npx @rowansenne/workflow-run ${args.join(' ')}`.trim();
    fail(`当前终端没有管理员权限，已停止${o.cmd === 'upgrade' ? '升级' : '安装'}（没有做任何改动）。
请以管理员身份打开终端：开始菜单搜索「PowerShell」或「终端」→ 右键「以管理员身份运行」，进入项目目录后重新执行：
  cd "${o.root}"
  ${again}`);
  }
  if (o.cmd === 'upgrade') o = upgradeOptions(o);
  if (o.withDocNexus) { step('检查 DocNexus 依赖'); checkNodeForDocNexus(); }

  const sel = await resolveEnvs(o);
  step(`目标环境：${sel.join(' ')}`);
  let skills;
  try { skills = o.skills ? resolveSkillSelection(o.skills.split(/[,，\s]+/).filter(Boolean)) : SKILLS; } catch (e) { fail(e.message); }
  if (o.skills) step(`安装的 skill：${skills.join(' ')}（含 requires 依赖）`);
  // 不装 database-query 时不必询问数据库连接
  if (!skills.includes('database-query')) o.skipDb = true;

  let db = null;
  if (!o.skipDb) {
    if (o.yes && !findExistingDbConfig(o.root)) {
      fail('非交互模式(--yes)但未找到已有数据库配置（.codex/ 或各环境 database-query/config.json），请去掉 --yes 手动输入，或加 --skip-db。');
    }
    db = await getDb(o);
  }

  cleanupLegacyDocNexus(o.root);

  // 安装目标：单一来源模式下 .agents/skills 只装一次，其余环境建链接；--copy 时各环境各装一份
  const targets = [];
  const links = [];
  if (o.copy) {
    if (sel.includes('codex') || sel.includes('doubao')) targets.push(['codex/doubao', CANON_DIR]);
    for (const [env, dir] of Object.entries(LINK_ENVS)) if (sel.includes(env)) targets.push([env, dir]);
  } else {
    targets.push(['单一来源', CANON_DIR]);
    for (const [env, dir] of Object.entries(LINK_ENVS)) if (sel.includes(env)) links.push([env, dir]);
  }

  const ctx = { root: o.root, yes: o.yes, envs: sel, mode: o.copy ? 'copy' : 'symlink', skills };
  for (const [name, dir] of targets) {
    const abs = path.resolve(o.root, dir);
    step(`安装到 ${name}  ->  ${abs}`);
    await installSkills(abs, db, ctx);
  }
  for (const [name, dir] of links) {
    step(`链接 ${name}  ->  ${path.join(o.root, dir)}`);
    if (!linkSkills(o.root, name, dir, skills)) await installSkills(path.join(o.root, dir), db, { ...ctx, mode: 'copy-fallback' });
  }
  closePrompt(); // 模板冲突时可能还要询问，装完再关

  updateGitignore(o.root, o.withCodeGraph);
  setupHome(o.root);
  recordEnv(o.root);
  const docnexus = o.withDocNexus ? setupDocNexus(o.root, sel) : 'skipped';
  // 升级 / 重装都刷新本项目里的 DocNexus skills 链接与 CLAUDE.md / AGENTS.md 段落
  if (!o.withDocNexus) refreshDocNexusLinks(o.root, sel);
  const codegraph = o.withCodeGraph ? setupCodeGraph(o.root, sel) : 'skipped';
  let seedFailed = false;
  // 接入 DocNexus 后文档类 skill 只从知识库取模板，所以 --with-docnexus 时一并导入（已有的不覆盖）；
  // upgrade 时新版本可能新增了模板（缺了 skill 会停下），已接入就顺带导入缺的，不改动已有模板
  const upgradeSeed = o.upgrading && docnexusConnected(o.root);
  if ((o.seedTemplates || o.withDocNexus || upgradeSeed) && docnexus !== 'failed') {
    step(upgradeSeed && !o.seedTemplates && !o.withDocNexus ? '导入新增的文档模板到 DocNexus（只新增，已有模板不动）' : '导入文档模板到 DocNexus（--seed-templates）');
    try {
      const r = seedTemplates(o.root, TPL_DIR, { ok, warn, version: PKG.version, skills: installedSkills(o.root), quietSkip: upgradeSeed });
      saveTemplateRecords(o.root, r.records);
      // upgrade 顺带的导入是尽力而为：失败只提示，不让升级本身算失败
      const explicit = o.seedTemplates || o.withDocNexus;
      seedFailed = explicit && r.failed.length > 0;
      if (!explicit && r.failed.length) warn('新增模板导入失败（skills 已升级）：修复后运行 npx @rowansenne/workflow-run seed-templates 重试');
      if (upgradeSeed && !r.seeded.length && !r.failed.length) ok('知识库里的文档模板齐全，无需导入');
    } catch (e) { warn(e.message); seedFailed = o.seedTemplates || o.withDocNexus; }
  }

  step('安装完成，启用方式');
  console.log('  codex     : 重启 codex 后自动发现项目级 skills（.agents/skills）；也可 /use project-review 手动加载');
  console.log('  claude    : Claude Code 自动发现 .claude/skills，无需额外配置');
  console.log('  doubao    : 豆包办公自动发现 .agents/skills（新会话生效）');
  console.log('  qwen      : Qwen Code 自动发现 .qwen/skills；/skills 面板可查看与切换');
  console.log('  workbuddy : WorkBuddy 打开本项目目录后读取 .codebuddy/skills（项目级优先于用户级）；DocNexus 段落写在 AGENTS.md');
  if (db) ok('database-query 连接已生成并写入；凭据已加入 .gitignore，请勿提交。');
  else if (fs.existsSync(path.join(o.root, CANON_DIR, 'database-query', 'config.json'))) ok('database-query/config.json 已存在，保留不动。');
  else warn('注意：本次未写入数据库连接。可重跑补配，或手动放置 database-query/config.json（已有的保留不动）。');
  warn('注意：md-to-wiki 的 wiki 连接（wiki-config.json）默认留空（enabled=false），未配置前 md-to-wiki 与 create-*-md-doc 的 --prd 增强不启动。');
  warn('        启用方法：填写 .agents/skills/md-to-wiki/wiki-config.json（enabled: true + base_url + api_token），或接入对应环境的 wiki MCP。重跑不会覆盖已填写的配置。');
  if (docnexus === 'ok') ok('DocNexus 已接入：dev / project-review 会按 docnexus-recall 查项目约定；文档类 skill 只从 workflow-run/docnexus/library/templates/ 取模板；任何写入 DocNexus 的操作都需你授权。');
  // 已接入 DocNexus：缺模板时文档类 skill 会停下来要求导入；默认模板有新版时提示更新或合并
  if (docnexusConnected(o.root)) reportTemplateStatus(o.root);
  if (docnexus === 'failed') warn('注意：DocNexus 接入失败（见上方输出），其他 skills 不受影响；修复后可重跑（加 --with-docnexus）。');
  if (codegraph === 'failed') warn('注意：CodeGraph 接入失败（见上方输出），其他 skills 不受影响；skills 会退回 grep / 读文件；修复后可重跑（加 --with-codegraph）。');
  const keep = '（skills 目录里的文件以安装包为准；项目定制请放到 workflow/profile.json、DocNexus（文档模板只能在这里定制）或 CLAUDE.md / AGENTS.md）';
  if (report.overwritten.length || report.removed.length) {
    warn(`以下文件被手动修改过，已按新版${report.removed.length ? '覆盖或删除' : '覆盖'}，原文件备份在 ${report.backupDir}/${keep}：`);
    for (const f of report.overwritten) warn(`  ${f}`);
    for (const f of report.removed) warn(`  ${f}（新版已不提供，已删除）`);
  }
  // 目录里没有安装清单（不是本工具装的，或清单丢了）：无从判断是否手改，内容和新版不同就备份后覆盖，汇总成一行
  if (report.unlisted.length) {
    ok(`${report.unlistedDirs.join('、')} 里没有安装清单，${report.unlisted.length} 个和新版不同的文件已备份到 ${report.backupDir}/ 后覆盖（无从判断是否手改过）`);
  }
  console.log('先运行 /workflow profile 填写项目画像；说明见 workflow-run README。');
  // skills 已装好，但显式要求的 DocNexus 未接入：返回非 0 便于自动化感知
  return docnexus === 'failed' || codegraph === 'failed' || seedFailed ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => {
  closePrompt();
  if (e instanceof CliError) { console.error(`错误: ${e.message}`); process.exit(1); }
  console.error(e); process.exit(1);
});
