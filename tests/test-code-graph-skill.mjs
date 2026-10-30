// code-graph/scripts/cg.mjs：用假的 CodeGraph 库（CODEGRAPH_LIB）验证 diff → 改动符号 → 入口 / 测试 / 表 / 配置，
// 以及只扫源码的 mq / jobs / tables。真实库的验证见 docs/integrations.md「CodeGraph」一节（CI 不装 300MB 的平台包）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseDiff, changedSymbols, annotationsAt, TEST_FILE } from '../code-graph/scripts/cg.mjs';

const SCRIPT = fileURLToPath(new URL('../code-graph/scripts/cg.mjs', import.meta.url));
const [maj, min] = process.versions.node.split('.').map(Number);
const oldNode = maj < 22 || (maj === 22 && min < 5) ? '库接口需要 Node >= 22.5' : false;

const FILES = {
  'src/main/java/com/demo/controller/OrderController.java': `package com.demo.controller;
@RestController
public class OrderController {
    @GetMapping("/order/list")
    public Object list(Long userId) {
        return orderService.listOrders(userId);
    }
}
`,
  'src/main/java/com/demo/service/OrderServiceImpl.java': `package com.demo.service;
public class OrderServiceImpl implements OrderService {
    @Value("\${order.list.max-size:100}")
    private int maxSize;
    public List<Object> listOrders(Long userId) {
        return orderMapper.selectByUser(userId, maxSize);
    }
    public void markPaid(Long orderId) {
        orderMapper.updateStatus(orderId, "PAID");
    }
}
`,
  'src/main/java/com/demo/mq/PayListener.java': `package com.demo.mq;
@RocketMQMessageListener(topic = "pay-notify", consumerGroup = "g1")
public class PayListener {
    public void onMessage(String id) { orderService.markPaid(Long.valueOf(id)); }
}
`,
  'src/main/java/com/demo/mq/PayCallbackListener.java': `package com.demo.mq;
public class PayCallbackListener {
    @KafkaListener(topics = {"pay-callback", "pay-retry"}, groupId = "g")
    public void consume(String id) { orderService.markPaid(1L); }
    public void send(String id) { kafkaTemplate.send(PayTopics.CALLBACK, id); rocketMQTemplate.syncSend("pay-notify", id); }
}
`,
  'src/main/java/com/demo/job/ExpireJob.java': `package com.demo.job;
public class ExpireJob {
    @XxlJob("orderExpireJob")
    public void run() { orderService.markPaid(1L); }
}
`,
  'src/test/java/com/demo/OrderServiceImplTest.java': `class OrderServiceImplTest { void t() { s.markPaid(1L); } }
`,
  'src/main/resources/mapper/OrderMapper.xml': `<mapper namespace="com.demo.mapper.OrderMapper">
  <select id="selectByUser" resultType="map">
    SELECT o.* FROM t_order o LEFT JOIN t_user u ON u.id = o.user_id <!-- FROM t_comment -->
  </select>
  <update id="updateStatus">UPDATE t_order SET status = #{status} WHERE id = #{orderId}</update>
</mapper>
`,
};

// 假图谱：节点按文件给出，调用边写死（与上面的源码一致）
const NODES = [
  ['route', 'GET /order/list', 'src/main/java/com/demo/controller/OrderController.java::route:/order/list', 'src/main/java/com/demo/controller/OrderController.java', 4, 4],
  ['method', 'list', 'com.demo.controller::OrderController::list', 'src/main/java/com/demo/controller/OrderController.java', 4, 7],
  ['class', 'OrderServiceImpl', 'com.demo.service::OrderServiceImpl', 'src/main/java/com/demo/service/OrderServiceImpl.java', 2, 11],
  ['constant', '@Value:order.list.max-size', 'src/main/java/com/demo/service/OrderServiceImpl.java::@Value:order.list.max-size', 'src/main/java/com/demo/service/OrderServiceImpl.java', 3, 3],
  ['field', 'maxSize', 'com.demo.service::OrderServiceImpl::maxSize', 'src/main/java/com/demo/service/OrderServiceImpl.java', 4, 4],
  ['method', 'listOrders', 'com.demo.service::OrderServiceImpl::listOrders', 'src/main/java/com/demo/service/OrderServiceImpl.java', 5, 7],
  ['method', 'markPaid', 'com.demo.service::OrderServiceImpl::markPaid', 'src/main/java/com/demo/service/OrderServiceImpl.java', 8, 10],
  ['class', 'PayListener', 'com.demo.mq::PayListener', 'src/main/java/com/demo/mq/PayListener.java', 2, 5],
  ['method', 'onMessage', 'com.demo.mq::PayListener::onMessage', 'src/main/java/com/demo/mq/PayListener.java', 4, 4],
  ['method', 'consume', 'com.demo.mq::PayCallbackListener::consume', 'src/main/java/com/demo/mq/PayCallbackListener.java', 3, 4],
  ['method', 'run', 'com.demo.job::ExpireJob::run', 'src/main/java/com/demo/job/ExpireJob.java', 3, 4],
  ['method', 't', 'OrderServiceImplTest::t', 'src/test/java/com/demo/OrderServiceImplTest.java', 1, 1],
  ['method', 'selectByUser', 'com.demo.mapper.OrderMapper::selectByUser', 'src/main/resources/mapper/OrderMapper.xml', 2, 4],
  ['method', 'updateStatus', 'com.demo.mapper.OrderMapper::updateStatus', 'src/main/resources/mapper/OrderMapper.xml', 5, 5],
].map(([kind, name, qualifiedName, filePath, startLine, endLine]) => ({ id: qualifiedName, kind, name, qualifiedName, filePath, startLine, endLine }));
// 调用方 → 被调用方
const CALLS = [
  ['com.demo.controller::OrderController::list', 'com.demo.service::OrderServiceImpl::listOrders'],
  ['src/main/java/com/demo/controller/OrderController.java::route:/order/list', 'com.demo.controller::OrderController::list'],
  ['com.demo.mq::PayListener::onMessage', 'com.demo.service::OrderServiceImpl::markPaid'],
  ['com.demo.mq::PayCallbackListener::consume', 'com.demo.service::OrderServiceImpl::markPaid'],
  ['com.demo.job::ExpireJob::run', 'com.demo.service::OrderServiceImpl::markPaid'],
  ['OrderServiceImplTest::t', 'com.demo.service::OrderServiceImpl::markPaid'],
  ['com.demo.service::OrderServiceImpl::listOrders', 'com.demo.mapper.OrderMapper::selectByUser'],
  ['com.demo.service::OrderServiceImpl::markPaid', 'com.demo.mapper.OrderMapper::updateStatus'],
];

const FAKE_LIB = `const NODES = ${JSON.stringify(NODES)};
const CALLS = ${JSON.stringify(CALLS)};
const byId = new Map(NODES.map((n) => [n.id, n]));
function walk(id, depth, dir) {
  const out = []; const seen = new Set([id]); let frontier = [id];
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const f of frontier) for (const [a, b] of CALLS) {
      const [from, to] = dir === 'up' ? [b, a] : [a, b];
      if (from === f && !seen.has(to)) { seen.add(to); next.push(to); out.push({ node: byId.get(to), edge: { kind: 'calls' } }); }
    }
    frontier = next;
  }
  return out;
}
class CodeGraph {
  static openSync() { require('fs').appendFileSync(process.env.FAKE_LOG, 'open\\n'); return new CodeGraph(); }
  getChangedFiles() { return { added: [], modified: [], removed: [] }; }
  getNodesInFile(f) { return NODES.filter((n) => n.filePath === f); }
  getNodesByName(name) { return NODES.filter((n) => n.name === name); }
  getNodesByQualifiedName(q) { return NODES.filter((n) => n.qualifiedName === q); }
  getCallers(id, depth = 1) { return walk(id, depth, 'up'); }
  getCallees(id, depth = 1) { return walk(id, depth, 'down'); }
  close() {}
}
module.exports = { CodeGraph };
`;

function project() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-skill-'));
  const root = path.join(base, 'proj'); const lib = path.join(base, 'lib');
  fs.mkdirSync(lib);
  fs.writeFileSync(path.join(lib, 'package.json'), JSON.stringify({ name: '@colbymchenry/codegraph', version: '1.6.2', main: 'index.js' }));
  fs.writeFileSync(path.join(lib, 'index.js'), FAKE_LIB);
  const g = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  fs.mkdirSync(root);
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@example.com'); g('config', 'user.name', 't');
  for (const [f, text] of Object.entries(FILES)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), text); }
  g('add', '-A'); g('commit', '-qm', 'base');
  fs.mkdirSync(path.join(root, '.codegraph')); // 已建索引（内容由假库提供）
  fs.writeFileSync(path.join(root, '.git', 'info', 'exclude'), '.codegraph/\n');
  const env = { ...process.env, CODEGRAPH_LIB: lib, FAKE_LOG: path.join(base, 'fake.log') };
  const run = (...a) => { const r = spawnSync(process.execPath, [SCRIPT, ...a], { cwd: root, encoding: 'utf8', env }); return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr }; };
  return { base, root, g, run, edit: (f, from, to) => fs.writeFileSync(path.join(root, f), fs.readFileSync(path.join(root, f), 'utf8').replace(from, to)) };
}

test('parseDiff：-U0 的新侧行区间、纯删除、删除的文件', () => {
  const diff = ['diff --git a/A.java b/A.java', '--- a/A.java', '+++ b/A.java', '@@ -3 +3 @@', '@@ -10,2 +11,4 @@', '@@ -20,3 +23,0 @@',
    'diff --git a/Gone.java b/Gone.java', '--- a/Gone.java', '+++ /dev/null', '@@ -1,5 +0,0 @@'].join('\n');
  const r = parseDiff(diff);
  assert.deepEqual(r.files, { 'A.java': [[3, 3], [11, 14], [23, 23]] });
  assert.deepEqual(r.removed, ['Gone.java']);
});

test('changedSymbols：方法优先，其次字段，类体其他位置算到类上', () => {
  const n = (kind, name, s, e) => ({ id: name, kind, name, startLine: s, endLine: e });
  const nodes = [n('class', 'C', 1, 30), n('field', 'f', 3, 3), n('method', 'm', 5, 10), n('constant', '@Value:k', 2, 2)];
  assert.deepEqual(changedSymbols(nodes, [[6, 7]]).map((x) => x.name), ['m']);
  assert.deepEqual(changedSymbols(nodes, [[2, 3]]).map((x) => x.name), ['@Value:k']);
  assert.deepEqual(changedSymbols(nodes, [[3, 3]]).map((x) => x.name), ['f']);
  assert.deepEqual(changedSymbols(nodes, [[20, 21]]).map((x) => x.name), ['C']);
});

test('annotationsAt 与 TEST_FILE', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ann-'));
  fs.writeFileSync(path.join(root, 'A.java'), 'class A {\n    @Override\n    @KafkaListener(topics = {"a", "b"}, groupId = "g")\n    public void consume(String s) {}\n}\n');
  assert.deepEqual(annotationsAt(root, 'A.java', 4).map((a) => a.name), ['Override', 'KafkaListener']);
  assert.deepEqual(annotationsAt(root, 'A.java', 3).map((a) => a.name), ['Override', 'KafkaListener'], '索引把注解算进起始行时也能取到');
  for (const f of ['src/test/java/A.java', 'a/FooTest.java', 'a/FooIT.java', 'web/a.spec.ts', 'x_test.go', 'tests/test_a.py']) assert.ok(TEST_FILE.test(f), f);
  for (const f of ['src/main/java/Testing.java', 'src/main/java/Contest.java']) assert.ok(!TEST_FILE.test(f), f);
  fs.rmSync(root, { recursive: true, force: true });
});

test('impact --diff：改动 → 接口 / MQ 消费者（方法与类上的注解）/ 定时任务 / 测试 / 表 / 配置 key', { skip: oldNode }, () => {
  const p = project();
  p.g('checkout', '-q', '-b', 'feature/pay');
  p.edit('src/main/java/com/demo/service/OrderServiceImpl.java', 'orderMapper.updateStatus(orderId, "PAID");', 'if (orderId == null) return;\n        orderMapper.updateStatus(orderId, "PAID");');
  p.edit('src/main/java/com/demo/service/OrderServiceImpl.java', 'max-size:100', 'max-size:200');
  p.edit('src/test/java/com/demo/OrderServiceImplTest.java', 's.markPaid(1L);', 's.markPaid(2L);');
  p.g('commit', '-qam', 'pay');
  const r = p.run('impact', '--diff', 'main...feature/pay');
  assert.equal(r.status, 0, r.err);
  const o = r.out;
  assert.deepEqual(o.changed.map((c) => c.symbol).sort(), ['com.demo.service::OrderServiceImpl::markPaid', 'src/main/java/com/demo/service/OrderServiceImpl.java::@Value:order.list.max-size']);
  assert.deepEqual(o.config_keys, ['order.list.max-size']);
  assert.deepEqual(o.entry_points.mq_consumers.map((e) => [e.annotation, e.topics]).sort(), [['KafkaListener', ['pay-callback', 'pay-retry']], ['RocketMQMessageListener', ['pay-notify']]]);
  assert.deepEqual(o.entry_points.jobs.map((e) => [e.annotation, e.schedule]), [['XxlJob', '"orderExpireJob"']]);
  assert.deepEqual(o.entry_points.routes, [], 'markPaid 没有接口入口');
  assert.deepEqual(o.tests, ['src/test/java/com/demo/OrderServiceImplTest.java']);
  assert.deepEqual(o.sql.map((s) => [s.statement, s.tables]), [['com.demo.mapper.OrderMapper.updateStatus', ['t_order']]]);
  assert.ok(o.entry_points.mq_consumers.every((e) => e.via.includes('com.demo.service::OrderServiceImpl::markPaid')));
  assert.deepEqual(o.warnings, []);
  assert.equal(o.codegraph.version, '1.6.2');
  fs.rmSync(p.base, { recursive: true, force: true });
});

test('impact --base：含未提交改动；改到接口链路时列出路由；head 不是当前检出时警告', { skip: oldNode }, () => {
  const p = project();
  p.edit('src/main/java/com/demo/service/OrderServiceImpl.java', 'return orderMapper.selectByUser(userId, maxSize);', 'return orderMapper.selectByUser(userId, Math.min(maxSize, 50));');
  let r = p.run('impact', '--base', 'main');
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.out.changed.map((c) => c.symbol), ['com.demo.service::OrderServiceImpl::listOrders']);
  assert.deepEqual(r.out.entry_points.routes.map((e) => e.name), ['GET /order/list']);
  assert.deepEqual(r.out.sql.map((s) => [s.statement, s.tables, s.changed]), [['com.demo.mapper.OrderMapper.selectByUser', ['t_order', 't_user'], false]], 'XML 注释里的表不算');
  assert.ok(r.out.affected.some((a) => a.file.endsWith('OrderController.java')));
  p.g('stash', '-q'); p.g('checkout', '-q', '-b', 'other'); p.g('commit', '-q', '--allow-empty', '-m', 'x'); p.g('checkout', '-q', 'main');
  r = p.run('impact', '--diff', 'main...other');
  assert.match(r.out.warnings.join('\n'), /不是当前检出的提交/);
  fs.rmSync(p.base, { recursive: true, force: true });
});

test('entry：方法 → 入口；按类名收窄；找不到时退出 1', { skip: oldNode }, () => {
  const p = project();
  let r = p.run('entry', 'OrderServiceImpl.listOrders');
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.out.definitions.map((d) => [d.symbol, d.entry_points.map((e) => e.name)]), [['com.demo.service::OrderServiceImpl::listOrders', ['GET /order/list']]]);
  r = p.run('entry', 'markPaid');
  assert.deepEqual(r.out.definitions[0].tests, ['src/test/java/com/demo/OrderServiceImplTest.java']);
  assert.equal(p.run('entry', 'Nope.nope').status, 1);
  fs.rmSync(p.base, { recursive: true, force: true });
});

test('不可用时退出 2 并给出原因：没有索引；有索引但找不到库', { skip: oldNode }, () => {
  const p = project();
  fs.rmSync(path.join(p.root, '.codegraph'), { recursive: true, force: true });
  let r = p.run('impact', '--base', 'main');
  assert.equal(r.status, 2);
  assert.equal(r.out.error, 'no_index');
  assert.match(r.out.hint, /由用户决定/);
  fs.mkdirSync(path.join(p.root, '.codegraph'));
  const bin = path.join(p.base, 'bin'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\necho /nonexistent\n', { mode: 0o755 });
  const res = spawnSync(process.execPath, [SCRIPT, 'impact', '--base', 'main'], { cwd: p.root, encoding: 'utf8', env: { ...process.env, CODEGRAPH_LIB: path.join(p.base, 'missing'), PATH: [bin, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter) } });
  if (process.platform !== 'win32') {
    assert.equal(res.status, 2, res.stdout + res.stderr);
    assert.equal(JSON.parse(res.stdout).error, 'no_library');
  }
  fs.rmSync(p.base, { recursive: true, force: true });
});

test('mq / jobs / tables：只扫源码，不需要索引', () => {
  const p = project();
  fs.rmSync(path.join(p.root, '.codegraph'), { recursive: true, force: true });
  let r = p.run('mq', '--topic', 'pay-notify');
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.out.consumers.map((c) => [c.annotation, c.topics]), [['RocketMQMessageListener', ['pay-notify']]]);
  assert.deepEqual(r.out.producers.map((x) => [x.via, x.literal]), [['rocketMQTemplate.syncSend', true]]);
  r = p.run('mq');
  assert.ok(r.out.producers.some((x) => x.topic === 'PayTopics.CALLBACK' && x.literal === false), '常量 topic 标 literal: false');
  r = p.run('jobs');
  assert.deepEqual(r.out.jobs.map((j) => [j.annotation, j.file]), [['XxlJob', 'src/main/java/com/demo/job/ExpireJob.java']]);
  r = p.run('tables', '--table', 'T_USER');
  assert.deepEqual(r.out.statements.map((s) => s.statement), ['com.demo.mapper.OrderMapper.selectByUser']);
  assert.equal(p.run('impact').status, 1, '缺 --diff / --base');
  assert.equal(p.run('impact', '--diff', 'main').status, 1, '--diff 要三点');
  fs.rmSync(p.base, { recursive: true, force: true });
});
