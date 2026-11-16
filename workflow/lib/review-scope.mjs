import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { readProfile } from './project.mjs';
import { matchGlob } from './path-match.mjs';

const git = (root, args) => spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
});
const toPosix = (value) => value.split(path.sep).join('/');
const matchAny = (value, globs = []) => globs.find((glob) => matchGlob(value, glob)) ?? null;

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
  const filePath = file.path;
  if (matchAny(filePath, SECRET) && !matchAny(filePath, SECRET_OK)) return 'secret';
  if (matchAny(filePath, exclude)) return 'user_exclude';
  if (matchAny(filePath, include)) return null;
  if (matchAny(filePath, DEPENDENCY)) return 'dependency';
  if (matchAny(filePath, GENERATED)) return 'generated';
  if (matchAny(filePath, DOCS)) return 'docs';
  if (matchAny(filePath, TOOLING)) return 'tooling';
  return null;
}

const LANG = [
  [/\.(java|kt|kts|scala|groovy)$/i, 'Java / Kotlin'],
  [/\.go$/i, 'Go'],
  [/\.(ts|tsx|js|jsx|mjs|cjs|vue)$/i, 'TypeScript / JavaScript'],
  [/\.(py|pyi)$/i, 'Python'],
  [/\.sql$/i, 'SQL / MyBatis'],
];
const TEST = /(^|\/)(src\/test\/|tests?\/|__tests__\/)|(Test|Tests|Spec)\.(java|kt|scala|groovy|swift)$|[._-](test|spec)\.[jt]sx?$|_test\.(go|py|rs)$|(^|\/)test_[^/]*\.py$/i;
const CONFIG = /(^|\/)(application|bootstrap)[^/]*\.(ya?ml|properties)$|\.(properties|conf|ini|toml)$|(^|\/)config\/[^/]*\.(ya?ml|json)$|(^|\/)\.env\.(example|sample|template)$/i;
const BUILD = /(^|\/)(pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|package\.json|go\.mod|requirements[^/]*\.txt|pyproject\.toml|Cargo\.toml|composer\.json|Gemfile)$/i;
const SQLFILE = /\.sql$|(^|\/)(db|migration|migrations|flyway|liquibase)\/(?:[^/]+\/)*[^/]+\.(xml|ya?ml|json)$/i;
const MAPPER = /mapper[^/]*\.xml$|dao[^/]*\.xml$/i;
const DATA_OBJ = /(^|\/)(entity|entities|dto|vo|po|bo|domain|model|models|pojo|converter|convert|assembler)(\/|$)|(Entity|DTO|Dto|VO|Vo|PO|BO|Converter|Assembler|Mapping)\.(java|kt|ts|go|py)$/;
const ENTRY = /(^|\/)(controller|controllers|api|apis|endpoint|resource|resources|handler|handlers|router|routes)\/|Controller\.(java|kt)$/i;
const P1_PATH = /(^|\/)(service|services|impl|biz|manager|job|jobs|task|tasks|listener|consumer|consumers|handler|handlers|domain|entity|dto|vo|converter|repository|dao)\//i;
const KW = {
  p0: /@Transactional|synchronized|\.(?:try)?lock\(|ReentrantLock|@Version|BigDecimal|amount|balance|@KafkaListener|KafkaTemplate|RabbitTemplate|RocketMQ|@PreAuthorize|@Secured|ALTER TABLE|CREATE TABLE|DELETE FROM|UPDATE\s+\S+\s+SET/i,
  concurrency: /synchronized|\.(?:try)?lock\(|ReentrantLock|Atomic[A-Z]|ConcurrentHashMap|volatile|@Async|ThreadPool|Executor|CompletableFuture|go func|sync\.(Mutex|RWMutex|WaitGroup)|@Version|setnx|redisson/i,
  mq: /@KafkaListener|@RabbitListener|@RocketMQMessageListener|@JmsListener|KafkaTemplate|RabbitTemplate|RocketMQTemplate|\.send\(|callback|notify|@Transactional/i,
  sql: /\b(SELECT|INSERT|UPDATE|DELETE)\b.+\b(FROM|INTO|SET|WHERE)\b|@Select|@Update|@Insert|@Delete|createQuery|nativeQuery|jdbcTemplate/i,
  config: /@Value\s*\(|@ConfigurationProperties|@NacosValue|@ApolloConfig|getProperty\(|os\.Getenv|process\.env/,
  security: /@PreAuthorize|@Secured|permission|auth|token|password|secret|role/i,
};

export const stripComments = (text) => text.split('\n').map((line) => (
  /^\s*(\*|\/\*)/.test(line) ? '' : line.replace(/(^|\s)\/\/.*$/, '$1')
)).join('\n');
export const stripRegexLiterals = (text) => text.replace(/([=(:,[!&|?{};]\s*|return\s+)\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[a-z]*/g, '$1/re/');

export function classify(file, profileRules = []) {
  const filePath = file.path;
  let changed = file.changed_text ?? '';
  if (/\.(java|kt|kts|scala|groovy|go|m?[jt]sx?|cjs|vue)$/i.test(filePath)) changed = stripComments(changed);
  if (/\.(m?[jt]sx?|cjs|vue)$/i.test(filePath)) changed = stripRegexLiterals(changed);
  const hit = (key) => KW[key].test(changed);
  const lang = LANG.find(([pattern]) => pattern.test(filePath))?.[1] ?? (MAPPER.test(filePath) ? 'SQL / MyBatis' : null);
  const kind = TEST.test(filePath) ? 'test'
    : MAPPER.test(filePath) || SQLFILE.test(filePath) ? 'sql'
      : BUILD.test(filePath) ? 'build'
        : CONFIG.test(filePath) ? 'config'
          : lang ? 'code' : 'other';
  const sections = new Set();
  if (kind === 'test') { sections.add(1); sections.add(13); }
  else if (kind === 'sql') { [1, 6, 7, 12].forEach((number) => sections.add(number)); }
  else if (kind === 'config') { [6, 10].forEach((number) => sections.add(number)); }
  else if (kind === 'build') { sections.add(6); }
  else { [1, 2, 5, 6, 7].forEach((number) => sections.add(number)); }
  if (kind === 'code' || kind === 'other') {
    if (DATA_OBJ.test(filePath)) sections.add(3);
    if (hit('concurrency')) sections.add(4);
    if (hit('mq')) sections.add(11);
    if (hit('sql')) sections.add(12);
    if (hit('config')) sections.add(10);
  }
  if (lang && kind !== 'config' && kind !== 'build') sections.add(14);
  const risk = kind === 'test' ? 'P2'
    : kind === 'sql' || kind === 'config' || ENTRY.test(filePath) || (kind === 'code' && hit('p0')) ? 'P0'
      : P1_PATH.test(filePath) || DATA_OBJ.test(filePath) || kind === 'build' ? 'P1' : 'P2';
  const project_rules = profileRules.filter((rule) => rule?.path && rule?.rule && matchGlob(filePath, rule.path))
    .map((rule) => ({ path: rule.path, rule: rule.rule }));
  return { kind, lang, risk, sections: [...sections].sort((a, b) => a - b), ...(project_rules.length ? { project_rules } : {}) };
}

export function parseDiff(text) {
  const files = [];
  let file = null;
  let newLine = 0;
  const strip = (value) => value.replace(/^"|"$/g, '').replace(/^[ab]\//, '');
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const match = /^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/.exec(line);
      file = { path: match?.[2] ?? '', old: match?.[1] ?? '', status: 'M', binary: false, added: 0, deleted: 0, hunks: [], changed: [], inHunk: false };
      files.push(file);
      continue;
    }
    if (!file) continue;
    if (file.inHunk) {
      if (line.startsWith('@@')) { /* 下一段 hunk */ }
      else if (line.startsWith('+')) { file.added++; file.changed.push(line.slice(1)); continue; }
      else if (line.startsWith('-')) { file.deleted++; file.changed.push(line.slice(1)); continue; }
      else continue;
    }
    if (line.startsWith('new file mode')) file.status = 'A';
    else if (line.startsWith('deleted file mode')) file.status = 'D';
    else if (line.startsWith('rename from ')) { file.old = line.slice(12); file.status = 'R'; }
    else if (line.startsWith('rename to ')) file.path = line.slice(10);
    else if (line.startsWith('Binary files ')) file.binary = true;
    else if (line.startsWith('--- ')) { if (line !== '--- /dev/null') file.old = strip(line.slice(4)); }
    else if (line.startsWith('+++ ')) { if (line !== '+++ /dev/null') file.path = strip(line.slice(4)); }
    else if (line.startsWith('@@')) {
      const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      newLine = Number(match?.[1] ?? 0);
      const count = match?.[2] === undefined ? 1 : Number(match[2]);
      if (count > 0) file.hunks.push([newLine, newLine + count - 1]);
      file.inHunk = true;
    }
  }
  return files.map(({ old, changed, inHunk, ...entry }) => ({
    ...entry,
    ...(entry.status === 'R' && old !== entry.path ? { old_path: old } : {}),
    changed_text: changed.join('\n'),
  }));
}

export function loadDiff(root, { diff = null, base = null } = {}) {
  if (diff) {
    if (!/\.{2,3}/.test(diff)) return { ok: false, error: '--diff 写成 <base>...<head>' };
    const head = diff.split(/\.{2,3}/)[1] || 'HEAD';
    const result = git(root, ['diff', '-U0', '-M', '--no-color', '--no-ext-diff', diff]);
    if (result.status !== 0) return { ok: false, error: result.stderr.trim() || `git diff ${diff} 失败` };
    return { ok: true, mode: 'diff', range: diff, ref: head, files: parseDiff(result.stdout) };
  }
  const baseBranch = base || readProfile(root).profile?.main_branch || 'main';
  const mergeBase = git(root, ['merge-base', baseBranch, 'HEAD']);
  if (mergeBase.status !== 0) return { ok: false, error: mergeBase.stderr.trim() || `找不到 ${baseBranch} 与 HEAD 的合并基点` };
  const from = mergeBase.stdout.trim();
  const result = git(root, ['diff', '-U0', '-M', '--no-color', '--no-ext-diff', from]);
  if (result.status !== 0) return { ok: false, error: result.stderr.trim() || `git diff ${baseBranch} 失败` };
  const files = parseDiff(result.stdout);
  for (const entry of git(root, ['ls-files', '--others', '--exclude-standard', '-z']).stdout.split('\0').filter(Boolean)) {
    const abs = path.join(root, entry);
    let buffer;
    try { buffer = fs.readFileSync(abs); } catch { continue; }
    const binary = buffer.subarray(0, 8000).includes(0);
    const text = binary ? '' : buffer.toString('utf8');
    const count = binary || !text ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    files.push({ path: toPosix(entry), status: 'A', untracked: true, binary, added: count, deleted: 0, hunks: count ? [[1, count]] : [], changed_text: text });
  }
  return { ok: true, mode: 'base', range: `${baseBranch}...（含未提交与未跟踪）`, base: baseBranch, ref: 'WORKTREE', files };
}

export function readAt(root, ref, file) {
  if (ref === 'WORKTREE') {
    try { return fs.readFileSync(path.join(root, file), 'utf8'); } catch { return null; }
  }
  const result = git(root, ['show', `${ref}:${file}`]);
  return result.status === 0 ? result.stdout : null;
}

const FULL_FILES = 30; const FULL_LINES = 1500; const BATCH_FILES = 15; const BATCH_LINES = 800; const TOO_MANY = 500;
export function plan(review) {
  const lines = review.reduce((total, file) => total + file.added + file.deleted, 0);
  if (review.length > TOO_MANY) return { size: '过大', batches: [], hint: `排除后还有 ${review.length} 个文件：停下，请用户按模块或提交区间缩小范围` };
  const order = { P0: 0, P1: 1, P2: 2 };
  const sorted = [...review].sort((a, b) => order[a.risk] - order[b.risk] || a.path.localeCompare(b.path));
  if (review.length <= FULL_FILES && lines <= FULL_LINES) return { size: '全量精读', batches: [sorted.map((file) => file.path)] };
  const batches = [];
  let current = [];
  let count = 0;
  for (const file of sorted) {
    const linesInFile = file.added + file.deleted;
    if (current.length && (current.length >= BATCH_FILES || count + linesInFile > BATCH_LINES || current.at(-1).risk !== file.risk)) {
      batches.push(current);
      current = [];
      count = 0;
    }
    current.push(file);
    count += linesInFile;
  }
  if (current.length) batches.push(current);
  return { size: '分批精读', batches: batches.map((batch) => batch.map((file) => file.path)), hint: '按批次顺序精读（P0 → P1 → P2），P0 不能跳过；没读完的批次写进报告「未覆盖与待确认」' };
}

export function reviewConfig(root) {
  const review = readProfile(root).profile?.review ?? {};
  const list = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()) : []);
  return { include: list(review.include), exclude: list(review.exclude), rules: Array.isArray(review.rules) ? review.rules : [] };
}

export function scope(root, options = {}) {
  const diff = loadDiff(root, options);
  if (!diff.ok) return diff;
  const config = options.config ?? reviewConfig(root);
  const exclude = [...config.exclude, ...(options.exclude ?? [])];
  const review = [];
  const skipped = [];
  for (const file of diff.files) {
    const reason = skipReason(file, { include: config.include, exclude });
    const base = {
      path: file.path,
      ...(file.old_path ? { old_path: file.old_path } : {}),
      status: file.status,
      ...(file.untracked ? { untracked: true } : {}),
      added: file.added,
      deleted: file.deleted,
    };
    if (reason) { skipped.push({ ...base, reason, note: NOTE[reason] }); continue; }
    review.push({ ...base, ...classify(file, config.rules), ...(file.added + file.deleted > BATCH_LINES ? { large: true } : {}) });
  }
  const batchPlan = plan(review);
  const count = (items, key) => items.reduce((map, item) => {
    map[item[key]] = (map[item[key]] ?? 0) + 1;
    return map;
  }, {});
  return {
    ok: true,
    mode: diff.mode,
    range: diff.range,
    ref: diff.ref,
    summary: {
      files: diff.files.length,
      review: review.length,
      skipped: skipped.length,
      lines: review.reduce((total, file) => total + file.added + file.deleted, 0),
      risk: count(review, 'risk'),
      skipped_by_reason: count(skipped, 'reason'),
      size: batchPlan.size,
    },
    overall_sections: review.length ? [9, 13] : [],
    review,
    skipped,
    batches: batchPlan.batches,
    ...(batchPlan.hint ? { hint: batchPlan.hint } : {}),
    next: '每个文件按 sections 过清单（rules <文件…> 打印对应小节原文和项目规则）；整个改动再过一次 overall_sections（9 影响面、13 测试）。报告「未覆盖与待确认」按 reason 汇总 skipped，没读完的文件逐个列出',
  };
}
