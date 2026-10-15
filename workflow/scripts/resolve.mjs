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
// 输出 JSON。退出码：0 正常；2 已接入 DocNexus 但知识库缺该模板（按输出的 hint 处理）；1 参数错误 / 该 skill 没有声明分类

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inferProfile } from './infer-profile.mjs';

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

export function docnexusConnected(root) {
  const bin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'docnexus.cmd' : 'docnexus');
  return fs.existsSync(path.join(root, 'docnexus', 'project.json')) && fs.existsSync(bin);
}

export function resolveTemplate(root, skill, id) {
  const meta = skillMeta(skill);
  const t = meta?.templates.find((x) => x.id === id);
  if (!t) return { ok: false, error: 'unknown', message: `skill「${skill}」没有登记模板「${id}」（见 ${skill}/skill.json 的 templates）` };
  const lib = path.join(root, 'docnexus', 'library', 'templates', skill, id);
  const project = path.join(root, 'docs', 'skills', 'templates', skill, id);
  const builtin = path.join(SKILLS_DIR, skill, t.src.replace(/\.tpl$/, ''));
  if (docnexusConnected(root)) {
    const res = { skill, id, docnexus: true, stale_project_file: fs.existsSync(project) ? rel(root, project) : null };
    if (fs.existsSync(lib)) return { ok: true, ...res, source: 'docnexus', path: rel(root, lib) };
    return {
      ok: false, ...res, error: 'missing', expected: rel(root, lib),
      import_from: fs.existsSync(project) ? rel(root, project) : rel(root, builtin),
      hint: '已接入 DocNexus，只使用知识库中的模板。停下这一步告诉用户缺这份模板：可在项目根运行 skills-init seed-templates（或重跑安装加 --seed-templates），或经用户确认后把 import_from 按 capture 流程写入 expected（以显式分类 --category doc-template 封存）。',
    };
  }
  if (fs.existsSync(project)) return { ok: true, skill, id, docnexus: false, source: 'project', path: rel(root, project) };
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

export function readProfile(root) {
  const f = path.join(SKILLS_DIR, 'workflow', 'profile.json');
  const profile = readJson(f);
  const get = (k) => k.split('.').reduce((o, p) => (o == null ? undefined : o[p]), profile);
  const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);
  const empty = profile ? PROFILE_FIELDS.filter((k) => isEmpty(get(k))) : PROFILE_FIELDS;
  return {
    path: rel(root, f), exists: !!profile, profile: profile ?? {}, empty,
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
    profile: { ok: p.complete, empty: p.empty, how: p.complete ? null : '运行 /workflow profile' },
    wiki: {
      ok: wikiCfg?.enabled === true && !!wikiCfg?.wiki?.base_url,
      how: '填写 md-to-wiki/wiki-config.json（enabled + base_url + api_token），或接入 wiki MCP（脚本无法探测 MCP，请另行检查可用工具）',
    },
    docnexus: {
      ok: dn,
      missing_templates: dn ? templates.filter((t) => !t.ok).map((t) => t.expected) : [],
      stale_project_templates: dn ? templates.map((t) => t.stale_project_file).filter(Boolean) : [],
      // 各 skill 写入时使用的显式分类（没声明的 skill 不列出）
      categories: Object.fromEntries(skillMetas().map((m) => [m.name, resolveCategory(root, m.name)]).filter(([, c]) => c.ok).map(([n, c]) => [n, c.category])),
      how: dn ? '缺模板时运行 skills-init seed-templates' : '重跑 skills-init 并加 --with-docnexus',
    },
    database: {
      ok: !!db?.connections && Object.keys(db.connections).length > 0,
      default: db?.default_connection ?? (db?.connections?.default ? 'default' : null),
      connections: Object.fromEntries(Object.entries(db?.connections ?? {}).map(([k, c]) => [k, { driver: c.driver ?? 'mysql', readonly: c.readonly !== false }])),
      how: '重跑 skills-init 补配数据库',
    },
    templates: templates.map(({ skill, id, source, path: p2, ok }) => ({ skill, id, ok, source: source ?? 'missing', path: p2 ?? null })),
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
  }
  console.error('用法: resolve.mjs [--root <项目根>] template <skill> <文件名> | templates | profile | infer-profile | category <skill> | status');
  return 1;
}

const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exit(main(process.argv.slice(2)));
