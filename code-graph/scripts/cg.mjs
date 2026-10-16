#!/usr/bin/env node
// 代码图谱查询：在 CodeGraph（@colbymchenry/codegraph，MIT）的索引之上，按本工作流的需要封装几类查询，
// 并补上它看不到的 Java / Spring 关联（MQ topic、定时任务、MyBatis XML 里的表）。只读：不建索引、不改代码。
//
// 用法（在项目根执行；--root 指定项目根）：
//   node <skills>/code-graph/scripts/cg.mjs status
//   node <skills>/code-graph/scripts/cg.mjs impact --diff <base>...<head> [--depth 3]   # 已提交的分支改动（head 须是当前检出）
//   node <skills>/code-graph/scripts/cg.mjs impact --base <分支> [--depth 3]            # 与 <分支> 的分叉点到工作区（含未提交）
//   node <skills>/code-graph/scripts/cg.mjs entry <符号> [--file <路径片段>] [--depth 4] # 符号向上能到达哪些入口
//   node <skills>/code-graph/scripts/cg.mjs mq [--topic <名>]       # MQ topic 的生产方 / 消费方（扫源码，不需要索引）
//   node <skills>/code-graph/scripts/cg.mjs jobs                    # 定时任务入口（扫源码，不需要索引）
//   node <skills>/code-graph/scripts/cg.mjs tables [--table <表>]   # MyBatis XML 语句 → 表（扫源码，不需要索引）
// 输出 JSON。退出码：0 正常；1 参数错误；2 代码图谱不可用（没有 .codegraph/ 索引、找不到库、Node 版本过低），
// 输出里的 hint 说明原因，skill 据此退回 codegraph CLI 或 grep。
//
// 库的查找顺序：环境变量 CODEGRAPH_LIB（包目录）→ 项目 node_modules → npm 全局目录（--with-codegraph 装在这里）。
// 库的 Node API 需要 Node >= 22.5（node:sqlite）；CodeGraph 自己的 CLI 自带运行时，不受此限。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const IS_WIN = process.platform === 'win32';
const PKG = '@colbymchenry/codegraph';
const TESTED_MAJOR = 1;
const toPosix = (p) => p.split(path.sep).join('/');
const git = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

// ---------------------------------------------------------------- 加载库与索引

export function loadLibrary(root) {
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 22 || (maj === 22 && min < 5)) {
    return { ok: false, error: 'node_too_old', hint: `代码图谱脚本需要 Node >= 22.5（当前 ${process.versions.node}）：改用 codegraph CLI（见 workflow/references/codegraph.md）` };
  }
  const candidates = function* () {
    if (process.env.CODEGRAPH_LIB) yield process.env.CODEGRAPH_LIB;
    yield path.join(root, 'node_modules', ...PKG.split('/'));
    const g = spawnSync(IS_WIN ? 'npm.cmd' : 'npm', ['root', '-g'], { encoding: 'utf8', shell: IS_WIN });
    if (g.status === 0 && g.stdout.trim()) yield path.join(g.stdout.trim(), ...PKG.split('/'));
  };
  for (const dir of candidates()) {
    if (!fs.existsSync(path.join(dir, 'package.json'))) continue;
    try {
      const mod = createRequire(import.meta.url)(dir);
      const CodeGraph = mod.CodeGraph ?? mod.default;
      if (typeof CodeGraph?.openSync !== 'function') return { ok: false, error: 'load_failed', hint: `${dir} 不是可用的 ${PKG}（缺 CodeGraph.openSync）` };
      const version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
      return { ok: true, CodeGraph, version, from: dir };
    } catch (e) {
      return { ok: false, error: 'load_failed', hint: `加载 ${dir} 失败：${String(e.message).split('\n')[0]}` };
    }
  }
  return { ok: false, error: 'no_library', hint: `找不到 ${PKG}：重跑 skills-init 并加 --with-codegraph（全局安装），或改用 grep / 读文件` };
}

// 打开索引（只读）。索引落后于工作区时先用 codegraph CLI 增量同步（同步不是建索引；没有索引时不替用户建）
export function openGraph(root, { sync = true } = {}) {
  if (!fs.existsSync(path.join(root, '.codegraph'))) {
    return { ok: false, error: 'no_index', hint: '本项目没有 .codegraph/ 索引；是否建立由用户决定（在项目根运行 codegraph init），先改用 grep / 读文件' };
  }
  const lib = loadLibrary(root);
  if (!lib.ok) return lib;
  const warnings = [];
  if (Number(String(lib.version).split('.')[0]) !== TESTED_MAJOR) warnings.push(`已装 ${PKG} ${lib.version}，本脚本按 ${TESTED_MAJOR}.x 编写，结果可能不完整`);
  let cg;
  try { cg = lib.CodeGraph.openSync(root, { readOnly: true }); } catch (e) {
    return { ok: false, error: 'open_failed', hint: `打开索引失败：${String(e.message).split('\n')[0]}（可运行 codegraph status 检查）` };
  }
  const changed = cg.getChangedFiles?.() ?? { added: [], modified: [], removed: [] };
  const pending = changed.added.length + changed.modified.length + changed.removed.length;
  if (pending && sync) {
    cg.close();
    const r = spawnSync('codegraph', ['sync', root, '--quiet'], { cwd: root, encoding: 'utf8', shell: IS_WIN, env: { ...process.env, DO_NOT_TRACK: '1' } });
    if (r.status !== 0) warnings.push(`索引落后于工作区 ${pending} 个文件，codegraph sync 失败；涉及这些文件的结果可能过时`);
    cg = lib.CodeGraph.openSync(root, { readOnly: true });
  } else if (pending) warnings.push(`索引落后于工作区 ${pending} 个文件（未同步）`);
  return { ok: true, cg, version: lib.version, warnings };
}

// ---------------------------------------------------------------- 源码里的注解（Java / Kotlin）

const fileCache = new Map();
function lines(root, file) {
  if (!fileCache.has(file)) {
    try { fileCache.set(file, fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/)); } catch { fileCache.set(file, []); }
  }
  return fileCache.get(file);
}

// 声明行及其上方连续的注解（Java 的注解可能写在声明行之前，也可能被索引算进声明的起始行）
export function annotationsAt(root, file, startLine) {
  const ls = lines(root, file);
  let i = startLine - 1;
  let text = ls[i] ?? '';
  for (let j = i - 1; j >= 0 && j >= i - 12; j--) {
    const t = ls[j].trim();
    if (!t || t.startsWith('//') || t.endsWith(';') || t.endsWith('}') || t.endsWith('{')) break;
    text = `${ls[j]}\n${text}`;
  }
  for (let j = i + 1; j < ls.length && j <= i + 3 && /^\s*@/.test(ls[j]); j++) text += `\n${ls[j]}`;
  const out = [];
  for (const m of text.matchAll(/@(\w+)\s*(\(((?:[^()]|\([^()]*\))*)\))?/g)) out.push({ name: m[1], args: m[3] ?? '' });
  return out;
}

const strings = (s) => [...s.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
// 注解参数里指定属性的字符串值；没有属性名时取第一个位置参数
function attr(args, names) {
  for (const n of names) {
    const m = new RegExp(`\\b${n}\\s*=\\s*(\\{[^}]*\\}|"[^"]*"|[\\w.]+)`).exec(args);
    if (m) return m[1].startsWith('"') || m[1].startsWith('{') ? strings(m[1]) : [m[1]];
  }
  return /^\s*"/.test(args) ? strings(args.split(',')[0]) : [];
}

const MQ_CONSUMERS = {
  KafkaListener: ['topics', 'topicPattern'],
  RabbitListener: ['queues'],
  RocketMQMessageListener: ['topic'],
  JmsListener: ['destination'],
  StreamListener: ['value', 'target'],
};
const JOBS = { Scheduled: ['cron', 'fixedRate', 'fixedDelay', 'fixedRateString', 'fixedDelayString', 'cronString'], XxlJob: ['value'] };

// 方法所在类（向上找最近的 class 节点）的注解：RocketMQ 等把监听注解写在类上
function classAnnotations(root, cg, node) {
  const cls = cg.getNodesInFile(node.filePath).filter((n) => ['class', 'struct'].includes(n.kind) && n.startLine <= node.startLine && n.endLine >= node.endLine)
    .sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine))[0];
  return cls ? annotationsAt(root, cls.filePath, cls.startLine) : [];
}

export function entryOf(root, cg, node) {
  if (node.kind === 'route') return { type: 'route', name: node.name, file: node.filePath, line: node.startLine };
  if (!['method', 'function'].includes(node.kind)) return null;
  const anns = annotationsAt(root, node.filePath, node.startLine);
  for (const a of anns) {
    if (MQ_CONSUMERS[a.name]) return { type: 'mq_consumer', annotation: a.name, topics: attr(a.args, MQ_CONSUMERS[a.name]), handler: node.qualifiedName, file: node.filePath, line: node.startLine };
    if (JOBS[a.name]) return { type: 'job', annotation: a.name, schedule: a.args.trim(), handler: node.qualifiedName, file: node.filePath, line: node.startLine };
  }
  if (/^(onMessage|consume)$/.test(node.name)) {
    const ca = classAnnotations(root, cg, node).find((a) => MQ_CONSUMERS[a.name]);
    if (ca) return { type: 'mq_consumer', annotation: ca.name, topics: attr(ca.args, MQ_CONSUMERS[ca.name]), handler: node.qualifiedName, file: node.filePath, line: node.startLine };
  }
  return null;
}

// ---------------------------------------------------------------- 源码扫描（不需要索引）

function sourceFiles(root, exts) {
  const r = git(root, ['ls-files', '-co', '--exclude-standard', ...exts.map((e) => `*${e}`)]);
  return r.status === 0 ? r.stdout.split('\n').filter(Boolean) : [];
}

export const TEST_FILE = /(^|\/)(src\/test|tests?|__tests__)\/|(Tests?|IT)\.(java|kt)$|\.(test|spec)\.[cm]?[jt]sx?$|_test\.go$|(^|\/)test_[^/]+\.py$/;

// MyBatis XML：namespace.id → 表
export function scanTables(root) {
  const out = [];
  for (const file of sourceFiles(root, ['.xml'])) {
    const text = lines(root, file).join('\n');
    const ns = /<mapper\s+namespace\s*=\s*"([^"]+)"/.exec(text);
    if (!ns) continue;
    for (const m of text.matchAll(/<(select|insert|update|delete)\b[^>]*\bid\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
      const sql = m[3].replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ');
      const tables = [...new Set([...sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+[`"]?([A-Za-z_][\w.]*)/gi)].map((t) => t[1].toLowerCase()).filter((t) => !['select', 'set', 'where'].includes(t)))];
      out.push({ statement: `${ns[1]}.${m[2]}`, type: m[1], tables, file, line: text.slice(0, m.index).split('\n').length });
    }
  }
  return out;
}

export function scanMq(root) {
  const consumers = []; const producers = [];
  for (const file of sourceFiles(root, ['.java', '.kt'])) {
    const ls = lines(root, file);
    ls.forEach((l, i) => {
      for (const [ann, attrs] of Object.entries(MQ_CONSUMERS)) {
        if (!l.includes(`@${ann}`)) continue;
        const a = annotationsAt(root, file, i + 1).find((x) => x.name === ann);
        if (a) consumers.push({ annotation: ann, topics: attr(a.args, attrs), file, line: i + 1 });
      }
      for (const p of l.matchAll(/\b(\w*(?:[Tt]emplate|[Pp]roducer|[Ss]ender))\s*\.\s*(send|convertAndSend|syncSend|asyncSend|sendOneWay)\s*\(\s*("[^"]*"|[\w.]+)/g)) {
        producers.push({ via: `${p[1]}.${p[2]}`, topic: p[3].replace(/"/g, ''), literal: p[3].startsWith('"'), file, line: i + 1 });
      }
    });
  }
  return { consumers, producers };
}

export function scanJobs(root) {
  const jobs = [];
  for (const file of sourceFiles(root, ['.java', '.kt'])) {
    lines(root, file).forEach((l, i) => {
      for (const ann of Object.keys(JOBS)) {
        if (!new RegExp(`@${ann}\\b`).test(l)) continue;
        const a = annotationsAt(root, file, i + 1).find((x) => x.name === ann);
        jobs.push({ annotation: ann, schedule: a?.args.trim() ?? '', file, line: i + 1 });
      }
    });
  }
  return jobs;
}

// ---------------------------------------------------------------- diff → 改动的符号

// git diff -U0 的新侧行区间：{ 文件: [[起, 止], ...] }；删除的文件单列
export function parseDiff(text) {
  const files = {}; const removed = [];
  let cur = null;
  for (const l of text.split('\n')) {
    if (l.startsWith('+++ ')) { cur = l === '+++ /dev/null' ? null : l.slice(6); if (cur) files[cur] ??= []; continue; }
    if (l.startsWith('--- ') && l !== '--- /dev/null') { const from = l.slice(6); if (!text.includes(`+++ b/${from}`)) removed.push(from); continue; }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(l);
    if (h && cur) { const s = Number(h[1]); const n = h[2] === undefined ? 1 : Number(h[2]); files[cur].push([s, Math.max(s, s + n - 1)]); }
  }
  return { files, removed: [...new Set(removed)] };
}

// 按优先级取改动区间里的符号：方法 / 函数 / 配置常量 / 路由 → 字段 → 所在的类
const SYMBOL_KINDS = ['method', 'function', 'constant', 'route'];
const MEMBER_KINDS = ['field', 'property'];
const CONTAINER_KINDS = ['class', 'struct', 'interface', 'enum', 'trait'];

export function changedSymbols(nodes, ranges) {
  const hit = new Map();
  for (const [s, e] of ranges) {
    const over = nodes.filter((n) => n.startLine <= e && n.endLine >= s);
    const of = (kinds) => over.filter((n) => kinds.includes(n.kind));
    let pick = of(SYMBOL_KINDS);
    if (!pick.length) pick = of(MEMBER_KINDS);
    if (!pick.length) pick = of(CONTAINER_KINDS).sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine)).slice(0, 1);
    for (const n of pick) hit.set(n.id, n);
  }
  return [...hit.values()];
}

const short = (n) => ({ symbol: n.qualifiedName, kind: n.kind, file: n.filePath, line: n.startLine });

export function impact(root, cg, { diff, base, depth = 3, limit = 400 }) {
  const warnings = [];
  let range;
  if (diff) {
    const head = diff.split('...')[1];
    const same = git(root, ['rev-parse', head]).stdout.trim() === git(root, ['rev-parse', 'HEAD']).stdout.trim();
    if (!same) warnings.push(`${head} 不是当前检出的提交：索引反映的是工作区，行号可能对不上；先切到 ${head} 再分析更准`);
    range = [diff];
  } else {
    const mb = git(root, ['merge-base', base, 'HEAD']);
    if (mb.status !== 0) return { ok: false, error: 'bad_base', hint: `找不到 ${base} 与 HEAD 的分叉点` };
    range = [mb.stdout.trim()];
  }
  const d = git(root, ['diff', '-U0', '--no-color', '--no-ext-diff', ...range]);
  if (d.status !== 0) return { ok: false, error: 'bad_diff', hint: d.stderr.trim().split('\n')[0] };
  const { files, removed } = parseDiff(d.stdout);
  if (base) {
    // 未跟踪的新文件不在 git diff 里
    for (const f of git(root, ['ls-files', '--others', '--exclude-standard']).stdout.split('\n').filter(Boolean)) files[f] ??= [[1, lines(root, f).length || 1]];
  }

  // 改的是测试文件：只列进 tests，不参与向上追调用方
  const changed = []; const changedTests = [];
  for (const [file, ranges] of Object.entries(files)) {
    if (!ranges.length) continue;
    if (TEST_FILE.test(file)) { changedTests.push(file); continue; }
    for (const n of changedSymbols(cg.getNodesInFile(file), ranges)) changed.push(n);
  }
  const changedIds = new Set(changed.map((n) => n.id));

  const reached = new Map(); // id → { node, via:Set }
  let truncated = false;
  for (const c of changed) {
    for (const { node } of [{ node: c }, ...cg.getCallers(c.id, depth)]) {
      if (!reached.has(node.id)) {
        if (reached.size >= limit) { truncated = true; break; }
        reached.set(node.id, { node, via: new Set() });
      }
      reached.get(node.id).via.add(c.qualifiedName);
    }
  }

  const entries = { routes: [], mq_consumers: [], jobs: [] };
  const tests = new Set(changedTests);
  const affected = new Map();
  for (const { node, via } of reached.values()) {
    if (TEST_FILE.test(node.filePath)) { tests.add(node.filePath); continue; }
    const e = entryOf(root, cg, node);
    if (e) (e.type === 'route' ? entries.routes : e.type === 'job' ? entries.jobs : entries.mq_consumers).push({ ...e, via: [...via] });
    if (!changedIds.has(node.id) && node.kind !== 'route') {
      if (!affected.has(node.filePath)) affected.set(node.filePath, new Set());
      affected.get(node.filePath).add(node.qualifiedName);
    }
  }

  // 数据：改动符号向下调用到的 MyBatis 语句，以及直接改了的 XML 语句 → 表
  const statements = new Map(scanTables(root).map((s) => [s.statement, s]));
  const xmlNodeKey = (n) => n.qualifiedName.replace(/::/g, '.');
  const sql = new Map();
  for (const c of changed) {
    const down = c.filePath.endsWith('.xml') ? [c] : cg.getCallees(c.id, depth).map((x) => x.node);
    for (const n of down) {
      if (!n.filePath.endsWith('.xml')) continue;
      const st = statements.get(xmlNodeKey(n));
      if (st) sql.set(st.statement, { ...st, changed: changedIds.has(n.id) });
    }
  }

  return {
    ok: true,
    range: diff ?? `${base}（分叉点）→ 工作区`,
    changed: changed.map((n) => ({ ...short(n), callers: cg.getCallers(n.id, 1).length })),
    removed_files: removed,
    entry_points: entries,
    affected: [...affected].map(([file, syms]) => ({ file, symbols: [...syms] })),
    tests: [...tests].sort(),
    config_keys: changed.filter((n) => n.kind === 'constant' && /@Value:/.test(n.qualifiedName)).map((n) => n.qualifiedName.split('@Value:')[1]),
    sql: [...sql.values()],
    truncated,
    warnings,
    limits: '静态分析看不到运行时才确定的调用（Spring 注入的多实现选择、AOP、反射、配置驱动的路由）；删除的方法不在索引里，按 removed_files 和 diff 另行 grep。「没有调用方」不等于没人用。',
  };
}

export function entry(root, cg, { symbol, file, depth = 4 }) {
  let defs = symbol.includes('::') ? cg.getNodesByQualifiedName(symbol) : cg.getNodesByName(symbol.split(/[.#]/).pop());
  if (symbol.includes('.') && !symbol.includes('::')) {
    const cls = symbol.split(/[.#]/).slice(-2, -1)[0];
    const narrowed = defs.filter((n) => n.qualifiedName.includes(`::${cls}::`) || n.qualifiedName.includes(`.${cls}::`));
    if (narrowed.length) defs = narrowed;
  }
  if (file) defs = defs.filter((n) => n.filePath.includes(file));
  if (!defs.length) return { ok: false, error: 'not_found', hint: `索引里找不到 ${symbol}（拼写、文件过滤，或该文件不受支持）` };
  return {
    ok: true,
    definitions: defs.map((n) => {
      const entries = []; const tests = new Set();
      for (const { node } of [{ node: n }, ...cg.getCallers(n.id, depth)]) {
        if (TEST_FILE.test(node.filePath)) { tests.add(node.filePath); continue; }
        const e = entryOf(root, cg, node);
        if (e) entries.push(e);
      }
      return { ...short(n), entry_points: entries, tests: [...tests].sort() };
    }),
  };
}

// ---------------------------------------------------------------- CLI

function main(argv) {
  let root = process.cwd();
  const opts = {}; const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') root = path.resolve(argv[++i] ?? '.');
    else if (['--diff', '--base', '--file', '--topic', '--table'].includes(a)) opts[a.slice(2)] = argv[++i];
    else if (a === '--depth') opts.depth = Number(argv[++i]);
    else if (a === '--no-sync') opts.noSync = true;
    else pos.push(a);
  }
  const [cmd, arg] = pos;
  const print = (o) => { console.log(JSON.stringify(o, null, 2)); return o.ok === false ? (['no_index', 'no_library', 'node_too_old', 'load_failed', 'open_failed'].includes(o.error) ? 2 : 1) : 0; };
  const usage = () => { console.error('用法: cg.mjs status | impact (--diff <base>...<head> | --base <分支>) [--depth n] | entry <符号> [--file f] [--depth n] | mq [--topic t] | jobs | tables [--table t]'); return 1; };
  if (opts.depth !== undefined && !(opts.depth > 0)) return usage();

  if (cmd === 'mq') {
    const r = scanMq(root);
    const f = (t) => !opts.topic || t === opts.topic;
    return print({ ok: true, consumers: r.consumers.filter((c) => c.topics.some(f) || (!opts.topic)), producers: r.producers.filter((p) => f(p.topic)) });
  }
  if (cmd === 'jobs') return print({ ok: true, jobs: scanJobs(root) });
  if (cmd === 'tables') {
    const all = scanTables(root);
    return print({ ok: true, statements: opts.table ? all.filter((s) => s.tables.includes(opts.table.toLowerCase())) : all });
  }
  if (cmd === 'status') {
    const lib = loadLibrary(root);
    return print({ ok: true, indexed: fs.existsSync(path.join(root, '.codegraph')), library: lib.ok ? { version: lib.version, from: toPosix(lib.from) } : { error: lib.error, hint: lib.hint } });
  }
  if (cmd !== 'impact' && cmd !== 'entry') return usage();
  if (cmd === 'impact' && !opts.diff === !opts.base) return usage();
  if (cmd === 'impact' && opts.diff && !opts.diff.includes('...')) return usage();
  if (cmd === 'entry' && !arg) return usage();

  const g = openGraph(root, { sync: !opts.noSync });
  if (!g.ok) return print(g);
  try {
    const r = cmd === 'impact' ? impact(root, g.cg, opts) : entry(root, g.cg, { symbol: arg, file: opts.file, depth: opts.depth });
    if (r.ok) r.codegraph = { version: g.version, warnings: g.warnings };
    return print(r);
  } finally { g.cg.close(); }
}

const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exit(main(process.argv.slice(2)));
