// workflow/scripts/tables.mjs：从实体注解、Mapper XML、代码里的 SQL、DDL 脚本找出改动涉及的表
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scan } from '../workflow/scripts/tables.mjs';

const SCRIPT = fileURLToPath(new URL('../workflow/scripts/tables.mjs', import.meta.url));
const names = (hits) => [...new Set(hits.map((h) => h.table))].sort();

test('scan：实体注解与类名推断', () => {
  assert.deepEqual(names(scan('A.java', '@TableName("t_order")\nclass Order {}')), ['t_order']);
  assert.deepEqual(names(scan('A.java', '@TableName(value = "db.t_order")\nclass Order {}')), ['t_order']);
  assert.deepEqual(names(scan('A.java', '@Entity\n@Table(name = "t_user", schema = "x")\nclass User {}')), ['t_user']);
  const inferred = scan('A.java', '@TableName\npublic class OrderItemLog {}');
  assert.deepEqual(names(inferred), ['order_item_log']);
  assert.equal(inferred[0].inferred, true);
});

test('scan：代码里的 SQL 字符串与文本块；普通英文不算', () => {
  const hits = scan('Dao.java', 'String a = "select * from t_order o left join t_user u on u.id = o.uid";\nString b = """\n  UPDATE t_stock SET n = n - 1\n  """;\nString c = "hello from the other side";\nString d = "data from server";');
  assert.deepEqual(names(hits), ['t_order', 't_stock', 't_user']);
  assert.equal(hits.find((h) => h.table === 't_stock').line, 3);
});

test('scan：Mapper XML 去掉注释与标签（<update id> 不算表），行号对应', () => {
  const xml = '<mapper namespace="x">\n<!-- select * from t_comment -->\n<select id="a">SELECT * FROM `t_order_item` WHERE id = #{id}</select>\n<update id="b">\n  UPDATE t_order SET a = 1\n</update>\n</mapper>';
  const hits = scan('OrderMapper.xml', xml);
  assert.deepEqual(names(hits), ['t_order', 't_order_item']);
  assert.equal(hits.find((h) => h.table === 't_order').line, 5);
  assert.deepEqual(scan('pom.xml', '<project><name>from x</name></project>'), [], '不是 Mapper 的 XML 跳过');
});

test('scan：SQL 脚本里的 DDL 标 ddl，注释跳过', () => {
  const hits = scan('V2__x.sql', '-- alter table t_ignored\nALTER TABLE t_order ADD COLUMN channel varchar(32);\nCREATE UNIQUE INDEX uk_no ON t_order (no);\nCREATE TABLE IF NOT EXISTS `t_export_log` (id bigint);\nINSERT INTO t_dict VALUES (1);');
  assert.deepEqual(names(hits), ['t_dict', 't_export_log', 't_order']);
  assert.ok(hits.filter((h) => h.table === 't_order').every((h) => h.ddl));
  assert.equal(hits.find((h) => h.table === 't_dict').ddl, false);
});

test('CLI：--diff 读分支里改动的文件，--base 含未提交，--files 指定文件；合并来源并给出下一步命令', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tables-'));
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  git('init', '-q'); git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'); git('branch', '-M', 'main'); git('checkout', '-q', '-b', 'feat');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/Order.java'), '@TableName("t_order")\nclass Order {}\n');
  fs.writeFileSync(path.join(root, 'src/V1.sql'), 'ALTER TABLE t_order ADD COLUMN c int;\n');
  git('add', '-A'); git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'x');
  fs.writeFileSync(path.join(root, 'src/Dao.java'), 'String q = "select * from t_user";\n');
  const run = (...a) => { const r = spawnSync(process.execPath, [SCRIPT, '--root', root, ...a], { encoding: 'utf8' }); return { code: r.status, out: r.stdout ? JSON.parse(r.stdout) : null }; };

  let r = run('--diff', 'main...feat');
  assert.equal(r.code, 0);
  assert.deepEqual(r.out.tables.map((t) => t.table), ['t_order']);
  assert.equal(r.out.tables[0].ddl, true);
  assert.deepEqual(r.out.tables[0].sources.map((s) => s.how).sort(), ['@TableName', 'DDL']);
  assert.match(r.out.next, /query\.mjs --schema --tables t_order --indexes/);

  r = run('--base', 'main');
  assert.deepEqual(r.out.tables.map((t) => t.table), ['t_order', 't_user'], '含未提交与未跟踪的文件');

  r = run('--files', 'src/Dao.java');
  assert.deepEqual(r.out.tables.map((t) => t.table), ['t_user']);

  assert.equal(run('--diff', 'main').code, 1);
  assert.equal(run('--diff', 'nope...feat').code, 1);
  fs.rmSync(root, { recursive: true, force: true });
});
