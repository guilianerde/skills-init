// workflow/scripts/review-scope.mjs（审查范围、跳过原因、风险分批、清单路由）与 locate.mjs（按原代码片段定位行号）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { matchGlob, globToRegExp, parseDiff, scope, plan, rulesFor, checklistSections, classify, stripRegexLiterals } from '../workflow/scripts/review-scope.mjs';
import { locate, snippetLines, findAll } from '../workflow/scripts/locate.mjs';
import { useLocalDocNexus } from './helpers/docnexus-pkg.mjs';

// 必装组件 DocNexus 用本地夹具接入：不依赖 npm registry，也不写用户的 ~/.npm。
useLocalDocNexus();

const REPO = fileURLToPath(new URL('..', import.meta.url));
const CHECKLIST = fs.readFileSync(path.join(REPO, 'project-review/references/checklist.md.tpl'), 'utf8');
const NO_CFG = { include: [], exclude: [], rules: [] };

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-scope-'));
  const g = (...a) => { const r = spawnSync('git', a, { cwd: root, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  g('init', '-q', '-b', 'main'); g('config', 'user.name', 't'); g('config', 'user.email', 't@example.com');
  put('src/main/java/com/x/util/Old.java', 'class Old {}\n');
  put('src/main/java/com/x/util/Moved.java', 'class Moved {\n  int a;\n  int b;\n  int c;\n}\n');
  put('db/V1__init.sql', '-- create order\nCREATE TABLE t_order (id BIGINT);\n');
  put('src/main/java/com/x/order/service/OrderService.java', 'class OrderService {\n  void pay() {\n    return;\n  }\n}\n');
  g('add', '-A'); g('commit', '-qm', 'base');
  g('checkout', '-qb', 'feature');
  put('src/main/java/com/x/order/controller/OrderController.java', 'class OrderController {\n  @GetMapping("/orders")\n  List<Order> list() { return service.list(); }\n}\n');
  put('src/main/java/com/x/order/service/OrderService.java', 'class OrderService {\n  void pay(BigDecimal amount) {\n    if (amount == null) return;\n    return;\n  }\n}\n');
  put('src/main/java/com/x/order/entity/Order.java', 'class Order {\n  Long id;\n}\n');
  put('src/main/resources/mapper/OrderMapper.xml', '<mapper>\n  <select id="list">SELECT * FROM t_order ORDER BY id</select>\n</mapper>\n');
  put('src/main/resources/application.yml', 'order:\n  page-size: 20\n');
  put('src/test/java/com/x/order/OrderServiceTest.java', 'class OrderServiceTest {}\n');
  put('db/V1__init.sql', 'CREATE TABLE t_order (id BIGINT);\n');
  put('README.md', '# demo\n');
  put('package-lock.json', '{}\n');
  put('.env', 'TOKEN=x\n');
  fs.writeFileSync(path.join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1]));
  fs.rmSync(path.join(root, 'src/main/java/com/x/util/Old.java'));
  fs.mkdirSync(path.join(root, 'src/main/java/com/x/common'), { recursive: true });
  fs.renameSync(path.join(root, 'src/main/java/com/x/util/Moved.java'), path.join(root, 'src/main/java/com/x/common/Moved.java'));
  g('add', '-A'); g('commit', '-qm', 'feature');
  return { root, g, put };
}

test('glob：** 跨目录、* 不跨 /、{a,b}、不含 / 时匹配文件名、不区分大小写', () => {
  assert.ok(matchGlob('src/a/b/C.tsx', '**/*.{ts,tsx}'));
  assert.ok(matchGlob('C.ts', '**/*.ts'));
  assert.ok(!matchGlob('src/a/C.ts', 'src/*.ts'));
  assert.ok(matchGlob('a/b/yarn.lock', 'yarn.lock'));
  assert.ok(matchGlob('src/main/resources/mapper/OrderMapper.XML', '**/*mapper.xml'));
  assert.ok(matchGlob('.env', '**/.env'));
  assert.ok(matchGlob('src/x/y/a.js', '{src/**,lib}/*.js'), '括号里的 ** 也跨目录');
  assert.ok(!matchGlob('lib/x/a.js', '{src/**,lib}/*.js'));
  // 没闭合的 { 按普通字符处理，不能卡死
  assert.equal(String(globToRegExp('src/{a,b.java')), String(/^src\/\{a,b\.java$/i));
  assert.ok(matchGlob('src/{a', 'src/{a'));
});

test('classify：db/ 下的代码按语言判断；迁移目录的 XML / YAML 算 SQL；构建文件先于配置；.md.tpl 是文档', () => {
  const c = (p, t = '') => classify({ path: p, changed_text: t });
  assert.deepEqual([c('src/main/java/com/x/db/DbUtil.java').kind, c('src/main/java/com/x/db/DbUtil.java').sections], ['code', [1, 2, 5, 6, 7, 14]]);
  assert.equal(c('src/main/resources/db/changelog/V1.xml').kind, 'sql');
  assert.equal(c('db/migration/V2__add_col.sql').kind, 'sql');
  assert.deepEqual([c('pyproject.toml').kind, c('pyproject.toml').risk], ['build', 'P1']);
  assert.equal(c('Cargo.toml').kind, 'build');
  assert.equal(c('conf/app.toml').kind, 'config');
});

test('classify：JS / TS 里正则字面量中的关键字不算改动内容；注解和字符串照常算', () => {
  const rules = "const KW = {\n  p0: /@Transactional|BigDecimal|@KafkaListener/i,\n};\nif (/ReentrantLock/.test(x)) return;";
  assert.equal(stripRegexLiterals(rules).includes('BigDecimal'), false);
  assert.equal(stripRegexLiterals('const r = a / b / c;'), 'const r = a / b / c;', '除法不动');
  assert.equal(classify({ path: 'a.mjs', changed_text: "const LOCKS = ['yarn.lock', 'Cargo.lock'];\n// 加锁时注意 BigDecimal" }).risk, 'P2', '文件名里的 .lock 和注释不算');
  assert.equal(classify({ path: 'A.java', changed_text: 'lock.lock();\nString u = "http://x"; // 普通注释' }).sections.includes(4), true, '.lock( 调用照常算并发');
  const js = classify({ path: 'scripts/rules.mjs', changed_text: rules });
  assert.deepEqual([js.risk, js.sections.includes(4), js.sections.includes(11)], ['P2', false, false]);
  const java = classify({ path: 'src/main/java/com/x/OrderListener.java', changed_text: '@KafkaListener(topics = "order")\nvoid on(BigDecimal amount) {}' });
  assert.deepEqual([java.risk, java.sections.includes(11)], ['P0', true]);
});

test('parseDiff：hunk 里被删的「-- 注释」算删除行，不当成文件头；记录新文件里改动的行段', () => {
  const files = parseDiff([
    'diff --git a/db/V1.sql b/db/V1.sql', 'index 1..2 100644', '--- a/db/V1.sql', '+++ b/db/V1.sql',
    '@@ -1 +0,0 @@', '--- create order', '@@ -3,0 +3,2 @@', '+a', '+b',
  ].join('\n'));
  assert.equal(files.length, 1);
  assert.deepEqual([files[0].path, files[0].added, files[0].deleted], ['db/V1.sql', 2, 1]);
  assert.deepEqual(files[0].hunks, [[3, 4]]);
});

test('scope --diff：跳过原因、风险、清单小节、重命名', () => {
  const { root } = repo();
  const r = scope(root, { diff: 'main...feature', config: NO_CFG });
  assert.ok(r.ok, r.error);
  const by = Object.fromEntries(r.review.map((f) => [f.path, f]));
  const skip = Object.fromEntries(r.skipped.map((f) => [f.path, f.reason]));
  assert.deepEqual(skip, {
    'src/main/java/com/x/util/Old.java': 'deleted', 'README.md': 'docs', 'package-lock.json': 'generated', '.env': 'secret', 'logo.png': 'binary',
  });
  const ctl = by['src/main/java/com/x/order/controller/OrderController.java'];
  assert.deepEqual([ctl.risk, ctl.kind, ctl.lang], ['P0', 'code', 'Java / Kotlin']);
  const svc = by['src/main/java/com/x/order/service/OrderService.java'];
  assert.equal(svc.risk, 'P0', 'BigDecimal / amount 命中 P0 关键字');
  assert.deepEqual(by['src/main/java/com/x/order/entity/Order.java'].sections, [1, 2, 3, 5, 6, 7, 14]);
  assert.deepEqual([by['src/main/resources/mapper/OrderMapper.xml'].kind, by['src/main/resources/mapper/OrderMapper.xml'].risk], ['sql', 'P0']);
  assert.ok(by['src/main/resources/mapper/OrderMapper.xml'].sections.includes(12));
  assert.deepEqual(by['src/main/resources/application.yml'].sections, [6, 10]);
  assert.deepEqual([by['src/test/java/com/x/order/OrderServiceTest.java'].kind, by['src/test/java/com/x/order/OrderServiceTest.java'].risk], ['test', 'P2']);
  assert.equal(by['src/main/java/com/x/common/Moved.java'].old_path, 'src/main/java/com/x/util/Moved.java');
  assert.equal(by['db/V1__init.sql'].deleted, 1);
  assert.deepEqual(r.overall_sections, [9, 13]);
  assert.equal(r.summary.size, '全量精读');
  assert.equal(r.batches.length, 1);
  const risks = r.batches[0].map((p) => by[p].risk);
  assert.deepEqual(risks, [...risks].sort(), 'P0 → P1 → P2');
});

test('scope --base：含未提交与未跟踪的新文件；--exclude 与画像 include / exclude', () => {
  const { root, put } = repo();
  put('src/main/java/com/x/order/service/OrderService.java', 'class OrderService {\n  void pay(BigDecimal amount) {\n    if (amount == null) return;\n    log.info("pay");\n    return;\n  }\n}\n');
  put('src/main/java/com/x/order/job/NewJob.java', 'class NewJob {\n  void run() {}\n}\n');
  put('src/main/java/com/x/unrelated/Draft.java', 'class Draft {}\n');
  const r = scope(root, { base: 'main', exclude: ['**/unrelated/**'], config: { include: ['README.md'], exclude: ['**/*.yml'], rules: [] } });
  assert.ok(r.ok, r.error);
  const by = Object.fromEntries(r.review.map((f) => [f.path, f]));
  assert.equal(by['src/main/java/com/x/order/job/NewJob.java'].untracked, true);
  assert.equal(by['src/main/java/com/x/order/job/NewJob.java'].added, 3);
  assert.ok(by['src/main/java/com/x/order/service/OrderService.java'].added >= 3, '已提交和未提交的改动都算');
  assert.ok(by['README.md'], 'include 把文档加回来');
  const skip = Object.fromEntries(r.skipped.map((f) => [f.path, f.reason]));
  assert.equal(skip['src/main/java/com/x/unrelated/Draft.java'], 'user_exclude');
  assert.equal(skip['src/main/resources/application.yml'], 'user_exclude');
  assert.equal(skip['.env'], 'secret', 'include 也加不回敏感文件');
});

test('plan：超过 30 个文件或 1500 行就按 P0 → P1 → P2 分批，每批不超过 15 个文件 / 800 行；超过 500 个文件停下', () => {
  const f = (i, risk, lines = 10) => ({ path: `f${String(i).padStart(3, '0')}`, risk, added: lines, deleted: 0 });
  const many = [...Array(20)].map((_, i) => f(i, 'P2')).concat([...Array(12)].map((_, i) => f(100 + i, 'P0')));
  const p = plan(many);
  assert.equal(p.size, '分批精读');
  assert.ok(p.batches[0].every((x) => x.startsWith('f1')), 'P0 先读');
  assert.ok(p.batches.every((b) => b.length <= 15));
  const big = plan([f(1, 'P1', 700), f(2, 'P1', 700), f(3, 'P1', 700)]);
  assert.deepEqual(big.batches.map((b) => b.length), [1, 1, 1]);
  assert.equal(plan([...Array(501)].map((_, i) => f(i, 'P2'))).size, '过大');
});

test('rules：只打印文件对应的小节，语言专项只取那一种语言，附上匹配的项目规则', () => {
  const { root } = repo();
  const sc = scope(root, { diff: 'main...feature', config: NO_CFG });
  const cfg = { include: [], exclude: [], rules: [{ path: '**/*Mapper.xml', rule: '分页查询必须带 ORDER BY 主键' }, { path: '**/*.go', rule: '不相关' }] };
  const r = rulesFor(root, ['src/main/resources/mapper/OrderMapper.xml', 'src/main/resources/application.yml'], { config: cfg, checklist: { ok: true, path: 'checklist.md', text: CHECKLIST }, inScope: sc.review });
  assert.ok(r.ok);
  assert.match(r.text, /## 12\. 数据库变更安全/);
  assert.match(r.text, /## 10\. 配置/);
  assert.doesNotMatch(r.text, /## 4\. 并发/);
  assert.match(r.text, /\*\*SQL \/ MyBatis\*\*/);
  assert.doesNotMatch(r.text, /\*\*Go\*\*/);
  assert.match(r.text, /OrderMapper\.xml`（匹配 `\*\*\/\*Mapper\.xml`）：分页查询必须带 ORDER BY 主键/);
  assert.doesNotMatch(r.text, /不相关/);
  assert.deepEqual(Object.keys(checklistSections(CHECKLIST)).map(Number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  const custom = rulesFor(root, ['a.java'], { config: NO_CFG, checklist: { ok: true, path: 'c.md', text: '# 团队清单\n- 自定义一条' } });
  assert.match(custom.text, /按整份清单检查[\s\S]*自定义一条/, '团队改过、没有编号小节的清单整份给出');
});

test('locate：精确 / 忽略空白 / 单行部分匹配；去掉 diff 的 + 列；多处时优先本次改动的行；找不到给原因', () => {
  assert.deepEqual(snippetLines('\n+  a\n+  b\n \n'), ['  a', '  b']);
  assert.deepEqual(snippetLines('- item\n- other'), ['- item', '- other'], '不是从 diff 复制的不动');
  assert.deepEqual(findAll(['x', '  return;', 'y'], ['  return;']), { match: 'exact', hits: [2] });
  assert.equal(findAll(['if (a  ==  null) return;'], ['if (a == null) return;']).match, 'loose');
  assert.deepEqual(findAll(['    if (amount == null) return;'], ['amount == null']), { match: 'partial', hits: [1] });
  assert.equal(findAll(['abc'], ['abc']).match, 'exact');
  assert.equal(findAll(['return x;'], ['x;']).match, 'none', '太短的单行片段不做部分匹配');

  const { root } = repo();
  const r = locate(root, [
    { file: 'src/main/java/com/x/order/service/OrderService.java', code: '+    if (amount == null) return;' },
    { file: 'src/main/java/com/x/order/service/OrderService.java', code: '    return;' },
    { file: 'src/main/java/com/x/order/service/OrderService.java', code: 'class OrderService {', line: 1 },
    { file: 'src/main/java/com/x/order/service/OrderService.java', code: 'this line is not there' },
    { file: 'nope/A.java', code: 'x' },
  ], { diff: 'main...feature' });
  assert.ok(r.ok, r.error);
  const [a, b, c, d, e] = r.findings;
  assert.deepEqual([a.start_line, a.end_line, a.anchored, a.in_change, a.match], [3, 3, true, true, 'exact']);
  assert.deepEqual([b.start_line, b.in_change, b.ambiguous ?? false], [4, false, false], '只有一处 return; 时不算模糊');
  assert.deepEqual([c.start_line, c.in_change], [1, false]);
  assert.deepEqual([d.anchored, d.match], [false, 'none']);
  assert.match(e.reason, /读不到/);
  assert.equal(r.anchored, 3);
  // 多处匹配时按模型估的行号取最近的一处，行号写成字符串也认
  fs.writeFileSync(path.join(root, 'Sum.java'), 'class Sum {\n  total = total.add(x);\n  log();\n  total = total.add(x);\n}\n');
  const two = locate(root, [{ file: 'Sum.java', code: 'total = total.add(x);', line: '4' }], { base: 'main' });
  assert.deepEqual([two.findings[0].start_line, two.findings[0].ambiguous, two.findings[0].candidates], [4, true, [2, 4]]);
});

test('scope --base：空的未跟踪文件算 0 行', () => {
  const { root, put } = repo();
  put('src/main/java/com/x/Empty.java', '');
  const f = scope(root, { base: 'main', config: NO_CFG }).review.find((x) => x.path === 'src/main/java/com/x/Empty.java');
  assert.deepEqual([f.untracked, f.added], [true, 0]);
});

test('CLI：装好的项目里 review-scope 读画像 review 配置，rules 用 resolve.mjs 取清单，locate 读发现文件', () => {
  const { root } = repo();
  const inst = spawnSync(process.execPath, [path.join(REPO, 'bin', 'workflow-run.mjs'), '--project-root', root, '--envs', 'codex', '--yes', '--skip-db'], { cwd: root, encoding: 'utf8' });
  assert.equal(inst.status, 0, inst.stderr);
  const prof = path.join(root, '.agents/skills/workflow/profile.json');
  const p = JSON.parse(fs.readFileSync(prof, 'utf8'));
  fs.writeFileSync(prof, JSON.stringify({ ...p, main_branch: 'main', review: { exclude: ['**/entity/**'], rules: [{ path: '**/*Controller.java', rule: '接口要校验登录态' }] } }));
  const S = path.join(root, '.agents/skills/workflow/scripts');
  const run = (script, ...args) => spawnSync(process.execPath, [path.join(S, script), ...args], { cwd: root, encoding: 'utf8' });
  const sc = run('review-scope.mjs', '--diff', 'main...feature');
  assert.equal(sc.status, 0, sc.stderr);
  const out = JSON.parse(sc.stdout);
  assert.equal(out.skipped.find((f) => f.path.endsWith('Order.java'))?.reason, 'user_exclude');
  const rules = run('review-scope.mjs', 'rules', 'src/main/java/com/x/order/controller/OrderController.java', '--diff', 'main...feature');
  assert.equal(rules.status, 0, rules.stderr);
  // 模板一律从知识库取：安装已把清单导入 workflow-run/docnexus/library/
  assert.match(rules.stdout, /清单：workflow-run\/docnexus\/library\/templates\/project-review\/checklist\.md/);
  assert.match(rules.stdout, /接口要校验登录态/);
  fs.mkdirSync(path.join(root, 'workflow-run/tmp/review'), { recursive: true });
  fs.writeFileSync(path.join(root, 'workflow-run/tmp/review/findings.json'), JSON.stringify([{ file: 'src/main/resources/application.yml', code: 'page-size: 20' }]));
  const loc = run('locate.mjs', 'workflow-run/tmp/review/findings.json', '--diff', 'main...feature', '--exclude', 'x');
  assert.equal(loc.status, 0, loc.stderr);
  assert.deepEqual(JSON.parse(loc.stdout).findings[0].start_line, 2);
  assert.equal(run('locate.mjs').status, 1);
});
