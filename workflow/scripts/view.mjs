#!/usr/bin/env node
// 项目文档视图：把 workflow-run/docs/requirements/<需求>/ 下的产物生成一个本地静态页面，
// 按需求浏览方案、交付说明、审查报告（含复审修复情况）、技术方案、上线方案，正文直接渲染。
// 只读产物；页面是单个 HTML 文件，数据内嵌，不联网、不上报。默认写到 workflow-run/tmp/view/index.html（tmp 不入库）。
//
// 用法（在项目根执行；--root 可指定项目根）：
//   node .agents/skills/workflow/scripts/view.mjs [--out <文件>] [--open]
// 退出码：0 正常；1 参数错误

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { KINDS } from '../lib/artifact-model.mjs';
import { loadWorkspace } from '../lib/workspace-read.mjs';
import { groupRequirements } from '../lib/requirement-read.mjs';
import { REQ_DIR } from '../lib/project.mjs';
import { buildReport } from './report.mjs';

const DEFAULT_OUT = 'workflow-run/tmp/view/index.html';

// 页面数据：按需求分组
export function viewData(root, workspace = loadWorkspace(root, { allProjects: true })) {
  // 连同其他项目（服务）的产物一起看，一个需求下按项目区分（文档仓库里常见；两种模式目录结构相同）
  const L = workspace.layout;
  const reqDirOf = (slug) => (L.mode === 'repo' ? `${L.repo_name}:docs/requirements/${slug}` : `${REQ_DIR}/${slug}`);
  const metas = new Map(groupRequirements(workspace.requirements).map((r) => [r.slug, { name: r.name, dir: reqDirOf(r.slug), branches: [...new Set(r.projects.flatMap((p) => p.meta.branches ?? []))], meta: r.projects.find((p) => p.project === L.project)?.meta ?? r.projects[0]?.meta ?? {}, runs: r.projects.flatMap((p) => workspace.runs.filter((run) => run.dir === p.dir).map(({ requirement, dir, ...run }) => run)) }]));
  const groups = new Map();
  for (const a of workspace.artifacts) {
    const id = a.requirement ? `req:${a.requirement}` : `branch:${a.branch ?? '（无分支）'}`;
    if (!groups.has(id)) {
      const m = a.requirement ? metas.get(a.requirement) : null;
      groups.set(id, {
        id, name: m?.name ?? (a.requirement ?? a.branch ?? '（无分支）'),
        dir: m?.dir ?? (a.requirement ? reqDirOf(a.requirement) : null), named_by: m?.meta?.named_by ?? null, branches: new Set(m?.branches ?? []), projects: new Set(), artifacts: [],
      });
    }
    const g = groups.get(id);
    if (a.branch) g.branches.add(a.branch);
    if (a.project) g.projects.add(a.project);
    const text = a.text;
    const item = { kind: a.kind, label: a.label, path: a.path, cite: a.cite ?? a.path, project: a.project ?? null, file: a.project && L.mode === 'repo' ? `${a.project}/${path.basename(a.path)}` : path.basename(a.path), date: a.date, version: a.version ?? 1, branch: a.branch, wiki: a.wiki, text };
    if (a.kind === 'review') item.review = a.review;
    if (a.kind === 'delivery') item.delivery = a.delivery;
    if (a.kind === 'review' || a.kind === 'delivery') item.docnexus = a.capture;
    item.knowledge = a.knowledge; // 产物里「DocNexus：docnexus/library/<path>」行：沉淀到的知识文档
    g.artifacts.push(item);
  }
  // 完整流程在首次产物前也可能已保存状态，不能因为没有 Markdown 就隐藏需求。
  for (const [slug, m] of metas) {
    const id = `req:${slug}`;
    if (m.runs.length && !groups.has(id)) groups.set(id, { id, name: m.name, dir: m.dir, named_by: m.meta.named_by ?? null, branches: new Set(m.branches), projects: new Set(m.runs.map((r) => r.project)), artifacts: [] });
    if (groups.has(id)) groups.get(id).runs = m.runs;
  }
  const list = [...groups.values()].map((g) => {
    const latest = (k) => g.artifacts.filter((a) => a.kind === k).at(-1)?.date ?? null;
    const dates = [...g.artifacts.map((a) => a.date), ...(g.runs ?? []).map((r) => r.updated_at?.slice(0, 10))].filter(Boolean).sort();
    // 沉淀到的知识文档：汇总各产物的「DocNexus：」行，去重，注明来自哪些产物
    const docnexus = new Map();
    for (const a of g.artifacts) for (const k of a.knowledge) {
      if (!docnexus.has(k)) docnexus.set(k, []);
      docnexus.get(k).push({ path: a.path, file: a.file, label: a.label });
    }
    return { ...g, branches: [...g.branches], projects: [...g.projects], first: dates[0] ?? null, last: dates.at(-1) ?? null, stages: Object.fromEntries(KINDS.map((k) => [k.kind, g.artifacts.filter((a) => a.kind === k.kind).length])), latest_review: latest('review'), docnexus: [...docnexus].map(([path, from]) => ({ path, from })) };
  });
  list.sort((a, b) => String(b.last).localeCompare(String(a.last)) || a.name.localeCompare(b.name));
  // 反向索引：知识文档 → 来源产物（跨需求）
  const index = new Map();
  for (const r of list) for (const d of r.docnexus) {
    if (!index.has(d.path)) index.set(d.path, []);
    for (const f of d.from) index.get(d.path).push({ requirement: r.id, name: r.name, ...f });
  }
  return {
    knowledge: [...index].sort((a, b) => a[0].localeCompare(b[0])).map(([path, sources]) => ({ path, sources })),
    project: path.basename(path.resolve(root)),
    mode: L.mode, ...(L.mode === 'repo' ? { repo: L.repo_name, current_project: L.project } : {}),
    generated: new Date().toISOString(),
    kinds: KINDS.map(({ kind, label }) => ({ kind, label })),
    requirements: list,
    report: buildReport(root, { workspace }),
    ...(workspace.diagnostics.length ? { diagnostics: workspace.diagnostics } : {}),
  };
}

const embed = (data) => JSON.stringify(data).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);

export function renderHtml(data) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>项目文档视图 · ${data.project.replace(/[<&>"]/g, '')}</title>
<style>
:root{--bg:#f7f7f5;--panel:#fff;--text:#1f2328;--muted:#656d76;--line:#e4e4e0;--accent:#3b6fd8;--accent-soft:#e8effc;--ok:#1a7f37;--ok-soft:#e6f4ea;--warn:#9a6700;--warn-soft:#fff4d6;--bad:#cf222e;--bad-soft:#ffebe9;--code:#f3f3f1;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#15171a;--panel:#1d2024;--text:#e6e6e6;--muted:#9aa1a9;--line:#2e3238;--accent:#7aa2f7;--accent-soft:#1f2a40;--ok:#56d364;--ok-soft:#173022;--warn:#e3b341;--warn-soft:#352b12;--bad:#ff7b72;--bad-soft:#3d1b1b;--code:#25282d;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#15171a;--panel:#1d2024;--text:#e6e6e6;--muted:#9aa1a9;--line:#2e3238;--accent:#7aa2f7;--accent-soft:#1f2a40;--ok:#56d364;--ok-soft:#173022;--warn:#e3b341;--warn-soft:#352b12;--bad:#ff7b72;--bad-soft:#3d1b1b;--code:#25282d;color-scheme:dark}
*{box-sizing:border-box}
a{color:var(--accent)}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
header{display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid var(--line);background:var(--panel);position:sticky;top:0;z-index:2}
header h1{font-size:16px;margin:0;font-weight:600;white-space:nowrap}
header .meta{color:var(--muted);font-size:12px;margin-left:auto}
header button{border:1px solid var(--line);background:transparent;color:var(--text);border-radius:6px;padding:4px 8px;cursor:pointer}
.layout{display:grid;grid-template-columns:320px 1fr;min-height:calc(100vh - 53px)}
aside{border-right:1px solid var(--line);background:var(--panel);padding:12px;overflow:auto;max-height:calc(100vh - 53px);position:sticky;top:53px}
aside input{width:100%;padding:7px 10px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--text);font:inherit}
.req{display:block;width:100%;text-align:left;border:1px solid transparent;background:transparent;color:inherit;border-radius:8px;padding:8px 10px;margin-top:6px;cursor:pointer;font:inherit}
.req:hover{background:var(--bg)}
.req.on{border-color:var(--accent);background:var(--accent-soft)}
.req .n{font-weight:600;word-break:break-all}
.req .s{color:var(--muted);font-size:12px;word-break:break-all}
.dots{display:flex;gap:4px;margin-top:4px}
.dot{width:18px;height:6px;border-radius:3px;background:var(--line)}
.dot.y{background:var(--accent)}
main{padding:20px 24px;min-width:0}
.overview{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:18px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.card .k{color:var(--muted);font-size:12px}
.card .v{font-size:20px;font-weight:600}
h2{font-size:18px;margin:0 0 4px}
.sub{color:var(--muted);font-size:12px;margin-bottom:14px}
.tag{display:inline-block;font-size:11px;padding:1px 6px;border-radius:10px;background:var(--code);color:var(--muted);margin-right:4px}
.tag.warn{background:var(--warn-soft);color:var(--warn)}
.pipeline{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px}
.stage{flex:1 1 120px;border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--panel)}
.stage.y{border-color:var(--accent)}
.stage .t{font-size:12px;color:var(--muted)}
.stage .c{font-weight:600}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top}
th{background:var(--code);font-weight:600}
.lv{font-weight:600;padding:0 6px;border-radius:4px}
.lv.c{background:var(--bad-soft);color:var(--bad)}
.lv.h{background:var(--warn-soft);color:var(--warn)}
.lv.f{background:var(--ok-soft);color:var(--ok)}
.files{display:flex;gap:6px;flex-wrap:wrap;margin:16px 0 10px}
.files button{border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:6px;padding:4px 10px;cursor:pointer;font:inherit;font-size:13px}
.files button.on{border-color:var(--accent);background:var(--accent-soft)}
.doc{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 24px 20px;overflow:auto}
.doc .path{color:var(--muted);font-size:12px;padding:8px 0;border-bottom:1px solid var(--line);margin-bottom:8px;word-break:break-all}
.doc h1{font-size:20px}.doc h2{font-size:17px;border-bottom:1px solid var(--line);padding-bottom:4px;margin-top:24px}.doc h3{font-size:15px}
.doc blockquote{margin:8px 0;padding:4px 12px;border-left:3px solid var(--line);color:var(--muted)}
.doc code{background:var(--code);padding:1px 4px;border-radius:4px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.doc pre{background:var(--code);padding:10px 12px;border-radius:8px;overflow:auto}
.doc pre code{padding:0;background:none}
.doc table{margin:8px 0;display:block;overflow-x:auto}
.empty{color:var(--muted);padding:40px 0;text-align:center}
section.block{margin-top:18px}
section.block h3{font-size:14px;margin:0 0 8px}
@media (max-width:820px){header .meta{display:none}#kb{margin-left:auto}.layout{grid-template-columns:1fr}aside{position:static;max-height:none;border-right:0;border-bottom:1px solid var(--line)}main{padding:16px}.doc{padding:8px 14px 16px}}
</style>
</head>
<body>
<header><h1>项目文档视图</h1><span class="meta" id="meta"></span><button id="kb" title="知识文档 → 来源产物">知识文档</button><button id="theme" title="切换明暗">◐</button></header>
<div class="layout"><aside><input id="q" placeholder="搜索需求、分支"><div id="list"></div></aside><main id="main"></main></div>
<script id="data" type="application/json">${embed(data)}</script>
<script>
const D = JSON.parse(document.getElementById('data').textContent);
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const theme = (() => { try { return localStorage.getItem('skills-view-theme'); } catch { return null; } })();
if (theme) document.documentElement.dataset.theme = theme;
$('#theme').onclick = () => { const t = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches) ? 'light' : 'dark'; document.documentElement.dataset.theme = t; try { localStorage.setItem('skills-view-theme', t); } catch {} };
$('#meta').textContent = (D.mode === 'repo' ? '文档仓库 ' + D.repo + ' · ' : '') + D.project + ' · 生成于 ' + D.generated.slice(0, 16).replace('T', ' ');

// 极简 Markdown 渲染：标题、段落、列表、引用、表格、代码块、行内代码 / 粗体 / 链接；先转义再渲染
function inline(s) {
  return esc(s).replace(/\`([^\`]+)\`/g, '<code>$1</code>').replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
    .replace(/\\[([^\\]]+)\\]\\((https?:[^)\\s]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
function md(src) {
  const lines = src.replace(/<!--[\\s\\S]*?-->/g, '').replace(/\\r/g, '').split('\\n');
  const out = []; let i = 0;
  const cells = (l) => l.trim().replace(/^\\||\\|$/g, '').split('|').map((c) => c.trim());
  while (i < lines.length) {
    const l = lines[i];
    if (/^\\s*\`\`\`/.test(l)) { const buf = []; i++; while (i < lines.length && !/^\\s*\`\`\`/.test(lines[i])) buf.push(lines[i++]); i++; out.push('<pre><code>' + esc(buf.join('\\n')) + '</code></pre>'); continue; }
    let m = /^(#{1,6})\\s+(.*)$/.exec(l);
    if (m) { out.push('<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>'); i++; continue; }
    if (/^\\s*\\|.*\\|\\s*$/.test(l)) {
      const rows = []; while (i < lines.length && /^\\s*\\|.*\\|\\s*$/.test(lines[i])) rows.push(lines[i++]);
      const body = rows.filter((r, k) => !(k === 1 && /^\\s*\\|[\\s:|-]+\\|\\s*$/.test(r)));
      out.push('<table><thead><tr>' + cells(body[0]).map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' + body.slice(1).map((r) => '<tr>' + cells(r).map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    if (/^\\s*>/.test(l)) { const buf = []; while (i < lines.length && /^\\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\\s*>\\s?/, '')); out.push('<blockquote>' + buf.map(inline).join('<br>') + '</blockquote>'); continue; }
    if (/^\\s*([-*]|\\d+[.)])\\s+/.test(l)) {
      const ordered = /^\\s*\\d/.test(l); const buf = [];
      while (i < lines.length && /^\\s*([-*]|\\d+[.)])\\s+/.test(lines[i])) buf.push(lines[i++].replace(/^\\s*([-*]|\\d+[.)])\\s+/, ''));
      out.push((ordered ? '<ol>' : '<ul>') + buf.map((b) => '<li>' + inline(b.replace(/^\\[( |x)\\]\\s*/, (x, c) => (c === 'x' ? '☑ ' : '☐ '))) + '</li>').join('') + (ordered ? '</ol>' : '</ul>'));
      continue;
    }
    if (/^\\s*(---|\\*\\*\\*)\\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (!l.trim()) { i++; continue; }
    const buf = []; while (i < lines.length && lines[i].trim() && !/^(#{1,6}\\s|\\s*\\||\\s*>|\\s*\`\`\`|\\s*([-*]|\\d+[.)])\\s)/.test(lines[i])) buf.push(lines[i++]);
    out.push('<p>' + buf.map(inline).join('<br>') + '</p>');
  }
  return out.join('\\n');
}

const pct = (v) => (v == null ? '—' : v + '%');
const dnLabel = { captured: '已沉淀', not_captured: '未沉淀', not_asked: '未询问', not_needed: '无需沉淀', not_connected: '未接入' };
function overview() {
  const r = D.report; const v = r.review;
  const cards = [
    ['需求', D.requirements.length],
    ['审查报告', v.reports + '（复审 ' + v.rereviews + '）'],
    ['严重问题', v.levels.CRITICAL + v.levels.HIGH],
    ['复核通过率', pct(v.verified_rate)],
    ['复审修复率', pct(v.fix_rate)],
    ['沉淀率', pct(r.capture.capture_rate)],
  ];
  const warnings = (D.diagnostics ?? []).map((d) => '<p>' + esc(d.path + '：' + d.message) + '</p>').join('');
  return (warnings ? '<section class="block"><h3>数据检查</h3>' + warnings + '</section>' : '') + '<div class="overview">' + cards.map(([k, v]) => '<div class="card"><div class="k">' + k + '</div><div class="v">' + esc(v) + '</div></div>').join('') + '</div>';
}

let current = null; let currentDoc = null;
function renderList() {
  const q = $('#q').value.trim().toLowerCase();
  const items = D.requirements.filter((r) => !q || (r.name + ' ' + r.branches.join(' ')).toLowerCase().includes(q));
  $('#list').innerHTML = items.length ? items.map((r) => '<button class="req' + (current === r.id ? ' on' : '') + '" data-id="' + esc(r.id) + '"><div class="n">' + esc(r.name) + '' + '</div><div class="s">' + esc(r.branches.join('、') || '无分支') + (r.last ? ' · ' + r.last : '') + '</div><div class="dots">' + D.kinds.map((k) => '<span class="dot' + (r.stages[k.kind] ? ' y' : '') + '" title="' + k.label + '"></span>').join('') + '</div></button>').join('') : '<div class="empty">没有匹配的需求</div>';
  document.querySelectorAll('.req').forEach((b) => (b.onclick = () => select(b.dataset.id)));
}

function reviewBlock(r) {
  const rs = r.artifacts.filter((a) => a.kind === 'review');
  if (!rs.length) return '';
  const row = (a) => { const v = a.review; const f = v.follow_up;
    return '<tr><td><a href="#" data-doc="' + esc(a.path) + '">' + esc(a.file) + '</a></td><td>' + esc(a.date || '') + '</td><td>' + (v.is_rereview ? '复审' : '首次') + '</td>'
      + '<td><span class="lv c">' + v.levels.CRITICAL + '</span> <span class="lv h">' + v.levels.HIGH + '</span> ' + v.levels.MEDIUM + ' / ' + v.levels.LOW + '</td>'
      + '<td>✅ ' + v.verified + ' · ⚠ ' + v.pending + '</td><td>' + (v.is_rereview ? '<span class="lv f">已修复 ' + f.fixed + '</span> 仍存在 ' + f.open + ' · 不再适用 ' + f.obsolete : '—') + '</td><td>' + esc(dnLabel[a.docnexus] ?? '—') + '</td></tr>'; };
  return '<section class="block"><h3>审查记录</h3><table><thead><tr><th>报告</th><th>日期</th><th>轮次</th><th>CRITICAL · HIGH · MEDIUM / LOW</th><th>复核</th><th>与上次对比</th><th>DocNexus</th></tr></thead><tbody>' + rs.map(row).join('') + '</tbody></table></section>';
}

function runBlock(r) {
  if (!r.runs?.length) return '';
  const labels = { running: '进行中', waiting_user: '等待用户', blocked: '受阻', completed: '已完成', cancelled: '已取消' };
  const stepLabels = { pending: '未开始', in_progress: '进行中', completed: '已完成', skipped: '已跳过' };
  return '<section class="block"><h3>流程运行状态</h3><table><thead><tr><th>运行 / 分支</th><th>阶段</th><th>状态</th><th>步骤进度</th><th>等待 / 阻塞 / 完成时间</th></tr></thead><tbody>' + r.runs.map((run) => '<tr><td>' + esc(run.project + ' · ' + run.kind + ' · ' + run.id) + '<br>' + esc(run.branch) + '</td><td>' + esc(run.stage) + '</td><td>' + esc(labels[run.status] ?? run.status) + '</td><td>' + Object.entries(run.steps).map(([name, s]) => esc(name + '：' + (stepLabels[s.status] ?? s.status))).join('<br>') + '</td><td>' + esc(run.pending_finalization ? '待恢复产物收尾：' + run.pending_finalization.kind + '（artifact.mjs resume --id ' + run.id + '）' : run.waiting_for ?? run.reason ?? run.completed_at ?? '') + '</td></tr>').join('') + '</tbody></table></section>';
}

function knowledgeBlock(r) {
  if (!r.docnexus.length) return '';
  return '<section class="block"><h3>沉淀到的知识文档</h3><table><thead><tr><th>知识文档</th><th>来自产物</th></tr></thead><tbody>' + r.docnexus.map((d) => '<tr><td><code>' + esc(d.path) + '</code></td><td>' + d.from.map((f) => '<a href="#" data-doc="' + esc(f.path) + '">' + esc(f.label + ' · ' + f.file) + '</a>').join('<br>') + '</td></tr>').join('') + '</tbody></table></section>';
}

// 知识文档 → 来源产物：跨需求的反向索引，可按路径 / 需求名过滤
function knowledgeView() {
  current = null; renderList();
  try { history.replaceState(null, '', '#knowledge'); } catch {}
  const draw = () => {
    const q = ($('#kq').value || '').trim().toLowerCase();
    const rows = D.knowledge.filter((k) => !q || (k.path + ' ' + k.sources.map((s) => s.name).join(' ')).toLowerCase().includes(q));
    $('#kt').innerHTML = rows.length ? rows.map((k) => '<tr><td><code>' + esc(k.path) + '</code></td><td>' + k.sources.map((s) => '<a href="#" data-req="' + esc(s.requirement) + '" data-doc="' + esc(s.path) + '">' + esc(s.name + ' · ' + s.label + ' · ' + s.file) + '</a>').join('<br>') + '</td></tr>').join('') : '<tr><td colspan="2" class="empty">' + (D.knowledge.length ? '没有匹配的知识文档' : '还没有产物记录沉淀（产物里的「DocNexus：」行写了 docnexus/library/… 才会出现在这里）') + '</td></tr>';
    document.querySelectorAll('#kt [data-req]').forEach((el) => (el.onclick = (e) => { e.preventDefault(); select(el.dataset.req, el.dataset.doc); }));
  };
  $('#main').innerHTML = overview() + '<h2>知识文档 → 来源产物</h2><div class="sub">汇总各产物里的「DocNexus：」行，看每篇知识文档是从哪个需求、哪份产物沉淀的</div><input id="kq" placeholder="按知识文档路径或需求名过滤" style="width:100%;max-width:420px;padding:7px 10px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--text);font:inherit;margin-bottom:10px"><table><thead><tr><th>知识文档</th><th>来源产物</th></tr></thead><tbody id="kt"></tbody></table>';
  $('#kq').oninput = draw; draw();
}

function deliveryBlock(r) {
  const ds = r.artifacts.filter((a) => a.kind === 'delivery');
  if (!ds.length) return '';
  return '<section class="block"><h3>交付记录</h3><table><thead><tr><th>交付说明</th><th>日期</th><th>类型</th><th>规模</th><th>确认的决定</th><th>未验证项</th><th>DocNexus</th></tr></thead><tbody>' + ds.map((a) => { const d = a.delivery;
    return '<tr><td><a href="#" data-doc="' + esc(a.path) + '">' + esc(a.file) + '</a></td><td>' + esc(a.date || '') + '</td><td>' + (d.type === 'bug' ? '缺陷修复' : d.type === 'feature' ? '功能开发' : '—') + '</td><td>' + (d.scale || '—') + '</td><td>' + d.decisions + '</td><td>' + (d.has_unverified ? '<span class="lv h">有</span>' : '无') + '</td><td>' + esc(dnLabel[a.docnexus] ?? '—') + '</td></tr>'; }).join('') + '</tbody></table></section>';
}

function select(id, docPath) {
  current = id; const r = D.requirements.find((x) => x.id === id);
  if (!r) return;
  try { history.replaceState(null, '', '#' + encodeURIComponent(id)); } catch {}
  const latest = (k) => r.artifacts.filter((a) => a.kind === k).at(-1);
  const pipeline = '<div class="pipeline">' + D.kinds.map((k) => { const a = latest(k.kind); const n = r.stages[k.kind];
    return '<div class="stage' + (n ? ' y' : '') + '"><div class="t">' + k.label + '</div><div class="c">' + (n ? (a && a.version > 1 ? 'v' + a.version : '✓') + (a && a.date ? ' · ' + a.date : '') : '—') + '</div>' + (a && a.wiki ? '<div class="t">wiki ' + (a.wiki.url ? '<a href="' + esc(a.wiki.url) + '" target="_blank" rel="noopener">pageId ' + esc(a.wiki.pageId) + '</a>' : 'pageId ' + esc(a.wiki.pageId)) + '</div>' : '') + '</div>'; }).join('') + '</div>';
  const order = D.kinds.map((k) => k.kind);
  const files = '<div class="files">' + r.artifacts.slice().sort((x, y) => order.indexOf(x.kind) - order.indexOf(y.kind)).map((a) => '<button data-doc="' + esc(a.path) + '">' + esc(a.label) + ' · ' + esc(a.file) + '</button>').join('') + '</div>';
  $('#main').innerHTML = overview() + '<h2>' + esc(r.name) + '</h2><div class="sub">' + esc(r.dir ?? '') + (r.projects.length ? ' · 项目 ' + esc(r.projects.join('、')) : '') + ' · 分支 ' + esc(r.branches.join('、') || '无') + (r.named_by === 'branch' ? ' · <span class="tag">需求名由分支名生成，可在 meta.json 改</span>' : '') + '</div>'
    + pipeline + runBlock(r) + reviewBlock(r) + deliveryBlock(r) + knowledgeBlock(r) + files + '<div class="doc" id="doc"></div>';
  document.querySelectorAll('[data-doc]').forEach((el) => (el.onclick = (e) => { e.preventDefault(); showDoc(r, el.dataset.doc); }));
  const selected = docPath || (latest('review') || r.artifacts.at(-1))?.path;
  if (selected) showDoc(r, selected);
  else $('#doc').innerHTML = '<div class="empty">运行进度已保存，尚未生成文档。</div>';
  renderList();
}

function showDoc(r, p) {
  const a = r.artifacts.find((x) => x.path === p); if (!a) return;
  currentDoc = p;
  document.querySelectorAll('.files button').forEach((b) => b.classList.toggle('on', b.dataset.doc === p));
  $('#doc').innerHTML = '<div class="path">' + esc(a.cite) + (a.wiki ? ' · 已发布 wiki pageId ' + esc(a.wiki.pageId) : '') + '</div>' + md(a.text);
}

$('#q').oninput = renderList;
$('#kb').onclick = knowledgeView;
const fromHash = decodeURIComponent(location.hash.slice(1));
if (fromHash === 'knowledge') knowledgeView();
else if (D.requirements.length) select(D.requirements.some((r) => r.id === fromHash) ? fromHash : D.requirements[0].id);
else { $('#main').innerHTML = overview() + '<div class="empty">还没有产物。dev 交付、审查报告、技术方案、上线方案落盘到 workflow-run/docs/requirements/&lt;需求名&gt;/ 后，重新生成这个页面。</div>'; renderList(); }
</script>
</body>
</html>
`;
}

export function main(argv) {
  let root = process.cwd();
  let out = null;
  let open = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = path.resolve(argv[++i] ?? '.');
    else if (argv[i] === '--out') out = argv[++i] ?? null;
    else if (argv[i] === '--open') open = true;
    else { console.error('用法: view.mjs [--out <文件>] [--open]'); return 1; }
  }
  const file = path.resolve(root, out ?? DEFAULT_OUT);
  const data = viewData(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderHtml(data));
  const n = data.requirements.length;
  const shown = path.relative(root, file).split(path.sep).join('/');
  console.log(`已生成 ${shown && !shown.startsWith('..') ? shown : file}（${n} 个需求，${data.requirements.reduce((s, r) => s + r.artifacts.length, 0)} 份产物）。用浏览器打开即可，只读、不联网。`);
  if (open) {
    const [cmd, args] = process.platform === 'darwin' ? ['open', [file]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', file]] : ['xdg-open', [file]];
    spawnSync(cmd, args, { stdio: 'ignore' });
  }
  return 0;
}

const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exit(main(process.argv.slice(2)));
