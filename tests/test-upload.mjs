// md-to-wiki/scripts/upload.mjs：用本地假 Confluence 服务验证 info / put、版本校验、认证方式与 GATE
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parsePageId, storageToText, readTarget, writeTarget } from '../md-to-wiki/scripts/upload.mjs';
import { parseWiki } from '../workflow/scripts/artifacts.mjs';

const SCRIPTS = fileURLToPath(new URL('../md-to-wiki/scripts/', import.meta.url));

function fakeConfluence() {
  const state = { version: 7, title: '技术方案', body: '', auths: [], puts: 0, failPut: 0 };
  const server = http.createServer((req, res) => {
    state.auths.push(req.headers.authorization);
    const m = req.url.match(/^\/wiki\/rest\/api\/content\/(\d+)/);
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (!m || m[1] !== '123') return send(404, { message: 'not found' });
    if (req.method === 'GET') return send(200, { id: '123', title: state.title, version: { number: state.version, when: 'now' }, space: { key: 'DEV' }, _links: { webui: '/spaces/DEV/pages/123' }, ...(req.url.includes('body.storage') ? { body: { storage: { value: state.body || '<h2>背景</h2><p>A &amp; B</p><ul><li>导出订单</li></ul>' } } } : {}) });
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

test('storageToText：标题、列表、表格、实体与代码块', () => {
  const t = storageToText('<h1>需求 &amp; 背景</h1><p>第一段<br/>第二行</p><ul><li>功能 A</li></ul><table><tr><th>表</th><th>说明</th></tr><tr><td>users</td><td>用户</td></tr></table><ac:structured-macro ac:name="code"><ac:parameter ac:name="language">sql</ac:parameter><ac:plain-text-body><![CDATA[select 1 where a < 2]]></ac:plain-text-body></ac:structured-macro>');
  assert.match(t, /^# 需求 & 背景\n第一段\n第二行/);
  assert.match(t, /\n- 功能 A\n/);
  assert.match(t, /\| 表 \| 说明 \|\n\| users \| 用户 \|/);
  assert.match(t, /select 1 where a < 2/);
  assert.doesNotMatch(t, /language|sql\n/);
});

test('get：默认输出 storage，--text 输出纯文本（供其他 skill 拉 PRD）', async () => {
  const { server, base } = await fakeConfluence();
  try {
    const { dir, run } = setup({ enabled: true, wiki: { base_url: base, api_token: 'SECRET' } });
    let r = await run('get', '123');
    assert.equal(r.status, 0, r.err);
    let out = JSON.parse(r.out);
    assert.equal(out.storage, '<h2>背景</h2><p>A &amp; B</p><ul><li>导出订单</li></ul>');
    assert.equal(out.title, '技术方案');
    r = await run('get', `${base}/spaces/DEV/pages/123/x`, '--text');
    out = JSON.parse(r.out);
    assert.equal(out.text, '## 背景\nA & B\n\n- 导出订单');
    assert.ok(!('storage' in out));
    assert.doesNotMatch(r.out, /SECRET/);
    fs.rmSync(dir, { recursive: true, force: true });
  } finally { server.close(); }
});

test('发布记录：写在第一行注释，替换不叠加，正文不变；workflow 的 artifacts.mjs 读得懂同一格式', () => {
  const md = '# 技术方案\n\n> 对比分支：`f` ←→ `main`\n';
  const once = writeTarget(md, { pageId: '123', version: 8, url: 'https://w/pages/123', at: '2026-10-15T00:00:00Z' });
  assert.ok(once.startsWith('<!-- md-to-wiki: pageId=123 version=8 url=https://w/pages/123 at=2026-10-15T00:00:00Z -->\n# 技术方案'));
  const twice = writeTarget(once, { pageId: '123', version: 9 });
  assert.equal(twice.match(/md-to-wiki:/g).length, 1);
  assert.ok(twice.endsWith(md));
  assert.deepEqual(readTarget(twice), { pageId: '123', version: 9, url: null, at: readTarget(twice).at });
  assert.deepEqual(parseWiki(once), readTarget(once));
  assert.equal(readTarget(md), null);
});

test('CLI：put --record 写回记录；target 读出；record 手动写入（通道 A），不需要配置', async () => {
  const { server, base } = await fakeConfluence();
  const { dir, run } = setup({ enabled: true, wiki: { base_url: base, api_token: 'tok' } });
  try {
    fs.writeFileSync(path.join(dir, 'ok.html'), '<p>ok</p>');
    fs.writeFileSync(path.join(dir, 'doc.md'), '# 文档\n');
    let r = await run('target', 'doc.md');
    assert.equal(r.status, 1);
    r = await run('put', 'ok.html', '123', '--expect-version', '7', '--record', 'doc.md');
    assert.equal(r.status, 0, r.err);
    assert.equal(JSON.parse(r.out).recorded_in, 'doc.md');
    r = await run('target', 'doc.md');
    assert.equal(r.status, 0);
    assert.deepEqual([JSON.parse(r.out).pageId, JSON.parse(r.out).version], ['123', 8]);
    assert.match(JSON.parse(r.out).url, /\/spaces\/DEV\/pages\/123$/);
    fs.rmSync(path.join(dir, 'md-to-wiki', 'wiki-config.json'));
    r = await run('record', 'doc.md', 'https://w/pages/viewpage.action?pageId=456', '--version', '3');
    assert.equal(r.status, 0, r.err);
    assert.equal(readTarget(fs.readFileSync(path.join(dir, 'doc.md'), 'utf8')).pageId, '456');
    assert.equal((await run('record', 'doc.md', '456')).status, 2);
  } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
