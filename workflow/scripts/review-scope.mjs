#!/usr/bin/env node
// 审查范围：由脚本决定审哪些文件、跳过哪些（带原因）、每个文件看审查清单的哪几节，不让模型自己挑着看。
// project-review 第 1 步与 dev 自审（F7）使用；报告里每个文件都要有交代（已审 / 跳过的原因 / 没审完）。
//   - 范围：分支对比 `--diff <base>...<head>`（读 <head>），或 `--base <分支>`：相对合并基点的已提交 + 未提交 + 未跟踪改动（读工作区）
//   - 跳过：删除、二进制、敏感文件（不读内容）、依赖目录、生成文件与锁文件、文档、本工具的产物；画像 review.include 可以把后三类加回来
//   - 风险 P0 / P1 / P2 与分批：规则同 project-review/references/diff-strategy.md
//   - 清单路由：按文件类型和改动内容给出审查清单的小节号；画像 review.rules 里按路径匹配的项目规则一起给出
// `rules <文件…>` 打印这些文件要看的清单小节原文和项目规则：清单用 resolveTemplate 取 project-review 的 checklist.md（团队在 DocNexus 改过的版本也适用）。
// 只有 project-review 和 dev 自审会调用 rules，project-review 没装时它报错退出（resolveTemplate 提示没有安装）。
//
// 用法（在项目根执行；--root 可指定项目根）：
//   node .agents/skills/workflow/scripts/review-scope.mjs --diff <base>...<head> [--exclude a,b]
//   node .agents/skills/workflow/scripts/review-scope.mjs [--base <分支>] [--exclude a,b]     # 缺省基线取画像 main_branch（再缺省 main）
//   node .agents/skills/workflow/scripts/review-scope.mjs rules <文件> [<文件>…]
// 输出 JSON（rules 输出 Markdown）。退出码：0 正常；1 参数错误或 git 失败

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readProfile } from '../lib/project.mjs';
import { resolveTemplate } from './resolve.mjs';

const git = (root, args) => spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const toPosix = (p) => p.split(path.sep).join('/');

// ---------------------------------------------------------------- glob
// ** 跨目录、* 不跨 /、? 单个字符、{a,b} 展开（括号里同样支持这些写法）；不含 / 的模式匹配文件名（同 .gitignore）。不区分大小写。
// 没有闭合的 { 按普通字符处理（画像里写错也不会卡住）
function globSource(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    const end = c === '{' ? glob.indexOf('}', i) : -1;
    if (c === '*' && glob[i + 1] === '*') {
      const slash = glob[i + 2] === '/';
      re += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (end > i) { re += `(?:${glob.slice(i + 1, end).split(',').map(globSource).join('|')})`; i = end; }
    else re += c.replace(/[.+^$(){}|[\]\\]/g, '\\$&');
  }
  return re;
}
export const globToRegExp = (glob) => new RegExp(`^${globSource(glob)}$`, 'i');
export const matchGlob = (p, glob) => globToRegExp(glob).test(glob.includes('/') ? p : p.split('/').pop());
const matchAny = (p, globs = []) => globs.find((g) => matchGlob(p, g)) ?? null;

// ---------------------------------------------------------------- 跳过规则
const SECRET = ['**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/*.p12', '**/*.pfx', '**/*.jks', '**/*.keystore', '**/id_rsa*', '**/id_dsa*', '**/id_ecdsa*', '**/id_ed25519*', '**/.ssh/**', '**/.netrc', '**/.npmrc', '**/.pypirc', '**/database-query/config.json', '**/wiki-config.json'];
const SECRET_OK = ['**/.env.example', '**/.env.sample', '**/.env.template'];
const DEPENDENCY = ['**/node_modules/**', '**/vendor/**', '**/bower_components/**', '**/target/**', '**/.gradle/**', '**/__pycache__/**', '**/.venv/**', '**/site-packages/**', '**/.next/**', '**/.nuxt/**'];
const GENERATED = ['**/package-lock.json', '**/yarn.lock', '**/pnpm-lock.yaml', '**/go.sum', '**/Cargo.lock', '**/poetry.lock', '**/composer.lock', '**/Gemfile.lock', '**/*.min.js', '**/*.min.css', '**/*.map', '**/*.pb.go', '**/*.gen.go', '**/*.generated.*', '**/generated/**', '**/__snapshots__/**', '**/*.snap'];
const DOCS = ['**/*.md', '**/*.md.tpl', '**/*.txt', '**/*.rst', '**/*.adoc', '**/LICENSE', '**/CHANGELOG*'];
const TOOLING = ['workflow-run/**', '.agents/skills/**', '.claude/skills/**', '.qwen/skills/**', '.codebuddy/skills/**', '.codegraph/**'];
const NOTE = {
  deleted: '文件已删除，不审内容；影响面里确认没有调用方还在用它',
  binary: '二进制文件',
  secret: '敏感文件，不读内容；它出现在改动里就提醒用户确认是否误提交了凭据',
  dependency: '依赖目录',
  generated: '生成文件或锁文件；依赖变化看 pom.xml / package.json / go.mod 等清单文件',
  docs: '文档',
  tooling: 'workflow-run 的产物或已安装的 skills',
  user_exclude: '用户指定不审（--exclude 或画像 review.exclude）',
};

export function skipReason(file, { include = [], exclude = [] } = {}) {
  if (file.status === 'D') return 'deleted';
  if (file.binary) return 'binary';
  const p = file.path;
  if (matchAny(p, SECRET) && !matchAny(p, SECRET_OK)) return 'secret';
  if (matchAny(p, exclude)) return 'user_exclude';
  if (matchAny(p, include)) return null;
  if (matchAny(p, DEPENDENCY)) return 'dependency';
  if (matchAny(p, GENERATED)) return 'generated';
  if (matchAny(p, DOCS)) return 'docs';
  if (matchAny(p, TOOLING)) return 'tooling';
  return null;
}

// ---------------------------------------------------------------- 分类、风险、清单小节
const LANG = [
  [/\.(java|kt|kts|scala|groovy)$/i, 'Java / Kotlin'], [/\.go$/i, 'Go'], [/\.(ts|tsx|js|jsx|mjs|cjs|vue)$/i, 'TypeScript / JavaScript'],
  [/\.(py|pyi)$/i, 'Python'], [/\.sql$/i, 'SQL / MyBatis'],
];
const TEST = /(^|\/)(src\/test\/|tests?\/|__tests__\/)|(Test|Tests|Spec)\.(java|kt|scala|groovy|swift)$|[._-](test|spec)\.[jt]sx?$|_test\.(go|py|rs)$|(^|\/)test_[^/]*\.py$/i;
const CONFIG = /(^|\/)(application|bootstrap)[^/]*\.(ya?ml|properties)$|\.(properties|conf|ini|toml)$|(^|\/)config\/[^/]*\.(ya?ml|json)$|(^|\/)\.env\.(example|sample|template)$/i;
const BUILD = /(^|\/)(pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|package\.json|go\.mod|requirements[^/]*\.txt|pyproject\.toml|Cargo\.toml|composer\.json|Gemfile)$/i;
// 迁移目录只认 SQL 和 Flyway / Liquibase 的变更集格式；db/ 下的代码文件照常按语言判断
const SQLFILE = /\.sql$|(^|\/)(db|migration|migrations|flyway|liquibase)\/(?:[^/]+\/)*[^/]+\.(xml|ya?ml|json)$/i;
const MAPPER = /mapper[^/]*\.xml$|dao[^/]*\.xml$/i;
const DATA_OBJ = /(^|\/)(entity|entities|dto|vo|po|bo|domain|model|models|pojo|converter|convert|assembler)(\/|$)|(Entity|DTO|Dto|VO|Vo|PO|BO|Converter|Assembler|Mapping)\.(java|kt|ts|go|py)$/;
const ENTRY = /(^|\/)(controller|controllers|api|apis|endpoint|resource|resources|handler|handlers|router|routes)\/|Controller\.(java|kt)$/i;
const P1_PATH = /(^|\/)(service|services|impl|biz|manager|job|jobs|task|tasks|listener|consumer|consumers|handler|handlers|domain|entity|dto|vo|converter|repository|dao)\//i;

// 只看增删的行。MyBatis 的 ${} 不放这里（JS 模板字符串也是 ${}），Mapper XML 和 .sql 按文件类型已经是 P0
const KW = {
  p0: /@Transactional|synchronized|\.(?:try)?lock\(|ReentrantLock|@Version|BigDecimal|amount|balance|@KafkaListener|KafkaTemplate|RabbitTemplate|RocketMQ|@PreAuthorize|@Secured|ALTER TABLE|CREATE TABLE|DELETE FROM|UPDATE\s+\S+\s+SET/i,
  concurrency: /synchronized|\.(?:try)?lock\(|ReentrantLock|Atomic[A-Z]|ConcurrentHashMap|volatile|@Async|ThreadPool|Executor|CompletableFuture|go func|sync\.(Mutex|RWMutex|WaitGroup)|@Version|setnx|redisson/i,
  mq: /@KafkaListener|@RabbitListener|@RocketMQMessageListener|@JmsListener|KafkaTemplate|RabbitTemplate|RocketMQTemplate|\.send\(|callback|notify|@Transactional/i,
  sql: /\b(SELECT|INSERT|UPDATE|DELETE)\b.+\b(FROM|INTO|SET|WHERE)\b|@Select|@Update|@Insert|@Delete|createQuery|nativeQuery|jdbcTemplate/i,
  config: /@Value\s*\(|@ConfigurationProperties|@NacosValue|@ApolloConfig|getProperty\(|os\.Getenv|process\.env/,
  security: /@PreAuthorize|@Secured|permission|auth|token|password|secret|role/i,
};

// 赋值、参数、对象值等位置后面的 /…/flags 换成占位，避免模式里的关键字被当成改动内容
// 行注释（// 前要有空白或在行首，避免把 http:// 当成注释）和以 * 开头的块注释行
export const stripComments = (text) => text.split('\n').map((l) => (/^\s*(\*|\/\*)/.test(l) ? '' : l.replace(/(^|\s)\/\/.*$/, '$1'))).join('\n');
export const stripRegexLiterals = (text) => text.replace(/([=(:,[!&|?{};]\s*|return\s+)\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[a-z]*/g, '$1/re/');

export function classify(file, profileRules = []) {
  const p = file.path;
  // 注释不算；JS / TS 里的正则字面量也不算（规则脚本自己写着匹配关键字的模式，不是业务代码）
  let changed = file.changed_text ?? '';
  if (/\.(java|kt|kts|scala|groovy|go|m?[jt]sx?|cjs|vue)$/i.test(p)) changed = stripComments(changed);
  if (/\.(m?[jt]sx?|cjs|vue)$/i.test(p)) changed = stripRegexLiterals(changed);
  const hit = (k) => KW[k].test(changed);
  const lang = LANG.find(([re]) => re.test(p))?.[1] ?? (MAPPER.test(p) ? 'SQL / MyBatis' : null);
  // 构建文件先于配置判断：pyproject.toml / Cargo.toml 也是 .toml
  const kind = TEST.test(p) ? 'test' : MAPPER.test(p) || SQLFILE.test(p) ? 'sql' : BUILD.test(p) ? 'build' : CONFIG.test(p) ? 'config' : lang ? 'code' : 'other';
  const s = new Set();
  if (kind === 'test') { s.add(1); s.add(13); }
  else if (kind === 'sql') { [1, 6, 7, 12].forEach((n) => s.add(n)); }
  else if (kind === 'config') { [6, 10].forEach((n) => s.add(n)); }
  else if (kind === 'build') { s.add(6); }
  else { [1, 2, 5, 6, 7].forEach((n) => s.add(n)); }
  if (kind === 'code' || kind === 'other') {
    if (DATA_OBJ.test(p)) s.add(3);
    if (hit('concurrency')) s.add(4);
    if (hit('mq')) s.add(11);
    if (hit('sql')) s.add(12);
    if (hit('config')) s.add(10);
  }
  if (lang && kind !== 'config' && kind !== 'build') s.add(14);
  const risk = kind === 'test' ? 'P2'
    : kind === 'sql' || kind === 'config' || ENTRY.test(p) || (kind === 'code' && hit('p0')) ? 'P0'
    : P1_PATH.test(p) || DATA_OBJ.test(p) || kind === 'build' ? 'P1' : 'P2';
  const project_rules = profileRules.filter((r) => r?.path && r?.rule && matchGlob(p, r.path)).map((r) => ({ path: r.path, rule: r.rule }));
  return { kind, lang, risk, sections: [...s].sort((a, b) => a - b), ...(project_rules.length ? { project_rules } : {}) };
}

// ---------------------------------------------------------------- diff
// git diff -U0 的输出 → [{ path, old_path?, status, binary, added, deleted, hunks: [[start, end]]（新文件里新增 / 改动的行）, changed_text }]
export function parseDiff(text) {
  const files = [];
  let f = null;
  let newLine = 0;
  const strip = (s) => s.replace(/^"|"$/g, '').replace(/^[ab]\//, '');
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/.exec(line);
      f = { path: m?.[2] ?? '', old: m?.[1] ?? '', status: 'M', binary: false, added: 0, deleted: 0, hunks: [], changed: [], inHunk: false };
      files.push(f);
      continue;
    }
    if (!f) continue;
    // 进入 hunk 之后以 +/- 开头的都是内容（被删的 SQL 注释「-- x」在 diff 里就是「--- x」）
    if (f.inHunk) {
      if (line.startsWith('@@')) { /* 下面统一处理 */ }
      else if (line.startsWith('+')) { f.added++; f.changed.push(line.slice(1)); continue; }
      else if (line.startsWith('-')) { f.deleted++; f.changed.push(line.slice(1)); continue; }
      else continue;
    }
    if (line.startsWith('new file mode')) f.status = 'A';
    else if (line.startsWith('deleted file mode')) f.status = 'D';
    else if (line.startsWith('rename from ')) { f.old = line.slice(12); f.status = 'R'; }
    else if (line.startsWith('rename to ')) f.path = line.slice(10);
    else if (line.startsWith('Binary files ')) f.binary = true;
    else if (line.startsWith('--- ')) { if (line !== '--- /dev/null') f.old = strip(line.slice(4)); }
    else if (line.startsWith('+++ ')) { if (line !== '+++ /dev/null') f.path = strip(line.slice(4)); }
    else if (line.startsWith('@@')) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      newLine = Number(m?.[1] ?? 0);
      const count = m?.[2] === undefined ? 1 : Number(m[2]);
      if (count > 0) f.hunks.push([newLine, newLine + count - 1]);
      f.inHunk = true;
    }
  }
  return files.map(({ old, changed, inHunk, ...x }) => ({ ...x, ...(x.status === 'R' && old !== x.path ? { old_path: old } : {}), changed_text: changed.join('\n') }));
}

// 范围 → { ok, mode, range, ref（'WORKTREE' 或读文件用的提交）, files }
export function loadDiff(root, { diff = null, base = null } = {}) {
  if (diff) {
    if (!/\.{2,3}/.test(diff)) return { ok: false, error: '--diff 写成 <base>...<head>' };
    const head = diff.split(/\.{2,3}/)[1] || 'HEAD';
    const r = git(root, ['diff', '-U0', '-M', '--no-color', '--no-ext-diff', diff]);
    if (r.status !== 0) return { ok: false, error: r.stderr.trim() || `git diff ${diff} 失败` };
    return { ok: true, mode: 'diff', range: diff, ref: head, files: parseDiff(r.stdout) };
  }
  const b = base || readProfile(root).profile?.main_branch || 'main';
  const mb = git(root, ['merge-base', b, 'HEAD']);
  if (mb.status !== 0) return { ok: false, error: mb.stderr.trim() || `找不到 ${b} 与 HEAD 的合并基点` };
  const from = mb.stdout.trim();
  const r = git(root, ['diff', '-U0', '-M', '--no-color', '--no-ext-diff', from]);
  if (r.status !== 0) return { ok: false, error: r.stderr.trim() || `git diff ${b} 失败` };
  const files = parseDiff(r.stdout);
  // 未跟踪的新文件：git diff 看不到，按整文件新增处理
  for (const p of git(root, ['ls-files', '--others', '--exclude-standard', '-z']).stdout.split('\0').filter(Boolean)) {
    const abs = path.join(root, p);
    let buf;
    try { buf = fs.readFileSync(abs); } catch { continue; }
    const binary = buf.subarray(0, 8000).includes(0);
    const text = binary ? '' : buf.toString('utf8');
    const n = binary || !text ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    files.push({ path: toPosix(p), status: 'A', untracked: true, binary, added: n, deleted: 0, hunks: n ? [[1, n]] : [], changed_text: text });
  }
  return { ok: true, mode: 'base', range: `${b}...（含未提交与未跟踪）`, base: b, ref: 'WORKTREE', files };
}

// 文件在 ref 上的内容（WORKTREE 读磁盘）；读不到返回 null
export function readAt(root, ref, file) {
  if (ref === 'WORKTREE') { try { return fs.readFileSync(path.join(root, file), 'utf8'); } catch { return null; } }
  const r = git(root, ['show', `${ref}:${file}`]);
  return r.status === 0 ? r.stdout : null;
}

// ---------------------------------------------------------------- 分批（同 diff-strategy.md）
const FULL_FILES = 30, FULL_LINES = 1500, BATCH_FILES = 15, BATCH_LINES = 800, TOO_MANY = 500;
export function plan(review) {
  const lines = review.reduce((a, f) => a + f.added + f.deleted, 0);
  if (review.length > TOO_MANY) return { size: '过大', batches: [], hint: `排除后还有 ${review.length} 个文件：停下，请用户按模块或提交区间缩小范围` };
  const order = { P0: 0, P1: 1, P2: 2 };
  const sorted = [...review].sort((a, b) => order[a.risk] - order[b.risk] || a.path.localeCompare(b.path));
  if (review.length <= FULL_FILES && lines <= FULL_LINES) return { size: '全量精读', batches: [sorted.map((f) => f.path)] };
  const batches = [];
  let cur = [], n = 0;
  for (const f of sorted) {
    const l = f.added + f.deleted;
    if (cur.length && (cur.length >= BATCH_FILES || n + l > BATCH_LINES || cur.at(-1).risk !== f.risk)) { batches.push(cur); cur = []; n = 0; }
    cur.push(f); n += l;
  }
  if (cur.length) batches.push(cur);
  return { size: '分批精读', batches: batches.map((b) => b.map((f) => f.path)), hint: '按批次顺序精读（P0 → P1 → P2），P0 不能跳过；没读完的批次写进报告「未覆盖与待确认」' };
}

export function reviewConfig(root) {
  const r = readProfile(root).profile?.review ?? {};
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []);
  return { include: list(r.include), exclude: list(r.exclude), rules: Array.isArray(r.rules) ? r.rules : [] };
}

export function scope(root, opts = {}) {
  const d = loadDiff(root, opts);
  if (!d.ok) return d;
  const cfg = opts.config ?? reviewConfig(root);
  const exclude = [...cfg.exclude, ...(opts.exclude ?? [])];
  const review = [], skipped = [];
  for (const f of d.files) {
    const reason = skipReason(f, { include: cfg.include, exclude });
    const base = { path: f.path, ...(f.old_path ? { old_path: f.old_path } : {}), status: f.status, ...(f.untracked ? { untracked: true } : {}), added: f.added, deleted: f.deleted };
    if (reason) { skipped.push({ ...base, reason, note: NOTE[reason] }); continue; }
    review.push({ ...base, ...classify(f, cfg.rules), ...(f.added + f.deleted > BATCH_LINES ? { large: true } : {}) });
  }
  const p = plan(review);
  const count = (xs, k) => xs.reduce((m, x) => ((m[x[k]] = (m[x[k]] ?? 0) + 1), m), {});
  return {
    ok: true, mode: d.mode, range: d.range, ref: d.ref,
    summary: {
      files: d.files.length, review: review.length, skipped: skipped.length,
      lines: review.reduce((a, f) => a + f.added + f.deleted, 0), risk: count(review, 'risk'), skipped_by_reason: count(skipped, 'reason'), size: p.size,
    },
    overall_sections: review.length ? [9, 13] : [],
    review, skipped, batches: p.batches,
    ...(p.hint ? { hint: p.hint } : {}),
    next: '每个文件按 sections 过清单（rules <文件…> 打印对应小节原文和项目规则）；整个改动再过一次 overall_sections（9 影响面、13 测试）。报告「未覆盖与待确认」按 reason 汇总 skipped，没读完的文件逐个列出',
  };
}

// ---------------------------------------------------------------- rules：打印清单小节
export function checklistSections(text) {
  const out = {};
  const parts = text.replace(/\r/g, '').split(/^(?=## )/m);
  for (const part of parts) {
    const m = /^## (\d+)[.、．]/.exec(part);
    if (m) out[Number(m[1])] = part.trimEnd();
  }
  return out;
}

// 语言专项（14）只取对应语言那一条
function languageBullet(section, lang) {
  if (!section || !lang) return null;
  const head = section.split('\n')[0];
  const bullet = section.split('\n').find((l) => l.includes(`**${lang}**`));
  return bullet ? `${head}\n${bullet}` : null;
}

function readChecklist(root) {
  const t = resolveTemplate(root, 'project-review', 'checklist.md');
  if (!t.ok) return { ok: false, error: t.hint ?? t.message ?? '取不到审查清单' };
  const abs = path.resolve(root, t.path);
  for (const f of [abs, `${abs}.tpl`]) { try { return { ok: true, path: t.path, text: fs.readFileSync(f, 'utf8') }; } catch { /* 下一个 */ } }
  return { ok: false, error: `读不到审查清单 ${t.path}` };
}

// 文件在本次范围里时沿用 scope 的分类（按改动内容判断的小节一致）；不在范围里的按整个文件内容判断
export function rulesFor(root, files, { config = reviewConfig(root), checklist = readChecklist(root), inScope = [] } = {}) {
  if (!checklist.ok) return checklist;
  const secs = checklistSections(checklist.text);
  const parsed = Object.keys(secs).length > 0;
  const known = new Map(inScope.map((x) => [x.path, x]));
  const per = files.map((p) => {
    const key = toPosix(p).replace(/^\.\//, '');
    if (known.has(key)) {
      const { project_rules, ...x } = known.get(key);
      const pr = config.rules.filter((r) => r?.path && r?.rule && matchGlob(key, r.path)).map((r) => ({ path: r.path, rule: r.rule }));
      return { ...x, ...(pr.length ? { project_rules: pr } : {}) };
    }
    const f = { path: key, changed_text: (() => { try { return fs.readFileSync(path.join(root, key), 'utf8'); } catch { return ''; } })() };
    return { path: f.path, ...classify(f, config.rules) };
  });
  const nums = [...new Set(per.flatMap((x) => x.sections))].sort((a, b) => a - b);
  const langs = [...new Set(per.map((x) => x.lang).filter(Boolean))];
  const L = [`# 审查要点：${per.map((x) => x.path).join('、')}`, '', `清单：${checklist.path}`, ''];
  for (const x of per) L.push(`- ${x.path}：${x.kind}，风险 ${x.risk}，清单 ${x.sections.join(' / ')}`);
  L.push('');
  if (!parsed) L.push('（清单没有「## <编号>.」格式的小节，按整份清单检查）', '', checklist.text.trim());
  for (const n of nums) {
    if (!secs[n]) { L.push(`（清单里没有第 ${n} 节）`, ''); continue; }
    if (n === 14) { for (const lang of langs) { const b = languageBullet(secs[14], lang); if (b) L.push(b, ''); } continue; }
    L.push(secs[n], '');
  }
  const pr = per.flatMap((x) => (x.project_rules ?? []).map((r) => ({ ...r, file: x.path })));
  if (pr.length) {
    L.push('## 项目规则（workflow/profile.json 的 review.rules，和上面的清单一起检查）', '');
    for (const r of pr) L.push(`- \`${r.file}\`（匹配 \`${r.path}\`）：${r.rule}`);
  }
  return { ok: true, text: L.join('\n').trimEnd() + '\n' };
}

function main(argv) {
  let root = process.cwd();
  const o = { exclude: [] };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = path.resolve(argv[++i] ?? '.');
    else if (argv[i] === '--diff') o.diff = argv[++i] ?? null;
    else if (argv[i] === '--base') o.base = argv[++i] ?? null;
    else if (argv[i] === '--exclude') o.exclude.push(...(argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean));
    else rest.push(argv[i]);
  }
  if (rest[0] === 'rules') {
    if (rest.length < 2) { console.error('用法: review-scope.mjs rules <文件> [<文件>…]'); return 1; }
    const sc = scope(root, o);
    const r = rulesFor(root, rest.slice(1), { inScope: sc.ok ? sc.review : [] });
    if (!r.ok) { console.error(r.error); return 1; }
    process.stdout.write(r.text);
    return 0;
  }
  if (rest.length) { console.error('用法: review-scope.mjs [--diff <base>...<head> | --base <分支>] [--exclude a,b] | rules <文件…>'); return 1; }
  const r = scope(root, o);
  console.log(JSON.stringify(r, null, 2));
  return r.ok ? 0 : 1;
}

export { main };
const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exit(main(process.argv.slice(2)));
