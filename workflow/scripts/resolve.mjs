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
// 输出 JSON。退出码：0 正常；2 已接入 DocNexus 但知识库缺该模板（按输出的 hint 处理）；1 参数错误 / 该 skill 没有声明分类

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inferProfile } from './infer-profile.mjs';
import { layout, HOME, TEMPLATES_DIR } from './requirement.mjs';

const SKILLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROFILE_FIELDS = ['main_branch', 'build', 'test', 'test_single', 'lint', 'config_center', 'deploy.platform', 'deploy.regions', 'job_annotation'];
const PROFILE_REQUIRED = ['main_branch', 'build', 'test'];

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

// DocNexus 的项目根：skills-init/（工作区在 skills-init/docnexus/），DocNexus 的命令都在这个目录下运行。bin/lib/core.mjs 的 docnexusRoot 与此一致
export const docnexusRoot = (root) => path.resolve(root, HOME);

// DocNexus CLI 的位置（相对项目根）：skills-init/docnexus/node_modules/.bin；没有返回 null。bin/lib/core.mjs 的 docnexusBin 与此一致
export const DOCNEXUS_BIN_DIRS = [['docnexus', 'node_modules', '.bin']];
export function docnexusBin(root) {
  const name = process.platform === 'win32' ? 'docnexus.cmd' : 'docnexus';
  const dn = docnexusRoot(root);
  for (const dir of DOCNEXUS_BIN_DIRS) if (fs.existsSync(path.join(dn, ...dir, name))) return path.relative(path.resolve(root), path.join(dn, ...dir, name));
  return null;
}
// 给 agent 的命令写法（相对项目根）：./skills-init/docnexus/...
const cmdPath = (p) => { const s = p.split(path.sep).join('/'); return s.startsWith('.') ? s : `./${s}`; };

// CodeGraph 代码图谱：本项目建过索引（.codegraph/）且 codegraph 命令可用。索引是否建立由用户决定，skill 不自行 codegraph init
export function codegraphStatus(root) {
  const indexed = fs.existsSync(path.join(root, '.codegraph'));
  const r = spawnSync('codegraph', ['--version'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32', env: { ...process.env, DO_NOT_TRACK: '1' }, timeout: 30000 });
  const cli = r.status === 0;
  return {
    ok: indexed && cli, cli, indexed,
    how: cli && indexed ? null : !cli ? '重跑 skills-init 并加 --with-codegraph（或 npm i -g @colbymchenry/codegraph）' : '在项目根运行 codegraph init 建索引（由用户决定）',
  };
}

export function docnexusConnected(root) {
  return fs.existsSync(path.join(docnexusRoot(root), 'docnexus', 'project.json')) && docnexusBin(root) !== null;
}

export function resolveTemplate(root, skill, id) {
  const meta = skillMeta(skill);
  const t = meta?.templates.find((x) => x.id === id);
  if (!t) return { ok: false, error: 'unknown', message: `skill「${skill}」没有登记模板「${id}」（见 ${skill}/skill.json 的 templates）` };
  const lib = path.join(docnexusRoot(root), 'docnexus', 'library', 'templates', skill, id);
  const project = path.join(root, TEMPLATES_DIR, skill, id);
  // 没有 src 的模板（技术方案、上线方案）不随 skills 提供，缺失时按「创建模板」由用户给样例生成
  const builtin = t.src ? path.join(SKILLS_DIR, skill, t.src.replace(/\.tpl$/, '')) : null;
  const CREATE = '按 <skills>/workflow/references/templates.md「创建模板」处理：请用户给一份团队现有的同类文档作样例（本地 md 或 wiki pageId / URL），用 workflow/scripts/make-template.mjs 抽骨架，和用户确认后保存到 expected';
  if (docnexusConnected(root)) {
    const res = { skill, id, docnexus: true, stale_project_file: fs.existsSync(project) ? rel(root, project) : null };
    if (fs.existsSync(lib)) return { ok: true, ...res, source: 'docnexus', path: rel(root, lib) };
    if (!builtin) {
      return {
        ok: false, ...res, error: 'missing', on_demand: true, expected: rel(root, lib),
        import_from: fs.existsSync(project) ? rel(root, project) : null,
        hint: `已接入 DocNexus，只使用知识库中的模板，这份模板还没有创建。停下这一步告诉用户：${fs.existsSync(project) ? '项目里已有 import_from，经用户确认后可直接按 capture 流程写入 expected；否则' : ''}${CREATE}（写入 DocNexus 需要用户授权，以显式分类 --category doc-template 封存）。`,
      };
    }
    return {
      ok: false, ...res, error: 'missing', expected: rel(root, lib),
      import_from: fs.existsSync(project) ? rel(root, project) : rel(root, builtin),
      hint: '已接入 DocNexus，只使用知识库中的模板。停下这一步告诉用户缺这份模板：可在项目根运行 skills-init seed-templates（或重跑安装加 --seed-templates），或经用户确认后把 import_from 按 capture 流程写入 expected（以显式分类 --category doc-template 封存）。',
    };
  }
  if (fs.existsSync(project)) return { ok: true, skill, id, docnexus: false, source: 'project', path: rel(root, project) };
  if (!builtin) {
    return {
      ok: false, skill, id, docnexus: false, error: 'missing', on_demand: true, expected: rel(root, project),
      hint: `这份模板不随 skills 提供，项目里还没有创建。停下这一步告诉用户，${CREATE}。`,
    };
  }
  return { ok: true, skill, id, docnexus: false, source: 'default', path: rel(root, builtin) };
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
const OS_NAMES = { win32: 'windows', darwin: 'macos', linux: 'linux' };
export function detectEnv() {
  const os = OS_NAMES[process.platform] ?? process.platform;
  let shell;
  if (process.platform === 'win32') {
    shell = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { stdio: 'ignore', timeout: 15000 }).status === 0 ? 'pwsh' : 'powershell';
  } else shell = path.basename(process.env.SHELL || 'sh');
  return { os, shell };
}
// 终端的写法提示：PowerShell 5.1 没有 && / ||，pwsh 7 有
export const SHELL_NOTES = {
  powershell: 'Windows PowerShell 5.1：没有 && 和 ||，多条命令用 ; 分开；不要用 2>/dev/null、grep、head 等 Unix 命令',
  pwsh: 'PowerShell 7：支持 &&；不要用 2>/dev/null、grep、head 等 Unix 命令',
};
export function readEnv() {
  const rec = readJson(path.join(SKILLS_DIR, 'workflow', 'profile.local.json'))?.env;
  const env = rec?.os ? { os: rec.os, shell: rec.shell ?? null, source: 'install' } : { os: OS_NAMES[process.platform] ?? process.platform, shell: null, source: 'runtime' };
  const note = SHELL_NOTES[env.shell];
  return { ...env, ...(note ? { note } : {}) };
}

export function readProfile(root) {
  const f = path.join(SKILLS_DIR, 'workflow', 'profile.json');
  const profile = readJson(f);
  const get = (k) => k.split('.').reduce((o, p) => (o == null ? undefined : o[p]), profile);
  const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);
  const empty = profile ? PROFILE_FIELDS.filter((k) => isEmpty(get(k))) : PROFILE_FIELDS;
  return {
    path: rel(root, f), exists: !!profile, profile: profile ?? {}, empty, env: readEnv(),
    complete: !!profile && PROFILE_REQUIRED.every((k) => !empty.includes(k)),
  };
}

export function status(root) {
  const p = readProfile(root);
  const wikiCfg = readJson(path.join(SKILLS_DIR, 'md-to-wiki', 'wiki-config.json'));
  const db = readJson(path.join(SKILLS_DIR, 'database-query', 'config.json'));
  const dn = docnexusConnected(root);
  const templates = skillMetas().flatMap((m) => m.templates.map((t) => resolveTemplate(root, m.name, t.id)));
  return {
    // 已安装的 skill（--skills 子集安装时只有一部分），路由前据此判断目标 skill 是否可用
    skills: skillMetas().map((m) => m.name),
    // 本机系统与终端（安装时记录），写命令按它来
    env: readEnv(),
    profile: { ok: p.complete, empty: p.empty, how: p.complete ? null : '运行 /workflow profile' },
    wiki: {
      ok: wikiCfg?.enabled === true && !!wikiCfg?.wiki?.base_url,
      how: '填写 md-to-wiki/wiki-config.json（enabled + base_url + api_token），或接入 wiki MCP（脚本无法探测 MCP，请另行检查可用工具）',
    },
    docnexus: {
      ok: dn,
      // 调用 DocNexus CLI 时用这个路径（在项目根执行）
      bin: dn ? cmdPath(docnexusBin(root)) : null,
      // DocNexus 的项目根（相对本项目）：docnexus 系列 skill 里的路径（docnexus/library/<path>、草稿）都相对这个目录
      root: HOME,
      // 运行 DocNexus 命令的写法（在项目根执行，任何终端都一样）：后面接原命令的参数；node 脚本前加 --node
      run: `node ${(rel(root, path.join(SKILLS_DIR, 'workflow', 'scripts', 'docnexus.mjs')))}`,
      missing_templates: dn ? templates.filter((t) => !t.ok && !t.on_demand).map((t) => t.expected) : [],
      stale_project_templates: dn ? templates.map((t) => t.stale_project_file).filter(Boolean) : [],
      // 各 skill 写入时使用的显式分类（没声明的 skill 不列出）
      categories: Object.fromEntries(skillMetas().map((m) => [m.name, resolveCategory(root, m.name)]).filter(([, c]) => c.ok).map(([n, c]) => [n, c.category])),
      how: dn ? '缺模板时运行 skills-init seed-templates' : '重跑 skills-init 并加 --with-docnexus',
    },
    // 产物位置：项目里（默认）或独立文档仓库（workflow/references/requirements.md）
    artifacts: (() => { const L = layout(root); return { mode: L.mode, ok: L.ok, ...(L.mode === 'repo' ? { repo: L.repo_rel, project: L.project, commit_prompt: L.commit_prompt } : { dir: 'skills-init/docs/requirements' }), how: L.ok ? null : L.hint }; })(),
    // 代码图谱：可用时读代码、查调用链与影响面优先用它（见 workflow/references/codegraph.md）
    codegraph: codegraphStatus(root),
    database: {
      ok: !!db?.connections && Object.keys(db.connections).length > 0,
      default: db?.default_connection ?? (db?.connections?.default ? 'default' : null),
      connections: Object.fromEntries(Object.entries(db?.connections ?? {}).map(([k, c]) => [k, { driver: c.driver ?? 'mysql', readonly: c.readonly !== false }])),
      how: '重跑 skills-init 补配数据库',
    },
    templates: templates.map(({ skill, id, source, path: p2, ok, on_demand, expected }) => ({ skill, id, ok, source: source ?? 'missing', path: p2 ?? null, ...(on_demand ? { on_demand: true, expected } : {}) })),
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
    case 'env': print(readEnv()); return 0;
  }
  console.error('用法: resolve.mjs [--root <项目根>] template <skill> <文件名> | templates | profile | infer-profile | category <skill> | status | env');
  return 1;
}

const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exit(main(process.argv.slice(2)));
