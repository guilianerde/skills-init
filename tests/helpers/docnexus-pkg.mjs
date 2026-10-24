// 本地 DocNexus 包夹具（迷你实现）。
//
// 背景：DocNexus 改成必装组件后，安装器每次 init / upgrade 都会真的执行
// `npm install --prefix ./.docnexus --save-exact <DOCNEXUS_SPEC>`，再检查
// .docnexus/node_modules/.bin/docnexus，然后调 `docnexus init` 初始化、调
// `docnexus draft new / seal / document add` 导入模板。测试里原本用来伪造
// codegraph 全局安装的假 npm（什么都不做直接 exit 0）因此会让接入失败。
//
// 这里给测试一个本地包：DOCNEXUS_PKG 指向它时安装器不追加 @latest（本地来源
// 没有 tag），配合 offline 让 npm 完全不碰 registry，测试也就不再依赖网络与
// 全局缓存。桩 CLI 实现安装器真正用到的那几条命令，行为足够真实：
//
//   init              写 .docnexus/project.json（format_version 7 + output_dir）
//   draft new         建草稿，返回 artifacts.source / document / metadata 路径
//   draft seal        记录 --file，供 document add 定位
//   document add      把草稿正文落到 workflow-run/docnexus/library/<file>
//   document query    列出已入库文档（--update 流程用）
//   document get      取回单篇的 metadata 与 record_version
//   draft discard     丢弃草稿
//
// 用法（在测试文件顶层调用一次；spawn 出来的安装器要么继承 process.env，
// 要么展开 { ...process.env }，因此不必逐个改调用点）：
//
//   import { useLocalDocNexus } from './helpers/docnexus-pkg.mjs';
//   useLocalDocNexus();
//
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 供测试把 draft 协议拼进自己的假 CLI：安装器在接入后会调 draft new / seal /
// document add 导入模板，缺少这几条命令会让接入失败。片段假设外层已经解析出
// cmd / sub / rest / fs / path，并定义了 root 与 DN。
export const draftProtocolSource = () => `
const DN = path.join(process.cwd(), '.docnexus');
const STORE = path.join(DN, 'store.json');
const LIB = path.join(process.cwd(), 'workflow-run', 'docnexus', 'library');
const readStore = () => { try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { return { drafts: {}, documents: [] }; } };
const saveStore = (s) => { fs.mkdirSync(path.dirname(STORE), { recursive: true }); fs.writeFileSync(STORE, JSON.stringify(s, null, 2)); };
const flagOf = (n) => { const i = process.argv.indexOf(n); return i < 0 ? null : process.argv[i + 1]; };
const relTo = (p) => path.relative(process.cwd(), p).split(path.sep).join('/');
{
  const store = readStore();
  if (cmd === 'draft' && sub === 'new') {
    const id = 'draft-' + Math.random().toString(16).slice(2, 10);
    const dir = path.join(DN, 'drafts', id);
    fs.mkdirSync(dir, { recursive: true });
    store.drafts[id] = { dir }; saveStore(store);
    console.log(JSON.stringify({ draft_id: id, artifacts: { source: relTo(path.join(dir, 'source.md')), document: relTo(path.join(dir, 'document.md')), metadata: relTo(path.join(dir, 'metadata.json')) } }));
    process.exit(0);
  }
  if (cmd === 'draft' && sub === 'seal') {
    const id = flagOf('--id');
    if (store.drafts[id]) { store.drafts[id].file = flagOf('--file'); saveStore(store); }
    console.log(JSON.stringify({ ok: true })); process.exit(0);
  }
  if (cmd === 'draft' && sub === 'discard') {
    const id = flagOf('--id');
    if (store.drafts[id]) { fs.rmSync(store.drafts[id].dir, { recursive: true, force: true }); delete store.drafts[id]; saveStore(store); }
    console.log(JSON.stringify({ ok: true })); process.exit(0);
  }
  if (cmd === 'document' && sub === 'add') {
    const draft = store.drafts[flagOf('--draft')];
    if (draft && draft.file) {
      const dest = path.join(LIB, draft.file);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(draft.dir, 'document.md'), dest);
    }
    console.log(JSON.stringify({ ok: true })); process.exit(0);
  }
}
`;

export const STUB_CLI = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const root = process.cwd();
const DN = path.join(root, '.docnexus');
const STORE = path.join(DN, 'store.json');
const LIB = path.join(root, 'workflow-run', 'docnexus', 'library');

const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const write = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2)); };
const flag = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
const out = (o) => { process.stdout.write(JSON.stringify(o)); process.exit(0); };
const rel = (p) => path.relative(root, p).split(path.sep).join('/');

const cmd = args[0];
const sub = args[1];

if (cmd === 'init') {
  // 安装器随后会用 docnexusConfigured 校验 format_version 与 output_dir
  const output = flag('--output-dir') || 'workflow-run';
  write(path.join(DN, 'project.json'), { format_version: 7, output_dir: output });
  out({ ok: true });
}

const store = read(STORE, { drafts: {}, documents: [] });
const save = () => write(STORE, store);

if (cmd === 'draft' && sub === 'new') {
  const id = 'draft-' + Math.random().toString(16).slice(2, 10);
  const dir = path.join(DN, 'drafts', id);
  fs.mkdirSync(dir, { recursive: true });
  store.drafts[id] = { dir };
  save();
  out({
    draft_id: id,
    artifacts: {
      source: rel(path.join(dir, 'source.md')),
      document: rel(path.join(dir, 'document.md')),
      metadata: rel(path.join(dir, 'metadata.json')),
    },
  });
}

if (cmd === 'draft' && sub === 'seal') {
  const id = flag('--id');
  if (!store.drafts[id]) { process.stderr.write('draft not found'); process.exit(1); }
  store.drafts[id].file = flag('--file');
  save();
  out({ ok: true });
}

if (cmd === 'draft' && sub === 'discard') {
  const id = flag('--id');
  if (store.drafts[id]) { fs.rmSync(store.drafts[id].dir, { recursive: true, force: true }); delete store.drafts[id]; save(); }
  out({ ok: true });
}

if (cmd === 'document' && sub === 'add') {
  const id = flag('--draft');
  const draft = store.drafts[id];
  if (!draft || !draft.file) { process.stderr.write('no sealed draft'); process.exit(1); }
  const body = fs.readFileSync(path.join(draft.dir, 'document.md'), 'utf8');
  const meta = read(path.join(draft.dir, 'metadata.json'), {});
  const dest = path.join(LIB, draft.file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, body);
  const existing = store.documents.find((d) => d.file_path === draft.file);
  const record_version = (existing ? existing.record_version : 0) + 1;
  if (existing) { existing.record_version = record_version; existing.metadata = meta; }
  else store.documents.push({ id: 'doc-' + store.documents.length, file_path: draft.file, record_version, metadata: meta });
  save();
  out({ ok: true });
}

if (cmd === 'document' && sub === 'query') {
  const cat = flag('--category');
  const docs = store.documents.filter((d) => !cat || d.metadata?.category === cat)
    .map((d) => ({ id: d.id, file_path: d.file_path, record_version: d.record_version, ...(d.metadata || {}) }));
  out({ documents: docs });
}

if (cmd === 'document' && sub === 'get') {
  const doc = store.documents.find((d) => d.id === flag('--id'));
  if (!doc) { process.stderr.write('document not found'); process.exit(1); }
  out({ metadata: doc.metadata || {}, record_version: doc.record_version });
}

// 其余命令（本文没实现到的）不报错，避免测试因为无关命令挂掉
out({ ok: true });
`;

// 只建一次：同一个测试进程里多个用例共用同一份包与缓存目录。
let cached = null;

export function localDocNexusPkg() {
  if (cached) return cached;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docnexus-pkg-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: '@rowansenne/docnexus',
    version: '0.27.1',
    bin: { docnexus: 'cli.cjs' },
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'cli.cjs'), STUB_CLI, { mode: 0o755 });
  cached = {
    root,
    cache: fs.mkdtempSync(path.join(os.tmpdir(), 'docnexus-npm-cache-')),
  };
  return cached;
}

// 离线 + 本地缓存：npm 不去 registry，也不写用户的 ~/.npm（沙箱里写不进去）。
//
// install_links 很关键：不加时 npm 会把 file: 依赖软链接到夹具目录，于是
// .docnexus/node_modules/.bin/docnexus 是指向共享 cli.cjs 的软链接；测试里常见
// 的 fs.writeFileSync(bin, 自己的假 CLI) 会穿透软链接把共享夹具覆盖掉，后续用
// 例就再也跑不起来（表现为第一个用例通过、其余全挂）。设为 true 让 npm 复制，
// 每个项目拿到自己的副本，测试各自改写互不影响。
export function localDocNexusEnv() {
  const { root, cache } = localDocNexusPkg();
  return {
    DOCNEXUS_PKG: root,
    npm_config_cache: cache,
    npm_config_offline: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_install_links: 'true',
  };
}

// 写进 process.env，供本文件里所有 spawn 继承。
export function useLocalDocNexus() {
  Object.assign(process.env, localDocNexusEnv());
}

// 显式合并到某个 spawn 的 env（需要覆盖或不想污染 process.env 时用）。
export function withLocalDocNexus(env = process.env) {
  return { ...env, ...localDocNexusEnv() };
}

// 安装现在一定会接入 DocNexus。需要自己控制接入状态的测试（例如验证「未接入时
// 的行为」「库中模板缺失时的提示」），装完先回到未接入基线，再按各自需要手工搭。
export function resetDocNexus(root) {
  fs.rmSync(path.join(root, '.docnexus'), { recursive: true, force: true });
  fs.rmSync(path.join(root, 'workflow-run', 'docnexus'), { recursive: true, force: true });
}
