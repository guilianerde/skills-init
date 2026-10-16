// database-query/scripts/query.mjs：语句分类、LIMIT、脱敏的单元测试 + 用假 mysql / psql 客户端的端到端测试
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classify, addLimit, maskValue, stripSql, schemaSql, schemaMarkdown, mergeSchema, indexSql, indexMarkdown } from '../database-query/scripts/query.mjs';

const SCRIPT = fileURLToPath(new URL('../database-query/scripts/query.mjs', import.meta.url));
const skip = process.platform === 'win32' ? '假客户端用 shebang 脚本实现，Windows 跳过' : false;

test('只读语句与写语句分类', () => {
  for (const q of ['select 1', ' SELECT * FROM t;', 'show tables', 'desc t', 'explain select 1', '(select 1)',
    'with a as (select 1) select * from a', "select 'delete from t' as s", 'select 1 -- ; drop table t', "select replace(name,'a','b') from t"]) {
    assert.equal(classify(q).kind, 'read', q);
  }
  for (const q of ['delete from t', 'UPDATE t set a=1', 'insert into t values (1)', 'drop table t', 'set autocommit=0',
    'with x as (delete from t returning *) select * from x', 'select * from t for update', "select * into outfile '/tmp/a' from t"]) {
    assert.equal(classify(q).kind, 'write', q);
  }
  assert.throws(() => classify('select 1; drop table t'), /一次只执行一条语句/);
  assert.throws(() => classify('  -- 只有注释'), /SQL 为空/);
  assert.equal(stripSql("a 'it''s;' b").includes(';'), false);
});

test('自动补 LIMIT：已有 LIMIT / FETCH FIRST 或非查询时不补', () => {
  assert.deepEqual(addLimit('select * from t;', 200), { sql: 'select * from t\nLIMIT 201', limited: true });
  assert.equal(addLimit('select * from t limit 5', 200).limited, false);
  assert.equal(addLimit('select * from t fetch first 5 rows only', 200).limited, false);
  assert.equal(addLimit('show tables', 200).limited, false);
  assert.equal(addLimit('select 1', 0).limited, false);
  assert.equal(addLimit("select 'limit 5' from t", 10).limited, true);
});

test('脱敏', () => {
  assert.equal(maskValue('password', 'abc'), '******');
  assert.equal(maskValue('mobile', '13812341234'), '138****1234');
  assert.equal(maskValue('email', 'alice@example.com'), 'a***@example.com');
  assert.equal(maskValue('id_card', '1234'), '****');
  assert.equal(maskValue('phone', 'NULL'), 'NULL');
});

// 假客户端：把参数与关键环境变量写进 calls.json，输出固定的 TSV
const FAKE = `#!/usr/bin/env node
const fs = require('fs');
fs.writeFileSync(process.env.FAKE_LOG, JSON.stringify({ bin: require('path').basename(process.argv[1]), args: process.argv.slice(2),
  MYSQL_PWD: process.env.MYSQL_PWD, PGPASSWORD: process.env.PGPASSWORD, PGOPTIONS: process.env.PGOPTIONS }));
if (process.env.FAKE_FAIL) { console.error('ERROR 1045: Access denied'); process.exit(1); }
process.stdout.write('id\\tname\\tmobile\\tpwd_hash\\n1\\ta|b\\t13812341234\\tx\\n2\\tc\\t13900001111\\ty\\n3\\td\\t\\tz\\n');
`;

function setup(cfg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbq-'));
  fs.mkdirSync(path.join(dir, 'database-query', 'scripts'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(dir, 'database-query', 'scripts', 'query.mjs'));
  fs.writeFileSync(path.join(dir, 'database-query', 'config.json'), JSON.stringify(cfg));
  fs.mkdirSync(path.join(dir, 'bin'));
  for (const b of ['mysql', 'psql']) fs.writeFileSync(path.join(dir, 'bin', b), FAKE, { mode: 0o755 });
  const run = (args, env = {}) => {
    const log = path.join(dir, 'calls.json');
    fs.rmSync(log, { force: true });
    const r = spawnSync(process.execPath, [path.join(dir, 'database-query', 'scripts', 'query.mjs'), ...args], {
      encoding: 'utf8', input: '',
      env: { ...process.env, DB_PASSWORD: '', PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}`, FAKE_LOG: log, ...env },
    });
    return { ...r, call: fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, 'utf8')) : null };
  };
  return { dir, run };
}

const CFG = {
  default_connection: 'dev',
  connections: {
    dev: { driver: 'mysql', host: 'h', port: 3306, database: 'app', user: 'ro', password_env: 'T_DEV_PWD' },
    pg: { driver: 'postgresql', host: 'p', port: 5432, database: 'app', user: 'ro', password: 'inline-secret', readonly: true },
    rw: { driver: 'mysql', host: 'h', database: 'app', user: 'rw', password_env: 'T_DEV_PWD', readonly: false },
    ora: { driver: 'oracle', host: 'o', database: 'x', user: 'u', password: 'p' },
  },
};

test('mysql：会话只读、密码走环境变量、补 LIMIT、截断、脱敏', { skip }, () => {
  const { dir, run } = setup(CFG);
  const r = run(['--limit', '2', 'select * from users'], { T_DEV_PWD: 's3cr3t' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.call.bin, 'mysql');
  assert.equal(r.call.MYSQL_PWD, 's3cr3t');
  assert.ok(r.call.args.includes('--init-command=SET SESSION TRANSACTION READ ONLY'));
  assert.equal(r.call.args.at(-1), 'select * from users\nLIMIT 3');
  assert.ok(!r.call.args.some((a) => a.includes('s3cr3t')));
  assert.doesNotMatch(r.stdout, /s3cr3t|13812341234/);
  assert.match(r.stdout, /连接：dev（只读）/);
  assert.match(r.stdout, /已截断，仅显示前 2 行/);
  assert.match(r.stdout, /138\*\*\*\*1234/);
  assert.match(r.stdout, /a\\\|b/);
  assert.match(r.stdout, /已脱敏列：mobile、pwd_hash/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('postgresql：PGOPTIONS 只读 + statement_timeout，json 输出', { skip }, () => {
  const { dir, run } = setup(CFG);
  const r = run(['--conn', 'pg', '--format', 'json', '--timeout', '5', '--no-mask', 'select * from users limit 10']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.call.PGPASSWORD, 'inline-secret');
  assert.match(r.call.PGOPTIONS, /default_transaction_read_only=on/);
  assert.match(r.call.PGOPTIONS, /statement_timeout=5000/);
  const out = JSON.parse(r.stdout);
  assert.equal(out.rows.length, 3);
  assert.equal(out.rows[0][2], '13812341234');
  assert.equal(out.limit_added, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('只读拦截、写操作需 --write、未知连接、缺密码、不支持的 driver、客户端报错', { skip }, () => {
  const { dir, run } = setup(CFG);
  let r = run(['delete from users'], { T_DEV_PWD: 'x' });
  assert.equal(r.status, 2); assert.match(r.stderr, /只读/); assert.equal(r.call, null);
  r = run(['--conn', 'rw', 'delete from users where id=1'], { T_DEV_PWD: 'x' });
  assert.equal(r.status, 2); assert.match(r.stderr, /--write/);
  r = run(['--conn', 'rw', '--write', 'delete from users where id=1'], { T_DEV_PWD: 'x' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.call.args.some((a) => a.includes('READ ONLY')));
  r = run(['--conn', 'nope', 'select 1']);
  assert.equal(r.status, 2); assert.match(r.stderr, /已有：dev、pg、rw、ora/);
  r = run(['select 1']);
  assert.equal(r.status, 2); assert.match(r.stderr, /T_DEV_PWD/);
  r = run(['--conn', 'ora', 'select 1']);
  assert.equal(r.status, 3); assert.match(r.stderr, /JDBC/);
  r = run(['select 1'], { T_DEV_PWD: 'x', FAKE_FAIL: '1' });
  assert.equal(r.status, 1); assert.match(r.stderr, /Access denied/);
  r = run(['--list']);
  assert.equal(r.status, 0); assert.match(r.stdout, /dev（默认）/); assert.doesNotMatch(r.stdout, /inline-secret/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('schema：SQL 按 driver 生成、表名过滤、Markdown 与标记合并', () => {
  assert.match(schemaSql('mysql', []), /TABLE_SCHEMA = DATABASE\(\)/);
  assert.match(schemaSql('mysql', ['users', 'orders']), /TABLE_NAME IN \('users', 'orders'\)/);
  assert.match(schemaSql('postgresql', ['users']), /current_schema\(\)[\s\S]*table_name IN \('users'\)/);
  const md = schemaMarkdown('dev', { database: 'app' }, [
    ['users', 'id', 'bigint', 'NO', 'PRI', 'NULL', '主键', '用户表'],
    ['users', 'name', 'varchar(64)', 'YES', '', '', 'a|b', '用户表'],
    ['orders', 'id', 'bigint', 'NO', 'PRI', '', '', ''],
  ]);
  assert.match(md, /^<!-- schema:begin -->/);
  assert.match(md, /共 2 张表：`users`、`orders`/);
  assert.match(md, /### users — 用户表/);
  assert.match(md, /\| id \| bigint \| 否 \| PRI \|  \| 主键 \|/);
  assert.match(md, /a\\\|b/);
  assert.match(md, /<!-- schema:end -->$/);
  const tpl = '# Schema\n\n## 关键表结构\n\n<!-- schema:begin -->\n旧内容\n<!-- schema:end -->\n\n## 补充说明\n\n手写说明\n';
  const merged = mergeSchema(tpl, md);
  assert.doesNotMatch(merged, /旧内容/);
  assert.match(merged, /手写说明/);
  assert.equal(merged.match(/schema:begin/g).length, 1);
  assert.match(mergeSchema('# 用户自己写的\n', md), /# 用户自己写的\n\n## 表结构（自动导出）\n\n<!-- schema:begin -->/);
});

// 假客户端输出 information_schema 风格的列结果
const FAKE_SCHEMA = `#!/usr/bin/env node
const fs = require('fs');
fs.writeFileSync(process.env.FAKE_LOG, JSON.stringify({ args: process.argv.slice(2), PGOPTIONS: process.env.PGOPTIONS }));
process.stdout.write('TABLE_NAME\\tCOLUMN_NAME\\tCOLUMN_TYPE\\tIS_NULLABLE\\tCOLUMN_KEY\\tCOLUMN_DEFAULT\\tCOLUMN_COMMENT\\tTABLE_COMMENT\\nusers\\tid\\tbigint\\tNO\\tPRI\\tNULL\\t主键\\t用户表\\n');
`;

test('CLI --schema：可写连接也按只读会话执行；--write 写入 schema.md 标记之间', { skip }, () => {
  const { dir, run } = setup(CFG);
  fs.writeFileSync(path.join(dir, 'bin', 'mysql'), FAKE_SCHEMA, { mode: 0o755 });
  let r = run(['--conn', 'rw', '--schema', '--tables', 'users'], { T_DEV_PWD: 'x' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.call.args.includes('--init-command=SET SESSION TRANSACTION READ ONLY'));
  assert.match(r.call.args.at(-1), /TABLE_NAME IN \('users'\)/);
  assert.match(r.stdout, /### users — 用户表/);
  assert.ok(!fs.existsSync(path.join(dir, 'database-query/references/schema.md')));
  r = run(['--schema', '--tables', 'users;drop'], { T_DEV_PWD: 'x' });
  assert.equal(r.status, 2); assert.match(r.stderr, /表名不合法/);
  const f = path.join(dir, 'database-query/references/schema.md');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, '# Schema\n<!-- schema:begin -->\n<!-- schema:end -->\n## 补充说明\n订单表按月分表\n');
  r = run(['--schema', '--write'], { T_DEV_PWD: 'x' });
  assert.equal(r.status, 0, r.stderr);
  const out = fs.readFileSync(f, 'utf8');
  assert.match(out, /\| id \| bigint \| 否 \| PRI \|/);
  assert.match(out, /订单表按月分表/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--indexes：索引 SQL 按 driver 生成；Markdown 列出索引、估算行数与库里不存在的表', () => {
  assert.match(indexSql('mysql', ['t_order']).indexes, /information_schema\.STATISTICS[\s\S]*TABLE_NAME IN \('t_order'\)/);
  assert.match(indexSql('mysql', ['t_order']).rows, /TABLE_ROWS/);
  assert.match(indexSql('postgresql', ['t_order']).indexes, /pg_indexes/);
  assert.match(indexSql('postgresql', ['t_order']).rows, /reltuples/);
  const { markdown, missing } = indexMarkdown(['t_order', 't_new'], ['t_order'], [['t_order', 'PRIMARY', '1', 'id'], ['t_order', 'idx_uid_time', '0', 'uid,created_at']], [['t_order', '1234567']]);
  assert.deepEqual(missing, ['t_new']);
  assert.match(markdown, /库里不存在的表：`t_new`/);
  assert.match(markdown, /### t_order（估算 1,234,567 行）/);
  assert.match(markdown, /\| idx_uid_time \| 否 \| uid,created_at \|/);
  assert.match(indexMarkdown(['a'], ['a'], [], []).markdown, /### a（估算 未知）\n\n无索引/);
});

// 按 SQL 内容返回不同结果的假客户端：列 / 索引 / 行数
const FAKE_INDEX = `#!/usr/bin/env node
const fs = require('fs');
const sql = process.argv.at(-1);
fs.appendFileSync(process.env.FAKE_LOG + '.sql', sql + '\\n---\\n');
fs.writeFileSync(process.env.FAKE_LOG, JSON.stringify({ args: process.argv.slice(2) }));
if (/STATISTICS/.test(sql)) process.stdout.write('TABLE_NAME\\tINDEX_NAME\\tU\\tCOLS\\nt_order\\tPRIMARY\\t1\\tid\\n');
else if (/TABLE_ROWS/.test(sql)) process.stdout.write('TABLE_NAME\\tTABLE_ROWS\\nt_order\\t800000\\n');
else process.stdout.write('TABLE_NAME\\tCOLUMN_NAME\\tCOLUMN_TYPE\\tIS_NULLABLE\\tCOLUMN_KEY\\tCOLUMN_DEFAULT\\tCOLUMN_COMMENT\\tTABLE_COMMENT\\nt_order\\tid\\tbigint\\tNO\\tPRI\\tNULL\\t\\t订单\\n');
`;

test('CLI --schema --indexes：三条只读查询，输出索引、行数和缺失的表；参数组合校验', { skip }, () => {
  const { dir, run } = setup(CFG);
  fs.writeFileSync(path.join(dir, 'bin', 'mysql'), FAKE_INDEX, { mode: 0o755 });
  let r = run(['--schema', '--tables', 't_order,t_new', '--indexes'], { T_DEV_PWD: 'x' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.call.args.includes('--init-command=SET SESSION TRANSACTION READ ONLY'));
  assert.equal(fs.readFileSync(path.join(dir, 'calls.json.sql'), 'utf8').split('---').length - 1, 3);
  assert.match(r.stdout, /### t_order — 订单/);
  assert.match(r.stdout, /### t_order（估算 800,000 行）/);
  assert.match(r.stdout, /库里不存在的表：`t_new`/);
  r = run(['--schema', '--tables', 't_order,t_new'], { T_DEV_PWD: 'x' });
  assert.match(r.stdout, /库里不存在的表：`t_new`/, '不加 --indexes 也标出缺失的表');
  assert.equal(run(['--schema', '--indexes'], { T_DEV_PWD: 'x' }).status, 2, '--indexes 需要 --tables');
  assert.equal(run(['--schema', '--tables', 't_order', '--indexes', '--write'], { T_DEV_PWD: 'x' }).status, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});
