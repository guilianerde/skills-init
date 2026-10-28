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
