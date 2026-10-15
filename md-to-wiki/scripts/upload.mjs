#!/usr/bin/env node
// md-to-wiki 的 REST 上传通道（通道 B）：读本 skill 目录的 wiki-config.json，分两步更新已有 Confluence 页面。
//
//   node <skillDir>/scripts/upload.mjs info <pageId|url>
//       读取页面当前标题、版本号、空间与链接（只读）。把结果给用户确认是否覆盖。
//   node <skillDir>/scripts/upload.mjs get <pageId|url> [--text]
//       读取页面正文（只读）：默认输出 storage XHTML；--text 输出去掉标签的纯文本（保留标题层级 / 列表 / 表格），
//       供其他 skill 拉取 PRD，凭据只在这里使用。
//   node <skillDir>/scripts/upload.mjs put <html> <pageId|url> --expect-version <n> [--title <标题>]
//       上传前校验 XHTML 良构；页面当前版本必须等于用户确认过的 <n>（否则说明有人刚改过，停止）；
//       上传后重新读取，确认版本号变为 n+1。加 --record <md> 时把页面记录写回该 Markdown（见下）。
//   node <skillDir>/scripts/upload.mjs target <md>
//       读出 Markdown 里记录的发布目标（pageId / url / 上次版本），没有记录退出 1。不访问 wiki、不需要配置。
//   node <skillDir>/scripts/upload.mjs record <md> <pageId|url> --version <n> [--url <url>]
//       手动写入发布记录（通道 A 用 MCP 上传后调用）。不访问 wiki、不需要配置。
//
// 发布记录是 Markdown 第一行的 HTML 注释：<!-- md-to-wiki: pageId=123 version=6 url=... at=... -->，
// 转换时 HTML 注释会被丢弃，不会出现在 wiki 页面上；再次发布同一文档时不必再问 pageId。
//
// 认证：wiki.username 非空时用 Basic（username:api_token，Confluence Cloud）；否则用 Bearer（Server / DC 的 PAT）。
// token 只在请求头里使用，不输出到任何地方。输出 JSON。
// 退出码：0 成功；1 请求失败 / 版本校验失败；2 参数或配置问题（含 GATE 未通过）；3 XHTML 不良构

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkWellFormed } from './md-to-wiki.mjs';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

class UsageError extends Error {}

const RECORD_RE = /^<!-- md-to-wiki: ([^\n]*?) -->\r?\n?/;

// 读 Markdown 里的发布记录；没有返回 null
export function readTarget(md) {
  const m = RECORD_RE.exec(md);
  if (!m) return null;
  const kv = Object.fromEntries([...m[1].matchAll(/(\w+)=(\S+)/g)].map((x) => [x[1], x[2]]));
  return kv.pageId ? { pageId: kv.pageId, version: kv.version ? Number(kv.version) : null, url: kv.url ?? null, at: kv.at ?? null } : null;
}

// 写入（或替换）发布记录，返回新的 Markdown 文本；正文其余部分不变
export function writeTarget(md, { pageId, version, url, at = new Date().toISOString() }) {
  const fields = [`pageId=${pageId}`, version != null && `version=${version}`, url && `url=${String(url).replace(/\s/g, '%20')}`, `at=${at}`].filter(Boolean);
  return `<!-- md-to-wiki: ${fields.join(' ')} -->\n` + md.replace(RECORD_RE, '');
}

const recordFile = (file, info) => fs.writeFileSync(file, writeTarget(fs.readFileSync(file, 'utf8'), info));

export function parsePageId(s) {
  if (/^\d+$/.test(String(s))) return String(s);
  const m = String(s).match(/[?&]pageId=(\d+)/) || String(s).match(/\/pages\/(\d+)(?:\/|$)/);
  if (!m) throw new UsageError(`无法从「${s}」解析 pageId：请提供纯数字 pageId 或含 pageId= 的链接`);
  return m[1];
}

export function loadWikiConfig(dir = SKILL_DIR) {
  const f = path.join(dir, 'wiki-config.json');
  let cfg = null;
  try { cfg = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* 缺失或不是合法 JSON */ }
  if (!cfg || cfg.enabled !== true || !cfg.wiki?.base_url) {
    throw new UsageError('wiki 连接未配置：重跑 skills-init 补配，或填写 wiki-config.json（enabled: true，并填 base_url / api_token）。');
  }
  if (!cfg.wiki.api_token) throw new UsageError('wiki-config.json 中 api_token 为空，无法使用 REST 通道');
  return cfg.wiki;
}

function authHeader(w) {
  return w.username
    ? `Basic ${Buffer.from(`${w.username}:${w.api_token}`).toString('base64')}`
    : `Bearer ${w.api_token}`;
}

async function request(w, method, p, body) {
  const url = `${w.base_url.replace(/\/+$/, '')}${p}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: authHeader(w), Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw Object.assign(new Error(`请求 ${method} ${url} 失败：${e.cause?.code || e.message}`), { exit: 1 });
  }
  const text = await res.text();
  if (!res.ok) {
    const hint = res.status === 401 || res.status === 403 ? '（凭据或权限问题，检查 wiki-config.json，不要重试）' : res.status === 404 ? '（页面不存在或无权查看）' : res.status === 409 ? '（版本冲突：页面刚被他人修改）' : '';
    throw Object.assign(new Error(`HTTP ${res.status}${hint}：${text.slice(0, 500)}`), { exit: 1 });
  }
  try { return JSON.parse(text); } catch { return {}; }
}

function pageInfo(w, page) {
  const base = w.base_url.replace(/\/+$/, '');
  const webui = page._links?.webui;
  return {
    id: page.id,
    title: page.title,
    version: page.version?.number,
    when: page.version?.when ?? null,
    space: page.space?.key ?? null,
    url: webui ? `${page._links?.base || base}${webui}` : `${base}/pages/viewpage.action?pageId=${page.id}`,
  };
}

export async function getInfo(w, pageId) {
  return pageInfo(w, await request(w, 'GET', `/rest/api/content/${pageId}?expand=version,space`));
}

// Confluence storage XHTML -> 可读纯文本：标题转 #、列表转 -、表格行转 | a | b |，其余标签去掉
export function storageToText(html) {
  const decode = (t) => t
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
  let t = String(html)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, c) => `\n${c.replace(/</g, '&lt;')}\n`)
    .replace(/<ac:parameter[^>]*>[\s\S]*?<\/ac:parameter>/g, '')
    .replace(/<h([1-6])[^>]*>/gi, (_, n) => `\n${'#'.repeat(Number(n))} `).replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ').replace(/<\/li>/gi, '')
    .replace(/<tr[^>]*>/gi, '\n|').replace(/<\/t[hd]>/gi, ' |').replace(/<t[hd][^>]*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|ul|ol|table|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  t = decode(t);
  return t.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function getPage(w, pageId, { text = false } = {}) {
  const page = await request(w, 'GET', `/rest/api/content/${pageId}?expand=body.storage,version,space`);
  const storage = page.body?.storage?.value ?? '';
  return { ...pageInfo(w, page), ...(text ? { text: storageToText(storage) } : { storage }) };
}

export async function put(w, pageId, html, { expectVersion, title }) {
  const wf = checkWellFormed(html);
  if (!wf.ok) throw Object.assign(new Error(`XHTML 不良构，拒绝上传（第 ${wf.line} 行）：${wf.error}`), { exit: 3 });
  const before = await getInfo(w, pageId);
  if (before.version !== expectVersion) {
    throw Object.assign(new Error(`页面当前版本是 ${before.version}，不是确认过的 ${expectVersion}：有人刚修改过页面。重新运行 info 并再次向用户确认`), { exit: 1 });
  }
  await request(w, 'PUT', `/rest/api/content/${pageId}?expand=version`, {
    id: pageId,
    type: 'page',
    title: title || before.title,
    space: { key: before.space },
    version: { number: before.version + 1 },
    body: { storage: { value: html, representation: 'storage' } },
  });
  const after = await getInfo(w, pageId);
  if (after.version !== before.version + 1) {
    throw Object.assign(new Error(`上传后版本号是 ${after.version}，预期 ${before.version + 1}：写入可能失败，请到页面上核对`), { exit: 1 });
  }
  return { ...after, previous_version: before.version };
}

function parseArgs(argv) {
  const o = { cmd: argv[0], pos: [], expectVersion: null, title: '', text: false, record: '', version: null, url: '' };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--expect-version') o.expectVersion = Number(argv[++i]);
    else if (a === '--title') o.title = argv[++i] ?? '';
    else if (a === '--text') o.text = true;
    else if (a === '--record') o.record = argv[++i] ?? '';
    else if (a === '--version') o.version = Number(argv[++i]);
    else if (a === '--url') o.url = argv[++i] ?? '';
    else if (a.startsWith('--')) throw new UsageError(`未知参数 ${a}`);
    else o.pos.push(a);
  }
  return o;
}

export async function main(argv) {
  const o = parseArgs(argv);
  if (o.cmd === 'info' && o.pos.length === 1) {
    const w = loadWikiConfig();
    console.log(JSON.stringify(await getInfo(w, parsePageId(o.pos[0])), null, 2));
    return 0;
  }
  if (o.cmd === 'get' && o.pos.length === 1) {
    const w = loadWikiConfig();
    console.log(JSON.stringify(await getPage(w, parsePageId(o.pos[0]), { text: o.text }), null, 2));
    return 0;
  }
  if (o.cmd === 'put' && o.pos.length === 2) {
    if (!Number.isInteger(o.expectVersion)) throw new UsageError('put 需要 --expect-version <n>：先运行 info，把标题与版本给用户确认后再上传');
    const [htmlPath, page] = o.pos;
    if (!fs.existsSync(htmlPath)) throw new UsageError(`文件不存在：${htmlPath}`);
    if (o.record && !fs.existsSync(o.record)) throw new UsageError(`文件不存在：${o.record}`);
    const w = loadWikiConfig();
    const r = await put(w, parsePageId(page), fs.readFileSync(htmlPath, 'utf8'), o);
    if (o.record) recordFile(o.record, { pageId: r.id, version: r.version, url: r.url });
    console.log(JSON.stringify(o.record ? { ...r, recorded_in: o.record } : r, null, 2));
    return 0;
  }
  if (o.cmd === 'target' && o.pos.length === 1) {
    if (!fs.existsSync(o.pos[0])) throw new UsageError(`文件不存在：${o.pos[0]}`);
    const t = readTarget(fs.readFileSync(o.pos[0], 'utf8'));
    console.log(JSON.stringify(t ? { ok: true, ...t } : { ok: false, message: '该文档没有发布记录，需要用户提供 pageId 或 URL' }, null, 2));
    return t ? 0 : 1;
  }
  if (o.cmd === 'record' && o.pos.length === 2) {
    if (!Number.isInteger(o.version)) throw new UsageError('record 需要 --version <n>（上传后的新版本号）');
    if (!fs.existsSync(o.pos[0])) throw new UsageError(`文件不存在：${o.pos[0]}`);
    const info = { pageId: parsePageId(o.pos[1]), version: o.version, url: o.url || null };
    recordFile(o.pos[0], info);
    console.log(JSON.stringify({ ok: true, ...info, recorded_in: o.pos[0] }, null, 2));
    return 0;
  }
  throw new UsageError('用法: upload.mjs info <pageId|url> | get <pageId|url> [--text] | put <html> <pageId|url> --expect-version <n> [--title <标题>] [--record <md>] | target <md> | record <md> <pageId|url> --version <n> [--url <url>]');
}

const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => {
    console.error(`错误：${e.message}`);
    process.exit(e instanceof UsageError ? 2 : e.exit ?? 1);
  });
}
