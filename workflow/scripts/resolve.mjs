#!/usr/bin/env node
// workflow 共用的判定脚本：模板来源、项目画像、增强能力探测。规则只在这里实现一份，各 skill 调用它，
// 不再各自按文字描述去判断。只读文件，不输出任何凭据。
//
// 用法（在项目根执行；--root 可指定项目根）：
//   node .agents/skills/workflow/scripts/resolve.mjs template <skill> <文件名>   # 该用哪份模板
//   node .agents/skills/workflow/scripts/resolve.mjs templates                   # 所有模板的来源
//   node .agents/skills/workflow/scripts/resolve.mjs profile                     # 项目画像与空字段
//   node .agents/skills/workflow/scripts/resolve.mjs infer-profile               # 从仓库推断画像草稿（带依据，不写文件）
//   node .agents/skills/workflow/scripts/resolve.mjs category <skill>             # 该 skill 写入 DocNexus 时的显式分类
//   node .agents/skills/workflow/scripts/resolve.mjs status                      # 能力探测（/workflow status）
//   node .agents/skills/workflow/scripts/resolve.mjs env                         # 本机系统与终端（安装时记录），写终端命令按它来
//   node .agents/skills/workflow/scripts/resolve.mjs env --check                 # 核对画像里的开发环境配置（JDK / Maven / Node 路径）在本机是否存在
// 输出 JSON。退出码：0 正常；2 缺模板或必装 DocNexus 不可用（按共享能力与模板规则处理）；1 参数错误 / 该 skill 没有声明分类

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inferProfile } from './infer-profile.mjs';
import { layout, TEMPLATES_DIR, detectEnv, SHELL_NOTES, readEnv, expandPath, readToolchain, checkToolchain, readProfile } from '../lib/project.mjs';
export { detectEnv, SHELL_NOTES, readEnv, expandPath, readToolchain, checkToolchain, readProfile } from '../lib/project.mjs';
import { capabilities, DOCNEXUS_HINT, docnexusWorkspace, docnexusConnected } from '../lib/capabilities.mjs';
export { docnexusRoot, docnexusWorkspace, docnexusConnected, docnexusBin, codegraphStatus } from '../lib/capabilities.mjs';

const SKILLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const rel = (root, p) => path.relative(root, p).split(path.sep).join('/');

function skillMetas() {
  const out = [];
  for (const d of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    const m = d.isDirectory() || d.isSymbolicLink() ? readJson(path.join(SKILLS_DIR, d.name, 'skill.json')) : null;
    if (m?.name) out.push({ templates: [], ...m });
  }
  return out;
}

export const skillMeta = (name) => skillMetas().find((m) => m.name === name);

export function resolveTemplate(root, skill, id) {
  const meta = skillMeta(skill);
  if (!meta) return { ok: false, error: 'unknown', message: `skill「${skill}」没有安装（${rel(root, SKILLS_DIR)} 下找不到 ${skill}/skill.json）；重跑安装并在 --skills 里带上它` };
  const t = meta.templates.find((x) => x.id === id);
  if (!t) return { ok: false, error: 'unknown', message: `skill「${skill}」没有登记模板「${id}」（见 ${skill}/skill.json 的 templates）` };
  const lib = path.join(docnexusWorkspace(root), 'library', 'templates', skill, id);
  const project = path.join(root, TEMPLATES_DIR, skill, id);
  // 包内模板仅用于导入；技术 / 上线方案需要用户提供样例创建
  const builtin = t.src ? path.join(SKILLS_DIR, skill, t.src.replace(/\.tpl$/, '')) : null;
  const CREATE = '按 <skills>/workflow/references/templates.md「创建模板」处理：请用户给一份团队现有的同类文档作样例（本地 md 或 wiki pageId / URL），用 workflow/scripts/make-template.mjs 抽骨架，和用户确认后保存到 expected';
  // workflow-run/templates/ 下的项目模板已不再生效（定制模板只放 DocNexus，便于共享），留着的只用来提示导入
  const stale = fs.existsSync(project) ? rel(root, project) : null;
  const res = { skill, id, docnexus: docnexusConnected(root), stale_project_file: stale };
  if (!res.docnexus) return { ok: false, ...res, error: 'missing', need_docnexus: true, expected: rel(root, lib), hint: DOCNEXUS_HINT };
  if (fs.existsSync(lib)) return { ok: true, ...res, source: 'docnexus', path: rel(root, lib) };
  return {
    ok: false, ...res, error: 'missing', expected: rel(root, lib),
    ...(!builtin ? { on_demand: true } : {}),
    import_from: stale ?? (builtin ? rel(root, builtin) : null),
    hint: builtin
      ? '知识库缺少模板。运行 npx @rowansenne/workflow-run seed-templates 导入，或经用户确认后按 capture 流程把 import_from 写入 expected（分类 doc-template）。'
      : `知识库还没有这份团队模板。${CREATE}（写入需用户授权，以 --category doc-template 封存）。`,
  };
}

// DocNexus 对显式分类名的约束：1–80 字符，无首尾空白与控制字符（与 bin/skills.mjs 一致）
const validCategory = (c) => typeof c === 'string' && c.length >= 1 && c.length <= 80 && c === c.trim() && !/[\u0000-\u001f\u007f]/.test(c);

// skill 写入 DocNexus 的显式分类：项目画像 docnexus_categories.<skill> 优先，其次 skill.json 的 docnexus.category。
// 入库时作为调用方显式分类封存（seal_args），metadata.category 写同一个值（兼容不支持 --category 的旧版 DocNexus）
export function resolveCategory(root, skill) {
  const meta = skillMeta(skill);
  if (!meta) return { ok: false, error: 'unknown', message: `未安装 skill「${skill}」` };
  const override = readProfile(root).profile.docnexus_categories?.[skill];
  let category, reason, source;
  if (override != null && override !== '') {
    if (!validCategory(override)) return { ok: false, error: 'invalid', message: `workflow/profile.json 的 docnexus_categories.${skill} 不是合法分类名（1–80 字符，无首尾空白与控制字符）` };
    [category, reason, source] = [override, `项目画像指定的 ${skill} skill 产出分类`, 'profile'];
  } else if (meta.docnexus?.category) {
    [category, reason, source] = [meta.docnexus.category, meta.docnexus.reason || `由 ${skill} skill 产出`, 'skill'];
  } else {
    return { ok: false, error: 'none', skill, message: `skill「${skill}」没有声明 DocNexus 分类，写入时按 DocNexus 默认流程由模型分类` };
  }
  return {
    ok: true, skill, category, reason, source,
    seal_args: ['--category', category, '--category-reason', reason],
    metadata: { category, category_reason: reason },
  };
}

// 本机系统与终端：安装时检测一次，写进 workflow/profile.local.json 的 env（个人设置，不提交，各人各机器不同）。
// agent 写命令时按它来，不必每次自己探测（uname、$PSVersionTable）。没记录时（还没重跑安装器）当场检测系统，终端为 null
export function status(root) {
  const p = readProfile(root);
  const caps = capabilities(root);
  const templates = skillMetas().flatMap((m) => m.templates.map((t) => resolveTemplate(root, m.name, t.id)));
  return {
    ...caps,
    // 已安装的 skill（--skills 子集安装时只有一部分），路由前据此判断目标 skill 是否可用
    skills: skillMetas().map((m) => m.name),
    // 本机系统与终端（安装时记录），写命令按它来
    env: readEnv(),
    profile: { ok: p.complete, empty: p.empty, how: p.complete ? null : '运行 /workflow profile' },
    // 开发环境配置：只在配过时给出（没配不算问题，构建跑不起来时才需要）
    toolchain: p.toolchain.configured
      ? { configured: true, fields: Object.fromEntries(Object.entries(p.toolchain.fields).map(([k, v]) => [k, v.resolved])), ...(p.toolchain.cleared.length ? { cleared: p.toolchain.cleared } : {}) }
      : { configured: false, ...(p.toolchain.cleared.length ? { cleared: p.toolchain.cleared } : {}) },
    docnexus: {
      ...caps.docnexus,
      missing_templates: caps.docnexus.ok ? templates.filter((t) => !t.ok && !t.on_demand).map((t) => t.expected) : [],
      stale_project_templates: templates.map((t) => t.stale_project_file).filter(Boolean),
      categories: Object.fromEntries(skillMetas().map((m) => [m.name, resolveCategory(root, m.name)]).filter(([, c]) => c.ok).map(([n, c]) => [n, c.category])),
    },
    // 产物位置：项目里（默认）或独立文档仓库，两种都是 docs/requirements/<需求>/<项目>/（workflow/references/requirements.md）
    artifacts: (() => { const L = layout(root); return { mode: L.mode, ok: L.ok, dir: 'workflow-run/docs/requirements', project: L.project, ...(L.mode === 'repo' ? { repo: L.repo_rel, commit_prompt: L.commit_prompt } : {}), how: L.ok ? null : L.hint }; })(),
    templates, // 包含 path / expected / hint，按共享模板规则处理，不在各 Skill 重复分支
    // 不随 skills 提供、还没创建的模板（技术方案、上线方案）：第一次生成文档时按「创建模板」引导用户创建
    templates_to_create: templates.filter((t) => t.on_demand).map((t) => ({ skill: t.skill, id: t.id, expected: t.expected })),
  };
}

function main(argv) {
  let root = process.cwd();
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = path.resolve(argv[++i] ?? '.');
    else args.push(argv[i]);
  }
  const [cmd, ...rest] = args;
  const print = (o) => console.log(JSON.stringify(o, null, 2));
  switch (cmd) {
    case 'template': {
      if (rest.length !== 2) break;
      const r = resolveTemplate(root, rest[0], rest[1]);
      print(r);
      return r.ok ? 0 : r.error === 'missing' ? 2 : 1;
    }
    case 'templates': print(status(root).templates); return 0;
    case 'profile': print(readProfile(root)); return 0;
    case 'infer-profile': print({ current: readProfile(root).profile, ...inferProfile(root) }); return 0;
    case 'category': {
      if (rest.length !== 1) break;
      const r = resolveCategory(root, rest[0]);
      print(r);
      return r.ok ? 0 : 1;
    }
    case 'status': print(status(root)); return 0;
    case 'env':
      // env（默认）：本机系统与终端；--check：核对画像里的开发环境配置在本机是否存在
      if (rest.includes('--check') || rest.includes('--resolve')) { print(checkToolchain(root)); return 0; }
      print(readEnv()); return 0;
  }
  console.error('用法: resolve.mjs [--root <项目根>] template <skill> <文件名> | templates | profile | infer-profile | category <skill> | status | env [--check]');
  return 1;
}

const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exit(main(process.argv.slice(2)));
