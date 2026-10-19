// workflow/scripts/report.mjs（本地效果报告）与 pr-desc.mjs（PR / MR 描述）：都只读 workflow-run/docs/requirements/ 下的产物
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildReport, parseReview, parseDelivery, captureState } from '../workflow/scripts/report.mjs';
import { buildDescription } from '../workflow/scripts/pr-desc.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const node = (args, cwd) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });

const DELIVERY = `# 开发交付 — 支付回调幂等

> 类型：功能开发 ｜ 规模：M ｜ 日期：2026-10-15
> 对比分支：\`feature/pay\` ←→ \`main\`
> 参考产物：无
> DocNexus：docnexus/library/dev-notes/pay-idempotent.md

<!-- 模板说明 -->

## 结果 *

回调按 orderNo 去重，重复回调直接返回成功。

## 已确认的决定（如有）

- 重复回调返回成功而不是报错（用户决定）
- 去重键用 orderNo + 渠道流水号（按推荐采纳）

## 改动 *

| 文件 | 改动说明 |
|---|---|
| PayCallbackService.java | 加去重 |

## 验证 *

- 构建：mvn compile → 通过
- 测试：mvn test → 通过 12 个
- 未验证项：预发环境的真实渠道回调

## 配置清单

| key | 位置 | 用途 | 建议默认值 | 需下发环境 |
|---|---|---|---|---|
| pay.callback.dedup-ttl | apollo | 去重窗口 | 600 | prod |

## SQL 脚本（未执行）

无
`;

const REVIEW = (rereview) => `# 代码审查报告 — feature-pay

> 审查范围：分支对比：合并前 ｜ 日期：2026-10-16
> 对比分支：\`feature/pay\` ←→ \`main\`
> 审查方式：全量精读 ｜ 清单来源：skill 默认
> 参考产物：workflow-run/docs/requirements/pay/svc/delivery.md
> DocNexus：未沉淀

## 结论摘要 *

整体可合并，有 1 个 HIGH 需先修。

${rereview ? `## 与上次审查对比（如有）

| 上次 # | 问题 | 状态 | 依据 |
|---|---|---|---|
| 1 | 事务内发消息 | 已修复 | a1b2c3 |
| 2 | 缺索引 | 仍存在 | — |
| 3 | 旧字段 | 不再适用 | 已删除 |
` : ''}
## 严重问题（CRITICAL / HIGH） *

| # | 级别 | 位置 | 问题 | 触发条件 | 建议 | 复核 |
|---|---|---|---|---|---|---|
| 1 | HIGH | PayCallbackService.java:42 | 并发回调可能重复入账 | 同一回调并发两次 | 加唯一索引 | ✅ |
| 2 | CRITICAL | PayMapper.xml:10 | 金额字段截断 | 金额超过 1 万 | 改 decimal | ⚠ |

## 一般问题（MEDIUM）

| # | 位置 | 问题 | 建议 |
|---|---|---|---|
| 1 | A.java:1 | 日志缺 orderNo | 补上 |

## 优化建议（LOW）

| # | 位置 | 建议 |
|---|---|---|

## 影响面 *

影响 POST /pay/callback。

## 未覆盖与待确认 *

无
`;

function project() {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'report-')), 'svc'); fs.mkdirSync(root); // 目录名 svc = 自动取的项目名
  const g = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  g('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'init');
  const put = (rel, text) => { const [req, ...rest] = rel.split('/'); const f = path.join(root, 'workflow-run', 'docs', 'requirements', req, 'svc', ...rest); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  return { root, put, g };
}

test('parseReview / parseDelivery / captureState：按模板结构计数，跳过空表与占位符', () => {
  const r = parseReview(REVIEW(true));
  assert.deepEqual(r.levels, { CRITICAL: 1, HIGH: 1, MEDIUM: 1, LOW: 0 });
  assert.deepEqual([r.verified, r.pending], [1, 1]);
  assert.deepEqual(r.follow_up, { fixed: 1, open: 1, obsolete: 1 });
  assert.equal(parseReview(REVIEW(false)).is_rereview, false);
  assert.deepEqual(parseDelivery(DELIVERY), { type: 'feature', scale: 'M', decisions: 2, has_unverified: true });
  assert.equal(captureState(DELIVERY), 'captured');
  assert.equal(captureState(REVIEW(false)), 'not_captured');
  assert.equal(captureState('> DocNexus：未接入'), 'not_connected');
  assert.equal(captureState('# 旧报告'), 'missing');
  // 模板原样（占位符、空表）不计数
  const tpl = fs.readFileSync(path.join(REPO, 'project-review/references/report.md.tpl'), 'utf8');
  assert.deepEqual(parseReview(tpl).levels, { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 });
  const dtpl = fs.readFileSync(path.join(REPO, 'dev/references/delivery-template.md'), 'utf8');
  assert.deepEqual(parseDelivery(dtpl), { type: null, scale: null, decisions: 0, has_unverified: false });
});

test('report：汇总修复率、复核率、澄清、沉淀率、知识引用与各分支链路；--since 过滤；CLI 子命令', () => {
  const { root, put } = project();
  put('pay/delivery.md', DELIVERY);
  put('pay/review.md', REVIEW(false).replace('日期：2026-10-16', '日期：2026-10-15'));
  put('pay/review_v2.md', REVIEW(true).replace('无\n', '参考 docnexus/library/code-review/tx-mq.md\n'));
  put('pay/tech-doc.md', '# 技术方案\n> 对比分支：`feature/pay` ←→ `main`\n');
  put('old/delivery.md', '# 开发交付 — 旧\n\n> 类型：缺陷修复 ｜ 规模：S ｜ 日期：2025-01-01\n> 对比分支：`fix/old` ←→ `main`\n');
  const r = buildReport(root);
  assert.equal(r.artifacts, 5);
  assert.equal(r.review.reports, 2);
  assert.equal(r.review.rereviews, 1);
  assert.equal(r.review.fix_rate, 50);
  assert.equal(r.review.verified_rate, 50);
  assert.deepEqual([r.delivery.total, r.delivery.feature, r.delivery.bug, r.delivery.decisions], [2, 1, 1, 2]);
  assert.deepEqual([r.capture.captured, r.capture.not_captured, r.capture.missing, r.capture.capture_rate], [1, 2, 1, 33]);
  assert.equal(r.knowledge.citing, 1, 'DocNexus 元信息行不算引用');
  const pay = r.branches.find((b) => b.branch === 'feature/pay');
  assert.deepEqual([pay.has.delivery, pay.has.review, pay.has.release, pay.reviews], [true, true, false, 2]);
  assert.equal(pay.unpublished.length, 1);
  assert.equal(buildReport(root, { since: '2026-01-01' }).delivery.total, 1);

  const cli = node([path.join(REPO, 'bin/workflow-run.mjs'), 'report', '--project-root', root], root);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /复审时上次问题的修复率：50%/);
  assert.match(cli.stdout, /\| `feature\/pay`（pay） \| {2}\| ✓ \| ✓×2 \| ✓ \|/);
  const json = node([path.join(REPO, 'workflow/scripts/report.mjs'), '--json', '--since', '2026-10-16'], root);
  assert.equal(JSON.parse(json.stdout).review.reports, 1);
  assert.equal(node([path.join(REPO, 'workflow/scripts/report.mjs'), '--since', '10/16'], root).status, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('report：没有产物时给出说明', () => {
  const { root } = project();
  const out = node([path.join(REPO, 'workflow/scripts/report.mjs')], root);
  assert.equal(out.status, 0);
  assert.match(out.stdout, /还没有产物/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('pr-desc：有交付说明与审查报告时汇总；没有时退回用 git 记录', () => {
  const { root, put, g } = project();
  put('pay/delivery.md', DELIVERY);
  put('pay/review.md', REVIEW(true));
  const d = buildDescription(root, 'feature/pay', 'main').markdown;
  assert.match(d, /## 做了什么\n\n回调按 orderNo 去重/);
  assert.match(d, /## 已确认的决定\n\n- 重复回调返回成功/);
  assert.match(d, /## 上线注意（配置 \/ SQL）\n\n\| key/);
  assert.doesNotMatch(d, /SQL 脚本（未执行）/, 'SQL 为「无」时不输出');
  assert.doesNotMatch(d, /模板说明/, 'HTML 注释不输出');
  assert.match(d, /CRITICAL \/ HIGH（2 条）/);
  assert.match(d, /## 影响面\n\n影响 POST \/pay\/callback/);
  assert.match(d, /- 交付说明：`workflow-run\/docs\/requirements\/pay\/svc\/delivery\.md`/);

  g('checkout', '-q', '-b', 'fix/small');
  fs.writeFileSync(path.join(root, 'a.txt'), 'x\n');
  g('add', 'a.txt');
  g('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'fix: 修正金额展示');
  const r = node([path.join(REPO, 'workflow/scripts/pr-desc.mjs'), '--base', 'main'], root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /## 提交\n\n- fix: 修正金额展示/);
  assert.match(r.stdout, /a\.txt/);
  assert.match(r.stdout, /没有落盘的交付说明/);
  const out = node([path.join(REPO, 'workflow/scripts/pr-desc.mjs'), '--branch', 'feature/pay', '--out', 'tmp/pr.md'], root);
  assert.equal(out.status, 0, out.stderr);
  assert.match(fs.readFileSync(path.join(root, 'tmp/pr.md'), 'utf8'), /## 做了什么/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('report --all-branches：只读扫描本地分支里提交过、还没合并的产物；同一路径以工作区为准', () => {
  const { root, put, g } = project();
  const commit = (m) => g('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', m);
  put('pay/delivery.md', DELIVERY);
  g('add', '-A'); commit('main 上已合并的交付');
  g('checkout', '-q', '-b', 'feature/coupon');
  put('coupon/review.md', REVIEW(false).replaceAll('feature/pay', 'feature/coupon'));
  g('add', '-A'); commit('特性分支上的审查报告');
  g('checkout', '-q', 'main');
  put('pay/delivery.md', DELIVERY.replace('规模：M', '规模：L')); // 工作区里改过，未提交
  const only = buildReport(root);
  assert.deepEqual([only.artifacts, only.review.reports, only.scanned_branches.length], [1, 0, 0]);
  const all = buildReport(root, { allBranches: true });
  assert.deepEqual([all.artifacts, all.review.reports, all.from_branches], [2, 1, 1]);
  assert.equal(all.delivery.scale.L, 1, '同一路径取工作区版本');
  assert.ok(all.branches.some((b) => b.branch === 'feature/coupon' && b.has.review));
  assert.equal(fs.readFileSync(path.join(root, 'workflow-run/docs/requirements/pay/svc/delivery.md'), 'utf8').includes('规模：L'), true, '不改工作区');
  const cli = node([path.join(REPO, 'bin/workflow-run.mjs'), 'report', '--all-branches', '--project-root', root], root);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /范围：工作区 \+ 2 个本地分支（其中 1 份只在分支里）/);
  assert.match(node([path.join(REPO, 'workflow/scripts/report.mjs')], root).stdout, /加 `--all-branches` 一起统计/);
  fs.rmSync(root, { recursive: true, force: true });
});
