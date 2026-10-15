// md-to-wiki/scripts/upload.mjs：用本地假 Confluence 服务验证 info / put、版本校验、认证方式与 GATE
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parsePageId } from '../md-to-wiki/scripts/upload.mjs';

const SCRIPTS = fileURLToPath(new URL('../md-to-wiki/scripts/', import.meta.url));

function fakeConfluence() {
  const state = { version: 7, title: '技术方案', body: '', auths: [], puts: 0, failPut: 0 };
  const server = http.createServer((req, res) => {
    state.auths.push(req.headers.authorization);
    const m = req.url.match(/^\/wiki\/rest\/api\/content\/(\d+)/);
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (!m || m[1] !== '123') return send(404, { message: 'not found' });
    if (req.method === 'GET') return send(200, { id: '123', title: state.title, version: { number: state.version, when: 'now' }, space: { key: 'DEV' }, _links: { webui: '/spaces/DEV/pages/123' } });
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      const b = JSON.parse(data);
      state.puts++;
      if (state.failPut) return send(state.failPut, { message: 'boom' });
      if (b.version.number !== state.version + 1) return send(409, { message: 'conflict' });
      state.version = b.version.number; state.title = b.title; state.body = b.body.storage.value;
      send(200, { id: '123', version: { number: state.version } });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, base: `http://127.0.0.1:${server.address().port}/wiki` })));
}

function setup(cfg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-'));
  fs.mkdirSync(path.join(dir, 'md-to-wiki', 'scripts'), { recursive: true });
  for (const f of ['upload.mjs', 'md-to-wiki.mjs']) fs.copyFileSync(path.join(SCRIPTS, f), path.join(dir, 'md-to-wiki', 'scripts', f));
  if (cfg) fs.writeFileSync(path.join(dir, 'md-to-wiki', 'wiki-config.json'), JSON.stringify(cfg));
  const run = (...args) => new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(dir, 'md-to-wiki', 'scripts', 'upload.mjs'), ...args], { cwd: dir });
    let out = '', err = '';
    p.stdout.on('data', (c) => { out += c; }); p.stderr.on('data', (c) => { err += c; });
    p.on('close', (status) => resolve({ status, out, err }));
  });
  return { dir, run };
}

test('parsePageId', () => {
  assert.equal(parsePageId('123'), '123');
  assert.equal(parsePageId('https://w/pages/viewpage.action?pageId=456&x=1'), '456');
  assert.equal(parsePageId('https://w/wiki/spaces/DEV/pages/789/Title'), '789');
  assert.throws(() => parsePageId('https://w/display/DEV/Title'), /无法从/);
});

test('GATE：未启用或缺 base_url 时拒绝，且不发请求', async () => {
  for (const cfg of [null, { enabled: false, wiki: { base_url: 'x', api_token: 't' } }, { enabled: true, wiki: { base_url: '' } }]) {
    const { dir, run } = setup(cfg);
    const r = await run('info', '123');
    assert.equal(r.status, 2); assert.match(r.err, /wiki 连接未配置/);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('info → put：版本校验、标题保留、上传后版本 +1；Bearer 与 Basic 认证；token 不输出', async () => {
  const { server, state, base } = await fakeConfluence();
  try {
    const { dir, run } = setup({ enabled: true, wiki: { base_url: base, username: '', api_token: 'SECRET-PAT' } });
    let r = await run('info', `${base}/pages/viewpage.action?pageId=123`);
    assert.equal(r.status, 0, r.err);
    const info = JSON.parse(r.out);
    assert.deepEqual([info.title, info.version, info.space], ['技术方案', 7, 'DEV']);
    assert.equal(info.url, `${base}/spaces/DEV/pages/123`);
    assert.equal(state.auths.at(-1), 'Bearer SECRET-PAT');

    fs.writeFileSync(path.join(dir, 'ok.html'), '<p>新内容 &amp; 更多</p>');
    r = await run('put', 'ok.html', '123');
    assert.equal(r.status, 2); assert.match(r.err, /--expect-version/);
    r = await run('put', 'ok.html', '123', '--expect-version', '6');
    assert.equal(r.status, 1); assert.match(r.err, /当前版本是 7/); assert.equal(state.puts, 0);
    r = await run('put', 'ok.html', '123', '--expect-version', '7');
    assert.equal(r.status, 0, r.err);
    const out = JSON.parse(r.out);
    assert.deepEqual([out.version, out.previous_version, out.title], [8, 7, '技术方案']);
    assert.equal(state.body, '<p>新内容 &amp; 更多</p>');
    assert.doesNotMatch(r.out + r.err, /SECRET-PAT/);

    fs.writeFileSync(path.join(dir, 'bad.html'), '<p>a & b</p>');
    r = await run('put', 'bad.html', '123', '--expect-version', '8');
    assert.equal(r.status, 3); assert.match(r.err, /不良构/); assert.equal(state.puts, 1);

    state.failPut = 403;
    r = await run('put', 'ok.html', '123', '--expect-version', '8', '--title', '新标题');
    assert.equal(r.status, 1); assert.match(r.err, /HTTP 403（凭据或权限问题/);
    state.failPut = 0;

    r = await run('info', '999');
    assert.equal(r.status, 1); assert.match(r.err, /HTTP 404/);
    fs.rmSync(dir, { recursive: true, force: true });

    const basic = setup({ enabled: true, wiki: { base_url: base, username: 'me@x.com', api_token: 'TOK' } });
    r = await basic.run('put', path.join(dir, '..', 'nope.html'), '123', '--expect-version', '8');
    assert.equal(r.status, 2);
    fs.writeFileSync(path.join(basic.dir, 'ok.html'), '<p>x</p>');
    r = await basic.run('put', 'ok.html', '123', '--expect-version', '8', '--title', '新标题');
    assert.equal(r.status, 0, r.err);
    assert.equal(state.title, '新标题');
    assert.equal(state.auths.at(-1), `Basic ${Buffer.from('me@x.com:TOK').toString('base64')}`);
    fs.rmSync(basic.dir, { recursive: true, force: true });
  } finally { server.close(); }
});
