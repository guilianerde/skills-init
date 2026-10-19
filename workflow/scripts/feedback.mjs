#!/usr/bin/env node
// 运行反馈：skill 每跑完一次追加一行到 workflow-run/feedback/<git 用户名>.jsonl，攒两三周后汇总，作为精简 SKILL.md 的依据。
// 只记过程（提问轮数、跳过的步骤、哪条规则不清楚……），不记代码、类名、表名、业务名词；结果类数据（审查发现、未验证项）report.mjs 从产物里统计。
// 每人一个文件、随 workflow-run/ 提交，多人不冲突；装了新版本（init / upgrade）时清掉本项目旧版本的记录（git 历史里仍可找回）。
// 字段含义与记录规则见 workflow/references/feedback.md。
//
// 用法（在项目根执行；--root 可指定项目根）：
//   node .agents/skills/workflow/scripts/feedback.mjs add --skill dev --model <模型> [--mode feature] [--size M] [--fast no] [--rounds 2] …
//   node .agents/skills/workflow/scripts/feedback.mjs summary [--json]
// --skipped / --unclear / --feedback 可重复。add 输出写到的文件（JSON）。退出码：0 正常；1 参数错误

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homeDir, homeIsRepo, layout, suggestProject, dirName, HOME } from './requirement.mjs';

const SKILLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FEEDBACK_DIR = 'feedback';

// 字段 → 类型；list 可重复
const FIELDS = {
  skill: 'string', model: 'string', env: 'string',
  mode: ['feature', 'bug', 'review'], size: ['S', 'M', 'L'], depth: ['快审', '标准', '深审'], fast: ['yes', 'no'],
  rounds: 'int', corrections: 'int', 'baseline-failures': 'int',
  acceptance: /^\d+\/\d+$/, findings: /^\d+\/\d+\/\d+\/\d+$/,
  skipped: 'list', unclear: 'list', feedback: 'list',
};

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const gitOut = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout?.trim() ?? '';

export const feedbackDir = (root) => path.join(homeDir(root), FEEDBACK_DIR);
export const projectName = (root) => layout(root).project ?? suggestProject(root);

// 安装清单里的版本（skills 装在 .agents/skills/，清单在同一目录）；从源码仓库直接运行时用 package.json
export function installedVersion() {
  return readJson(path.join(SKILLS_DIR, '.workflow-run.json'))?.version ?? readJson(path.join(SKILLS_DIR, 'package.json'))?.version ?? 'unknown';
}

export function userFile(root) {
  const who = gitOut(root, ['config', 'user.name']) || gitOut(root, ['config', 'user.email']).split('@')[0] || 'unknown';
  return path.join(feedbackDir(root), `${dirName(who)}.jsonl`);
}

export function parseAdd(argv) {
  const rec = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([\w-]+)$/.exec(argv[i]);
    const type = m && FIELDS[m[1]];
    if (!type) throw new Error(`未知参数：${argv[i]}`);
    const v = argv[++i];
    if (v === undefined || v.startsWith('--')) throw new Error(`--${m[1]} 缺少值`);
    const key = m[1];
    if (type === 'list') { (rec[key] ??= []).push(v.trim()); continue; }
    if (type === 'int') { if (!/^\d+$/.test(v)) throw new Error(`--${key} 需要非负整数`); rec[key] = Number(v); continue; }
    if (Array.isArray(type) && !type.includes(v)) throw new Error(`--${key} 只能是 ${type.join(' / ')}`);
    if (type instanceof RegExp && !type.test(v)) throw new Error(`--${key} 格式不对（${type.source}）`);
    rec[key] = v;
  }
  if (!rec.skill) throw new Error('缺少 --skill');
  return rec;
}

export function add(root, rec, { now = new Date() } = {}) {
  const file = userFile(root);
  const line = { ts: now.toISOString(), version: installedVersion(), project: projectName(root), ...rec };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(line)}\n`);
  return { ok: true, file: path.relative(root, file).split(path.sep).join('/'), record: line };
}

export function readAll(root) {
  const dir = feedbackDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort().flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8')
    .split('\n').filter((l) => l.trim()).map((l) => { try { return { user: f.replace(/\.jsonl$/, ''), ...JSON.parse(l) }; } catch { return null; } }).filter(Boolean));
}

// 同一个人在两个分支上各追加一行，合并时会在文件末尾冲突：用 git 内置的 union 合并保留两边的行。
// workflow-run/ 是独立文档仓库时规则写进它自己的 .gitattributes。返回写入的文件（已有规则时 null）
export function ensureUnionMerge(root) {
  const [file, rule] = homeIsRepo(root) ? [path.join(homeDir(root), '.gitattributes'), `${FEEDBACK_DIR}/*.jsonl merge=union`] : [path.join(root, '.gitattributes'), `${HOME}/${FEEDBACK_DIR}/*.jsonl merge=union`];
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (text.split(/\r?\n/).some((l) => l.trim() === rule)) return null;
  fs.writeFileSync(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${rule}\n`);
  return { file: path.relative(root, file).split(path.sep).join('/'), rule };
}

// 新版本装好后：删掉本项目旧版本的记录，其他项目（独立文档仓库里各服务共用 feedback/）的不动。返回删掉的条数
export function rotate(root, version, project = projectName(root)) {
  const dir = feedbackDir(root);
  if (!fs.existsSync(dir)) return 0;
  let removed = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
    const p = path.join(dir, f);
    const lines = fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.trim());
    const keep = lines.filter((l) => { let r; try { r = JSON.parse(l); } catch { return true; } return r.version === version || (r.project && r.project !== project); });
    if (keep.length === lines.length) continue;
    removed += lines.length - keep.length;
    fs.writeFileSync(p, keep.length ? `${keep.join('\n')}\n` : '');
  }
  return removed;
}

// 「F6: 缺中间件」→ F6；没有章节前缀的归到「其他」
const sectionOf = (s) => /^([A-Z]?\d+|Step ?\d+|第\s*\d+\s*步)\s*[:：]/i.exec(s)?.[1].replace(/\s+/g, '') ?? '其他';
const groupBy = (xs, f) => xs.reduce((m, x) => { (m[f(x)] ??= []).push(x); return m; }, {});
const countBy = (xs, f) => xs.reduce((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const sorted = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]);
const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

export function summarize(records) {
  const bySkill = {};
  for (const [skill, rs] of Object.entries(groupBy(records, (r) => r.skill))) {
    const notes = (k) => rs.flatMap((r) => r[k] ?? []);
    const acc = rs.filter((r) => r.acceptance).map((r) => r.acceptance.split('/').map(Number));
    const findings = rs.filter((r) => r.findings).map((r) => r.findings.split('/').map(Number));
    bySkill[skill] = {
      runs: rs.length,
      mode: countBy(rs.filter((r) => r.mode), (r) => r.mode),
      size: countBy(rs.filter((r) => r.size), (r) => r.size),
      depth: countBy(rs.filter((r) => r.depth), (r) => r.depth),
      fast_path: rs.filter((r) => r.fast === 'yes').length,
      avg_rounds: avg(rs.filter((r) => r.rounds !== undefined).map((r) => r.rounds)),
      runs_with_corrections: rs.filter((r) => r.corrections > 0).length,
      acceptance: acc.length ? { verified: acc.reduce((a, [v]) => a + v, 0), total: acc.reduce((a, [, t]) => a + t, 0) } : null,
      runs_with_baseline_failures: rs.filter((r) => r['baseline-failures'] > 0).length,
      findings: findings.length ? ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].reduce((o, k, i) => ({ ...o, [k]: findings.reduce((a, f) => a + f[i], 0) }), {}) : null,
      skipped: groupBy(notes('skipped'), sectionOf),
      unclear: groupBy(notes('unclear'), sectionOf),
      feedback: notes('feedback'),
    };
  }
  return {
    records: records.length,
    from: records.map((r) => r.ts).sort()[0] ?? null,
    to: records.map((r) => r.ts).sort().at(-1) ?? null,
    versions: countBy(records, (r) => r.version), projects: countBy(records, (r) => r.project),
    users: Object.keys(countBy(records, (r) => r.user)).length, models: countBy(records, (r) => r.model ?? '未写'),
    skills: bySkill,
  };
}

function toMarkdown(s) {
  const kv = (m) => sorted(m).map(([k, v]) => `${k} ${v}`).join('，') || '无';
  const L = ['# 运行反馈汇总', '', `- 记录：${s.records} 条（${s.from?.slice(0, 10) ?? '—'} ～ ${s.to?.slice(0, 10) ?? '—'}），${s.users} 人`, `- 版本：${kv(s.versions)}`, `- 项目：${kv(s.projects)}`, `- 模型：${kv(s.models)}`, ''];
  for (const [skill, k] of Object.entries(s.skills)) {
    L.push(`## ${skill}（${k.runs} 次）`, '');
    if (Object.keys(k.mode).length) L.push(`- 模式：${kv(k.mode)}`);
    if (Object.keys(k.size).length) L.push(`- 规模：${kv(k.size)}；快速通道 ${k.fast_path} 次`);
    if (Object.keys(k.depth).length) L.push(`- 深度：${kv(k.depth)}`);
    if (k.avg_rounds !== null) L.push(`- 平均提问轮数：${k.avg_rounds}；用户纠正过需求理解：${k.runs_with_corrections} 次`);
    if (k.acceptance) L.push(`- 验收项：已验证 ${k.acceptance.verified} / ${k.acceptance.total}`);
    if (k.runs_with_baseline_failures) L.push(`- 开工前已有失败：${k.runs_with_baseline_failures} 次`);
    if (k.findings) L.push(`- 审查发现：${Object.entries(k.findings).map(([a, b]) => `${a} ${b}`).join('，')}`);
    for (const [title, groups] of [['跳过的步骤', k.skipped], ['不清楚 / 矛盾 / 做不到的规则', k.unclear]]) {
      const g = sorted(Object.fromEntries(Object.entries(groups).map(([sec, xs]) => [sec, xs.length])));
      if (!g.length) continue;
      L.push('', `### ${title}`, '');
      for (const [sec, n] of g) { L.push(`- **${sec}**（${n}）`); for (const x of groups[sec]) L.push(`  - ${x}`); }
    }
    if (k.feedback.length) { L.push('', '### 用户反馈', ''); for (const x of k.feedback) L.push(`- ${x}`); }
    L.push('');
  }
  if (!s.records) L.push('还没有记录。');
  return L.join('\n');
}

function main(argv) {
  let root = process.cwd();
  const rest = [];
  for (let i = 0; i < argv.length; i++) { if (argv[i] === '--root') root = path.resolve(argv[++i] ?? '.'); else rest.push(argv[i]); }
  const [cmd, ...args] = rest;
  if (cmd === 'add') {
    try { console.log(JSON.stringify(add(root, parseAdd(args)), null, 2)); return 0; } catch (e) { console.error(e.message); return 1; }
  }
  if (cmd === 'summary' && args.every((a) => a === '--json')) {
    const s = summarize(readAll(root));
    console.log(args.includes('--json') ? JSON.stringify(s, null, 2) : toMarkdown(s));
    return 0;
  }
  console.error('用法: feedback.mjs [--root <项目根>] add --skill <skill> [--model …] … | summary [--json]');
  return 1;
}

export { main };
const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exit(main(process.argv.slice(2)));
