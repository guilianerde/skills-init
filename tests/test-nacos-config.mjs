import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main, documents, properties, resolveValue, localConnection, mergeDocuments, maskValue, serverURL, retrieve } from '../nacos-config/scripts/config.mjs';

const SCRIPT = fileURLToPath(new URL('../nacos-config/scripts/config.mjs', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nacos-config-test-'));
test.after(() => fs.rmSync(temp, { recursive: true, force: true }));
function workspace() {
  const cwd = fs.mkdtempSync(path.join(temp, 'project-'));
  return { cwd, skillDir: cwd, env: {}, put(file, value) { fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true }); fs.writeFileSync(path.join(cwd, file), value); } };
}
async function server(t, handler) {
  const calls = [];
  const s = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const call = { method: req.method, url: new URL(req.url, 'http://local'), headers: req.headers, body };
    calls.push(call);
    handler(call, res);
  });
  await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve));
  t.after(() => { s.closeAllConnections(); return new Promise((resolve) => s.close(resolve)); });
  return { address: `http://127.0.0.1:${s.address().port}/nacos`, calls };
}

test('properties 续行、分隔符转义、Unicode、空值和特殊 key', () => {
  const d = properties('# ignore\na.b : 10\nname=\\u4e2d\\u6587\nmultiline=a\\\n  b\nescaped\\:key=x\\=y\nempty=\n__proto__=safe\nspace value');
  assert.equal(d['a.b'], '10');
  assert.equal(d.name, '中文');
  assert.equal(d.multiline, 'ab');
  assert.equal(d['escaped:key'], 'x=y');
  assert.equal(d.empty, '');
  assert.equal(d.__proto__, 'safe');
  assert.equal(d.space, 'value');
});

test('YAML 嵌套、点分 key、数组、多文档与显式 profile', async () => {
  const docs = await documents('spring.cloud.nacos.server-addr: base:8848\nspring:\n  cloud:\n    nacos:\n      config:\n        shared-configs:\n          - data-id: common.yaml\n---\nspring.config.activate.on-profile: test\nspring.cloud.nacos.config.server-addr: test:8848', 'yaml');
  assert.equal(docs[0]['spring.cloud.nacos.config.shared-configs.0.data-id'], 'common.yaml');
  assert.throws(() => mergeDocuments(docs), /profile/);
  assert.equal(localConnection(mergeDocuments(docs, 'test')).server_addr, 'test:8848');
  assert.equal(localConnection(mergeDocuments(docs, 'prod')).server_addr, 'base:8848');
  assert.throws(() => mergeDocuments([{ 'spring.profiles': 'test & !prod' }], 'test'), /复杂/);
});

test('多 profile 选择与文档顺序覆盖生效，拒绝无效名称列表', async (t) => {
  const remote = await server(t, (_, res) => res.end('flag=true'));
  const w = workspace();
  w.put('application.yml', `spring.cloud.nacos.config:\n  server-addr: http://base.invalid:8848\n  namespace: base\n  group: BASE\n---\nspring.config.activate.on-profile: test,staging\nspring.cloud.nacos.config:\n  server-addr: ${remote.address}\n  namespace: test-id\n  group: TEST\n---\nspring.config.activate.on-profile: local\nspring.cloud.nacos.config.group: LOCAL\n`);
  w.put('override.properties', 'spring.cloud.nacos.config.namespace=override-id');
  for (const profile of ['test,local', 'local,test', ' test , local ']) {
    const result = await main(['get', '--file', 'application.yml', '--file', 'override.properties', '--profile', profile, '--data-id', 'app.properties'], w);
    assert.equal(result.source.server, remote.address);
    assert.equal(result.source.namespace, 'override-id');
    assert.equal(result.source.group, 'LOCAL');
    const params = remote.calls.at(-1).url.searchParams;
    assert.equal(params.get('tenant'), 'override-id');
    assert.equal(params.get('group'), 'LOCAL');
  }
  for (const profile of ['', 'test,', ',test', 'test,,local', 'test & local']) {
    assert.throws(() => mergeDocuments([{}], profile), /profile/);
  }
});

test('占位符支持环境、本地属性、默认值、嵌套；循环和缺失拒绝', () => {
  const props = { host: 'local', port: '${PORT:8848}', 'spring.cloud.nacos.server-addr': '${HOST:${host}}:${port}', 'spring.cloud.nacos.config.namespace': '${NS:test}' };
  assert.equal(localConnection(props, {}).server_addr, 'local:8848');
  assert.equal(localConnection(props, { HOST: 'env', PORT: '8849' }).server_addr, 'env:8849');
  assert.equal(localConnection(props, {}).namespace, 'test');
  assert.equal(resolveValue('${HOST:${ABSENT}}', {}, { HOST: 'available' }), 'available');
  assert.throws(() => resolveValue('${A}', {}, {}), /缺少变量/);
  assert.throws(() => resolveValue('${A}', { A: '${B}', B: '${A}' }, {}), /循环/);
  assert.throws(() => resolveValue('@env@', {}, {}), /构建/);
});

test('密码中的多个 @ 可直接读取或来自环境变量，原始构建占位符仍拒绝', async (t) => {
  const remote = await server(t, (c, res) => {
    if (c.url.pathname.endsWith('/login')) return res.end('{"accessToken":"private-token"}');
    res.end('flag=true');
  });
  const w = workspace();
  for (const format of ['yaml', 'properties']) {
    for (const [value, env, expected] of [
      ['abc@def@123', {}, 'abc@def@123'],
      ['${NACOS_PASSWORD}', { NACOS_PASSWORD: 'abc@def@123' }, 'abc@def@123'],
      ['${NACOS_PASSWORD}', { NACOS_PASSWORD: '@literal-secret@' }, '@literal-secret@'],
    ]) {
      w.env = env;
      w.put(`application.${format}`, format === 'yaml'
        ? `spring.cloud.nacos:\n  server-addr: ${remote.address}\n  username: reader\n  password: '${value}'\n`
        : `spring.cloud.nacos.server-addr=${remote.address}\nspring.cloud.nacos.username=reader\nspring.cloud.nacos.password=${value}\n`);
      const r = await main(['get', '--file', `application.${format}`, '--data-id', 'app.properties'], w);
      assert.equal(new URLSearchParams(remote.calls.at(-2).body).get('password'), expected);
      assert.doesNotMatch(JSON.stringify(r), /abc@def@123|literal-secret|private-token/);
    }
  }
  assert.throws(() => localConnection({ 'spring.cloud.nacos.password': '@NACOS_PASSWORD@' }, {}), /构建/);
  assert.throws(() => localConnection({ 'spring.cloud.nacos.config.namespace': 'app-@ENV@' }, {}), /构建/);
});

test('地址 context path、协议、集群和嵌入凭据校验', () => {
  assert.equal(serverURL('host:8848').pathname, '/nacos');
  assert.equal(serverURL('https://host/custom/').pathname, '/custom');
  for (const s of ['http://u:p@host', 'http://host?token=x', 'file:///tmp/x', 'host:8848,other:8848']) assert.throws(() => serverURL(s));
});

test('inspect 不联网、不显示凭据，不擅自合并多个环境', async () => {
  const w = workspace();
  w.put('src/main/resources/bootstrap.yml', 'spring.cloud.nacos.password: local-secret\nspring.cloud.nacos.server-addr: ${UNSET_HOST}\nspring.config.import:\n  - optional:nacos:common.yaml?group=COMMON&password=import-secret');
  w.put('src/main/resources/application-prod.properties', 'spring.cloud.nacos.config.namespace=prod');
  w.put('config.json', JSON.stringify({ connections: { test: { password_env: 'SECRET' } } }));
  const r = await main(['inspect'], w);
  assert.equal(r.candidates.length, 2);
  assert.deepEqual(r.connections, ['test']);
  assert.doesNotMatch(JSON.stringify(r), /local-secret|import-secret/);
  assert.ok(r.candidates.some((c) => c.config_imports.includes('optional:nacos:common.yaml')));
  await assert.rejects(main(['get', '--data-id', 'a.yaml'], w), /请选择/);
});

test('从选定本地文件读取 v1，后文件覆盖，登录凭据不出现在 URL 或输出', async (t) => {
  const remote = await server(t, (c, res) => {
    if (c.url.pathname.endsWith('/login')) return res.end(JSON.stringify({ accessToken: 'private-token' }));
    res.end('order:\n  timeout: 30\n  enabled: true\n  credentials:\n    custom-name: |\n      multiline-secret\nspring.datasource.url: jdbc:mysql://db:3306/a?user=a&password=db-secret\n');
  });
  const w = workspace();
  w.env = { NACOS_PASSWORD: 'login-secret' };
  w.put('bootstrap.yml', `spring.cloud.nacos:\n  server-addr: ${remote.address}\n  username: reader\n  password: \${NACOS_PASSWORD}\n  config:\n    namespace: base\n`);
  w.put('application-test.properties', 'spring.cloud.nacos.config.namespace=test-id');
  const r = await main(['get', '--file', 'bootstrap.yml', '--file', 'application-test.properties', '--data-id', 'order.yaml'], w);
  assert.equal(r.values['order.timeout'], 30);
  assert.equal(r.values['order.enabled'], true);
  assert.equal(r.values['order.credentials.custom-name'], '******');
  assert.doesNotMatch(JSON.stringify(r), /login-secret|private-token|multiline-secret|db-secret/);
  assert.equal(r.source.namespace, 'test-id');
  assert.match(r.source.sha256, /^[a-f0-9]{64}$/);
  assert.equal(remote.calls[0].method, 'POST');
  assert.equal(new URLSearchParams(remote.calls[0].body).get('password'), 'login-secret');
  assert.equal(remote.calls[0].url.search, '');
  const c = remote.calls[1];
  assert.equal(c.method, 'GET');
  assert.equal(c.url.pathname, '/nacos/v1/cs/configs');
  assert.equal(c.url.searchParams.get('tenant'), 'test-id');
  assert.equal(c.url.searchParams.get('accessToken'), 'private-token');
});

test('v2 命名连接只读获取 JSON 子树，公共命名空间与 Group 编码正确', async (t) => {
  const remote = await server(t, (_, res) => res.end(JSON.stringify({ code: 0, data: '{"feature":{"enabled":false},"other":123}' })));
  const w = workspace();
  w.env = { TOKEN: 'v2-token' };
  w.put('config.json', JSON.stringify({ default_connection: 'test', connections: { test: { server_addr: remote.address, api_version: '2', token_env: 'TOKEN' } } }));
  const r = await main(['get', '--data-id', 'config.json', '--group', 'A+B & C', '--key', 'feature'], w);
  assert.deepEqual({ ...r.values }, { 'feature.enabled': false });
  assert.equal(r.source.connection, 'test');
  assert.equal(remote.calls[0].url.searchParams.get('namespaceId'), 'public');
  assert.equal(remote.calls[0].url.searchParams.get('group'), 'A+B & C');
  assert.equal(remote.calls[0].method, 'GET');
  await assert.rejects(main(['get', '--conn', 'test', '--data-id', 'config.json', '--key', 'absent'], w), /未找到/);
});

test('v3 登录路径、header token、客户端 API 和响应检查', async (t) => {
  const remote = await server(t, (c, res) => {
    if (c.method === 'POST') return res.end('{"accessToken":"v3-token"}');
    res.end(JSON.stringify({ code: 0, data: { content: 'flag=true', success: true, errorCode: 0 } }));
  });
  const r = await retrieve({ server_addr: remote.address, username_env: 'USER', password_env: 'PASS' }, { apiVersion: '3', dataId: 'a.properties' }, { USER: 'reader', PASS: 'private' });
  assert.equal(r.content, 'flag=true');
  assert.equal(remote.calls[0].url.pathname, '/nacos/v3/auth/user/login');
  assert.equal(remote.calls[1].url.pathname, '/nacos/v3/client/cs/config');
  assert.equal(remote.calls[1].headers.accesstoken, 'v3-token');
  assert.equal(remote.calls[1].url.searchParams.has('accessToken'), false);
  assert.equal(remote.calls[1].url.searchParams.get('groupName'), 'DEFAULT_GROUP');
});

test('鉴权缺失、参数错误、未知连接与混合来源不发送请求', async (t) => {
  const remote = await server(t, (_, res) => res.end('unexpected'));
  await assert.rejects(retrieve({ server_addr: remote.address, token_env: 'MISSING' }, { dataId: 'a.yaml' }, {}), /缺少凭据/);
  await assert.rejects(retrieve({ server_addr: remote.address, username: 'u' }, { dataId: 'a.yaml' }), /同时/);
  await assert.rejects(retrieve({ server_addr: remote.address }, {}), /data-id/);
  await assert.rejects(retrieve({ server_addr: remote.address }, { dataId: 'a', apiVersion: '4' }), /api_version/);
  const w = workspace();
  await assert.rejects(main(['get', '--conn', 'prod', '--file', 'a.yml'], w), /不能同时/);
  await assert.rejects(main(['get', '--conn', 'missing', '--data-id', 'a'], w), /请选择/);
  w.put('config.json', JSON.stringify({ connections: { test: { server_addr: remote.address, password: 'secret' } } }));
  await assert.rejects(main(['get', '--conn', 'test', '--data-id', 'a'], w), /password_env/);
  assert.equal(remote.calls.length, 0);
});

test('远端错误体和解析错误不泄漏内容；重定向不跟随', async (t) => {
  const remote = await server(t, (c, res) => {
    const id = c.url.searchParams.get('dataId');
    if (id === 'redirect') { res.writeHead(302, { Location: '/leaked' }); return res.end(); }
    if (id === 'business') return res.end('{"code":403,"message":"remote-secret"}');
    res.writeHead(Number(id)); res.end('remote-secret');
  });
  for (const code of ['401', '403', '404', '500']) await assert.rejects(retrieve({ server_addr: remote.address }, { dataId: code }), (e) => e.message.includes(code) && !e.message.includes('remote-secret'));
  await assert.rejects(retrieve({ server_addr: remote.address }, { dataId: 'redirect' }), /重定向/);
  assert.ok(!remote.calls.some((c) => c.url.pathname === '/leaked'));
  await assert.rejects(retrieve({ server_addr: remote.address }, { dataId: 'business', apiVersion: '2' }), /业务错误/);
  await assert.rejects(documents('password: [secret\ninvalid', 'yaml'), (e) => !e.message.includes('secret'));
  await assert.rejects(documents('{"password":"secret",}', 'json'), (e) => !e.message.includes('secret'));
  await assert.rejects(documents('<html>login</html>', 'yaml'), /解析失败/);
});

test('超时、过大响应、v3 加密结果拒绝使用', async (t) => {
  const remote = await server(t, (c, res) => {
    const id = c.url.searchParams.get('dataId');
    if (id === 'slow') return;
    if (id === 'large') return res.end('x'.repeat(2 * 1024 * 1024 + 1));
    res.end('{"code":0,"data":{"content":"ciphertext","encryptedDataKey":"secret"}}');
  });
  await assert.rejects(retrieve({ server_addr: remote.address }, { dataId: 'slow', timeout: 0.02 }), /超时/);
  await assert.rejects(retrieve({ server_addr: remote.address }, { dataId: 'large' }), /2 MiB/);
  await assert.rejects(retrieve({ server_addr: remote.address }, { dataId: 'encrypted', apiVersion: '3' }), /加密/);
});

test('脱敏覆盖敏感父级、URL 用户信息、query 与 PEM', () => {
  assert.equal(maskValue('credentials.custom', 'abc'), '******');
  assert.equal(maskValue('endpoint', 'https://user:secret@host/path?accessToken=private'), 'https://******@host/path?accessToken=******');
  assert.equal(maskValue('cert', '-----BEGIN RSA PRIVATE KEY-----\nprivate'), '******');
  assert.equal(maskValue('feature.enabled', false), false);
});

test('Oracle Thin / OCI URL 内嵌凭据整值脱敏，无凭据的 URL 保持可见', async (t) => {
  const urls = ['jdbc:oracle:thin:reader/SYNTHETIC_SECRET@//db:1521/app',
    'jdbc:oracle:oci:reader/SYNTHETIC_SECRET@tns_alias',
    'JDBC:ORACLE:THIN:reader/secret@with@signs@//db:1521/app'];
  for (const url of urls) assert.equal(maskValue('spring.datasource.url', url), '******');
  for (const url of ['jdbc:oracle:thin:@//db:1521/app', 'jdbc:oracle:oci:@tns_alias',
    'jdbc:oracle:thin:@(DESCRIPTION=(ADDRESS=(HOST=db))(CONNECT_DATA=(SERVICE_NAME=app)))']) {
    assert.equal(maskValue('spring.datasource.url', url), url);
  }
  const remote = await server(t, (c, res) => {
    const id = c.url.searchParams.get('dataId');
    if (id.endsWith('.json')) return res.end(JSON.stringify({ spring: { datasource: { url: urls[0] } } }));
    res.end(id.endsWith('.yaml') ? `spring.datasource.url: ${urls[0]}\n` : `spring.datasource.url=${urls[1]}\n`);
  });
  const w = workspace();
  w.put('config.json', JSON.stringify({ connections: { test: { server_addr: remote.address } } }));
  for (const id of ['db.yaml', 'db.json', 'db.properties']) {
    const r = await main(['get', '--conn', 'test', '--data-id', id, '--key', 'spring.datasource.url'], w);
    assert.equal(r.values['spring.datasource.url'], '******');
    assert.doesNotMatch(JSON.stringify(r), /SYNTHETIC_SECRET/);
  }
});

test('CLI 支持目录软链接执行 inspect / get，作为模块导入不启动命令', async (t) => {
  const remote = await server(t, (_, res) => res.end('flag=true'));
  const w = workspace();
  const skill = path.join(w.cwd, 'real-skill');
  fs.mkdirSync(path.join(skill, 'scripts'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(skill, 'scripts/config.mjs'));
  fs.writeFileSync(path.join(skill, 'config.json'), JSON.stringify({ connections: { test: { server_addr: remote.address } } }));
  const alias = path.join(w.cwd, 'skill-link');
  try { fs.symlinkSync(skill, alias, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (e) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(e.code)) { t.skip('当前环境不允许建立目录链接'); return; } throw e; }
  const run = (args, input = '') => new Promise((resolve) => {
    const p = spawn(process.execPath, args, { cwd: w.cwd, env: process.env });
    let stdout = ''; let stderr = '';
    p.stdout.on('data', (c) => stdout += c); p.stderr.on('data', (c) => stderr += c);
    p.stdin.end(input);
    p.on('close', (status) => resolve({ status, stdout, stderr }));
  });
  for (const dir of [skill, alias]) {
    const script = path.join(dir, 'scripts/config.mjs');
    const inspected = await run([script, 'inspect']);
    assert.equal(inspected.status, 0, inspected.stderr);
    assert.deepEqual(JSON.parse(inspected.stdout).connections, ['test']);
    const read = await run([script, 'get', '--conn', 'test', '--data-id', 'app.properties']);
    assert.equal(read.status, 0, read.stderr);
    assert.equal(JSON.parse(read.stdout).values.flag, 'true');
    const bad = await run([script, 'get', '--password=private-secret']);
    assert.equal(bad.status, 2);
    assert.doesNotMatch(bad.stderr, /private-secret/);
  }
  const imported = await run(['--input-type=module', '-'], `await import(${JSON.stringify(new URL('../nacos-config/scripts/config.mjs', import.meta.url).href)}); console.log('imported');`);
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout.trim(), 'imported');
});

test('CLI stdout 结构化输出与参数退出码，不接受凭据参数', async () => {
  const w = workspace();
  const run = (args) => new Promise((resolve) => {
    const p = spawn(process.execPath, [SCRIPT, ...args], { cwd: w.cwd, env: process.env });
    let stdout = ''; let stderr = '';
    p.stdout.on('data', (c) => stdout += c); p.stderr.on('data', (c) => stderr += c);
    p.on('close', (status) => resolve({ status, stdout, stderr }));
  });
  const r = await run(['inspect']);
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout).candidates, []);
  const bad = await run(['get', '--password', 'cli-secret']);
  assert.equal(bad.status, 2);
  assert.equal(bad.stdout, '');
  assert.doesNotMatch(bad.stderr, /cli-secret/);
  const inline = await run(['get', '--password=inline-secret']);
  assert.equal(inline.status, 2);
  assert.doesNotMatch(inline.stderr, /inline-secret/);
});
