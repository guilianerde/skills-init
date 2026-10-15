// DocNexus：接入、模板导入记录与状态提示

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { templateStatus, STATUS_TEXT, TEMPLATES } from '../seed-templates.mjs';
import { TPL_DIR, IS_WIN, DOCNEXUS_PKG, MANIFEST, PKG, step, ok, warn, fail, writeFile, lstat, findManifests } from './core.mjs';

export function run(cmd, args, cwd, quiet = false) {
  const r = spawnSync(cmd, args, { cwd, stdio: quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit', shell: IS_WIN });
  return r.status === 0;
}
export function checkNodeForDocNexus() {
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 22 || (maj === 22 && min < 13)) fail(`--with-docnexus 需要 Node >= 22.13，当前为 v${process.versions.node}。请升级 Node 后重试，或去掉 --with-docnexus。`);
  if (spawnSync(IS_WIN ? 'npm.cmd' : 'npm', ['-v'], { stdio: 'ignore', shell: IS_WIN }).status !== 0) fail('--with-docnexus 需要 npm，但未找到。请安装后重试，或去掉 --with-docnexus。');
  ok(`Node v${process.versions.node}`);
}
export function docnexusAgent(sel) {
  const c = sel.includes('claude');
  const x = sel.includes('codex') || sel.includes('doubao');
  return c && x ? 'all' : c ? 'claude' : x ? 'codex' : 'none';
}
export function linkQwenDocNexus(root) {
  const srcRoot = path.join(root, 'docnexus', 'skills');
  const dst = path.join(root, '.qwen', 'skills');
  fs.mkdirSync(dst, { recursive: true });
  let n = 0;
  for (const e of fs.existsSync(srcRoot) ? fs.readdirSync(srcRoot, { withFileTypes: true }) : []) {
    if (!e.isDirectory()) continue;
    const link = path.join(dst, e.name);
    const st = lstat(link);
    if (st && !st.isSymbolicLink()) { warn(`${link} 已存在且不是软链接，跳过（如需改用 DocNexus 版本请先移除）`); continue; }
    if (st) fs.rmSync(link, { force: true });
    try { fs.symlinkSync(path.join('..', '..', 'docnexus', 'skills', e.name), link, 'dir'); n++; }
    catch (err) { warn(`qwen：无法创建软链接 ${link}（${err.code}）`); }
  }
  ok(`qwen：已链接 ${n} 个 DocNexus skill -> .qwen/skills（docnexus 本身不支持 qwen，由本工具补链）`);
}
export function setupDocNexus(root, sel) {
  const agent = docnexusAgent(sel);
  step(`接入 DocNexus（npm i -D ${DOCNEXUS_PKG}；docnexus init --agent ${agent}）`);
  if (!fs.existsSync(path.join(root, 'package.json'))) warn('项目根没有 package.json，npm 会新建一个（仅记录 devDependency）');
  if (!run(IS_WIN ? 'npm.cmd' : 'npm', ['i', '-D', DOCNEXUS_PKG], root)) { warn('npm 安装 DocNexus 失败，已跳过 DocNexus 接入（skills 已正常安装）'); return 'failed'; }
  const bin = path.join(root, 'node_modules', '.bin', IS_WIN ? 'docnexus.cmd' : 'docnexus');
  if (!fs.existsSync(bin)) { warn('未找到 node_modules/.bin/docnexus，已跳过 DocNexus 接入'); return 'failed'; }
  if (!run(bin, ['init', '--agent', agent], root, true)) {
    warn(`docnexus init 失败，已跳过 DocNexus 接入（可在项目根手动执行 ./node_modules/.bin/docnexus init --agent ${agent}）`);
    return 'failed';
  }
  ok('docnexus init 完成：docnexus/ 工作区 + skills（docnexus/skills）');
  const where = { all: '.claude/skills 与 .agents/skills，并写入 CLAUDE.md / AGENTS.md', claude: '.claude/skills，并写入 CLAUDE.md', codex: '.agents/skills，并写入 AGENTS.md' }[agent];
  if (where) ok(`已链接到 ${where} 的 DocNexus 段落`);
  if (sel.includes('doubao')) ok('doubao 与 codex 共用 .agents/skills，按 codex 接入');
  if (sel.includes('qwen')) {
    linkQwenDocNexus(root);
    warn(agent === 'codex' || agent === 'all'
      ? 'qwen：docnexus 不会写 QWEN.md；需要自动召回时可在 QWEN.md 引用 AGENTS.md 中的 DocNexus 段落，或在 .qwen/settings.json 的 context.fileName 加入 AGENTS.md'
      : 'qwen：docnexus 不会写 QWEN.md；需要自动召回时可执行 ./node_modules/.bin/docnexus init --agent codex 生成 AGENTS.md 的 DocNexus 段落，再在 QWEN.md 引用它或在 .qwen/settings.json 的 context.fileName 加入 AGENTS.md（会同时链接到 .agents/skills）');
  }
  return 'ok';
}

// 已装 DocNexus 是否支持调用方显式分类（draft seal --category，0.14.0 之后）。旧版会静默忽略该参数，
// skill 的写入仍靠 metadata.category 落到同一分类，只是不会记成调用方指定；这里只用于提示升级
function docnexusHelp(root) {
  const bin = path.join(root, 'node_modules', '.bin', IS_WIN ? 'docnexus.cmd' : 'docnexus');
  if (!fs.existsSync(bin)) return null;
  const r = spawnSync(bin, ['--help'], { cwd: root, encoding: 'utf8', shell: IS_WIN });
  return `${r.stdout}${r.stderr}`;
}
export function docnexusSupportsCategory(root) {
  const h = docnexusHelp(root);
  return h === null ? null : /--category-reason/.test(h);
}
// recall --category（0.16.0 起）：knowledge.mjs --query 按分类检索；旧版退回不带分类的 recall
export function docnexusSupportsRecallCategory(root) {
  const h = docnexusHelp(root);
  return h === null ? null : /recall[^\n]*--category/.test(h);
}

export function templateRecords(root) { return findManifests(root)[0]?.m.templates ?? {}; }
// 已安装的 skill（有安装清单时以清单为准），模板导入与状态只针对它们
export function installedSkills(root) { const m = findManifests(root)[0]?.m; return m ? Object.keys(m.skills ?? {}) : undefined; }
export function saveTemplateRecords(root, recs) {
  if (!Object.keys(recs).length) return;
  const found = findManifests(root)[0];
  if (!found) return; // 没有安装清单（只单独跑了 seed-templates）：无处记录，之后 doctor 显示为 untracked
  found.m.templates = { ...(found.m.templates ?? {}), ...recs };
  writeFile(path.join(found.base, MANIFEST), JSON.stringify(found.m, null, 2) + '\n');
}
// 打印需要关注的模板状态，返回是否有需要处理的
export function reportTemplateStatus(root, say = warn) {
  const list = templateStatus(root, TPL_DIR, templateRecords(root), installedSkills(root)).filter((s) => !['current', 'edited'].includes(s.status));
  for (const s of list) say(`DocNexus 模板 ${s.file}：${STATUS_TEXT[s.status]}${s.status === 'customized' || s.status === 'untracked' ? `（默认模板：${s.defaultPath}）` : ''}`);
  return list.length > 0;
}

export function docnexusConnected(root) {
  return fs.existsSync(path.join(root, 'docnexus', 'project.json')) && fs.existsSync(path.join(root, 'node_modules', '.bin', IS_WIN ? 'docnexus.cmd' : 'docnexus'));
}

// 团队改过的模板（customized / untracked）与当前默认模板的差异：只读，不写 DocNexus。
// 只有导入时的哈希、没有导入时的原文，做不了三方合并，所以差异里同时包含团队自己的改动和默认模板的新改动。返回打印了几份
export function printTemplateDiffs(root) {
  const list = templateStatus(root, TPL_DIR, templateRecords(root), installedSkills(root)).filter((s) => ['customized', 'untracked'].includes(s.status));
  if (!list.length) { ok('没有需要手动合并的模板（团队改过、且默认模板有新版的）'); return 0; }
  for (const s of list) {
    const t = TEMPLATES.find((x) => x.file === s.file);
    const lib = path.join('docnexus', 'library', t.file);
    const def = path.join(TPL_DIR, t.src);
    step(`${lib}（${s.status === 'customized' ? '团队改过，默认模板有新版' : '无导入记录，内容与默认模板不同'}）`);
    console.log(`  --- 知识库：${lib}\n  +++ 新默认：${t.src}（skills-init ${PKG.version}）`);
    const r = spawnSync('git', ['diff', '--no-index', '--no-color', '--', path.join(root, lib), def], { encoding: 'utf8' });
    if (r.error) { warn(`未找到 git，无法生成差异；请手动对比上面两个文件`); continue; }
    console.log(r.stdout.split('\n').filter((l) => !/^(diff --git|index |--- |\+\+\+ )/.test(l)).join('\n'));
  }
  console.log('「-」是知识库现有内容，「+」是新默认模板；其中既有团队自己的改动也有默认模板的新改动，只采纳需要的部分。合并方式：按 DocNexus 的更新流程改写知识库里的模板（写入需要授权）。');
  return list.length;
}
