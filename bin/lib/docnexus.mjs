// DocNexus：接入、模板导入记录与状态提示

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { templateStatus, STATUS_TEXT, TEMPLATES } from '../seed-templates.mjs';
import { TPL_DIR, IS_WIN, DOCNEXUS_PKG, MANIFEST, PKG, CANON_DIR, step, ok, warn, fail, writeFile, readJson, toPosix, lstat, findManifests, removeLink, docnexusBin, docnexusRoot, docnexusShared } from './core.mjs';

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
// DocNexus 的 skills（<DocNexus 根>/docnexus/skills/*）软链接到本项目的 agent skills 目录。
// DocNexus 在本项目时它自己只管 .claude / .agents，qwen 由这里补；DocNexus 在别处（团队文档仓库）时三处都由这里链接
export function linkDocNexusSkills(root, dirs) {
  const srcRoot = path.join(docnexusRoot(root), 'docnexus', 'skills');
  const names = fs.existsSync(srcRoot) ? fs.readdirSync(srcRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : [];
  for (const rel of dirs) {
    const dst = path.join(root, rel);
    fs.mkdirSync(dst, { recursive: true });
    let n = 0;
    for (const name of names) {
      const link = path.join(dst, name);
      const st = lstat(link);
      if (st && !st.isSymbolicLink()) { warn(`${link} 已存在且不是软链接，跳过（如需改用 DocNexus 版本请先移除）`); continue; }
      if (st) removeLink(link);
      try { fs.symlinkSync(path.relative(dst, path.join(srcRoot, name)), link, 'dir'); n++; }
      catch (err) { warn(`无法创建软链接 ${link}（${err.code}）`); }
    }
    ok(`已链接 ${n} 个 DocNexus skill -> ${toPosix(rel)}`);
  }
}
export function linkQwenDocNexus(root) {
  linkDocNexusSkills(root, [path.join('.qwen', 'skills')]);
  if (!docnexusShared(root)) ok('qwen：docnexus 本身不支持 qwen，由本工具补链');
}

// DocNexus 在别处时，它写的 CLAUDE.md / AGENTS.md 段落落在那个目录里；本项目的 agent 需要自己的一段：
// 概念索引在哪、docnexus 系列 skill 里的「项目根」指哪里。用自己的标记，不碰 DocNexus 的段落
const CTX_START = '<!-- skills-init:docnexus:start -->';
const CTX_END = '<!-- skills-init:docnexus:end -->';
function contextBlock(root, file) {
  const dn = toPosix(path.relative(root, docnexusRoot(root)));
  const index = file === 'CLAUDE.md' ? `@${dn}/docnexus/CONCEPTS.md` : `\`${dn}/docnexus/CONCEPTS.md\`（每个任务开始时读）`;
  return [
    CTX_START,
    `## DocNexus 项目记忆（在 ${dn}）`,
    '',
    `本项目的 DocNexus 工作区在 \`${dn}/docnexus/\`（团队共用的文档仓库），概念索引：${index}`,
    '',
    `- docnexus 系列 skill 里说的「项目根」指 \`${dn}\`：其中的命令（\`./docnexus/node_modules/.bin/docnexus …\`、\`node docnexus/skills/…\`）先 \`cd ${dn}\` 再运行，\`docnexus/library/<path>\` 等路径也相对 \`${dn}\`。`,
    '- 规划或改代码前，看任务是否涉及概念索引里的概念，或已记录的决定、组件、约定；涉及就用 `docnexus-recall` skill 查，并以查到的内容为依据。',
    '- 任务产生值得保留的决定或知识时，提出用 `docnexus` skill 沉淀；没有用户同意不写入。',
    CTX_END,
  ].join('\n');
}
export function writeDocNexusContext(root, files) {
  for (const file of files) {
    const f = path.join(root, file);
    const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    const a = cur.indexOf(CTX_START); const b = cur.indexOf(CTX_END);
    const block = contextBlock(root, file);
    const next = a >= 0 && b > a ? `${cur.slice(0, a)}${block}${cur.slice(b + CTX_END.length)}` : `${cur}${!cur || cur.endsWith('\n\n') ? '' : cur.endsWith('\n') ? '\n' : '\n\n'}${block}\n`;
    if (next !== cur) { fs.writeFileSync(f, next); ok(`${file} 已写入 DocNexus 段落（工作区在 ${toPosix(path.relative(root, docnexusRoot(root)))}）`); }
  }
}
export function removeDocNexusContext(root) {
  const removed = [];
  for (const file of ['CLAUDE.md', 'AGENTS.md']) {
    const f = path.join(root, file);
    if (!fs.existsSync(f)) continue;
    const cur = fs.readFileSync(f, 'utf8');
    const a = cur.indexOf(CTX_START); const b = cur.indexOf(CTX_END);
    if (a < 0 || b < a) continue;
    const rest = [cur.slice(0, a).replace(/\n+$/, ''), cur.slice(b + CTX_END.length).replace(/^\n+/, '')].filter(Boolean).join('\n\n');
    if (rest) fs.writeFileSync(f, `${rest}\n`); else fs.rmSync(f);
    removed.push(file);
  }
  return removed;
}

// 选择的环境 → 本项目里要链接 DocNexus skills 的目录与要写段落的文件
function agentTargets(sel) {
  const dirs = new Set(); const files = new Set();
  if (sel.includes('claude')) { dirs.add(path.join('.claude', 'skills')); files.add('CLAUDE.md'); }
  if (sel.includes('codex') || sel.includes('doubao')) { dirs.add(CANON_DIR); files.add('AGENTS.md'); }
  if (sel.includes('qwen')) dirs.add(path.join('.qwen', 'skills'));
  return { dirs: [...dirs], files: [...files] };
}

// DocNexus 在别处时，升级 / 重装都刷新本项目的链接与段落（DocNexus 新增或改名 skill 后跟上）
export function refreshSharedDocNexus(root, sel) {
  if (!docnexusShared(root) || !fs.existsSync(path.join(docnexusRoot(root), 'docnexus', 'project.json'))) return false;
  const t = agentTargets(sel);
  linkDocNexusSkills(root, t.dirs);
  writeDocNexusContext(root, t.files);
  return true;
}

// 写入 docnexus.root（所有已安装的 workflow/profile.json；单一来源时只有一份）
export function setDocNexusRoot(root, value) {
  const rel = value ? toPosix(path.relative(root, path.resolve(root, value))) || '.' : null;
  for (const b of [CANON_DIR, path.join('.claude', 'skills'), path.join('.qwen', 'skills')]) {
    const dir = path.join(root, b, 'workflow');
    const f = path.join(dir, 'profile.json');
    if (!fs.existsSync(f) || lstat(path.join(root, b, 'workflow'))?.isSymbolicLink() || lstat(path.join(root, b))?.isSymbolicLink()) continue;
    const p = readJson(f) ?? {};
    if (rel && rel !== '.') p.docnexus = { ...(p.docnexus ?? {}), root: rel };
    else if (p.docnexus) { delete p.docnexus.root; if (!Object.keys(p.docnexus).length) delete p.docnexus; }
    fs.writeFileSync(f, `${JSON.stringify(p, null, 2)}\n`);
  }
  ok(rel && rel !== '.' ? `DocNexus 位置：${rel}/docnexus/（workflow/profile.json 的 docnexus.root）` : 'DocNexus 位置：本项目 docnexus/');
}

export function setupDocNexus(root, sel) {
  const agent = docnexusAgent(sel);
  const dn = docnexusRoot(root);
  const shared = docnexusShared(root);
  const dnRel = toPosix(path.relative(root, dn));
  if (shared && !fs.existsSync(dn)) { warn(`docnexus.root 指向的目录 ${dnRel} 不存在：先把团队文档仓库克隆到这里再重跑（加 --with-docnexus），已跳过 DocNexus 接入`); return 'failed'; }
  // 0.17.0 起 DocNexus 装在 docnexus/ 下，npm 清单、锁文件与依赖不进宿主项目；之前装在项目根的沿用原位置升级
  const existing = docnexusBin(root);
  const legacyRoot = existing && path.relative(dn, existing).startsWith('node_modules');
  const npmArgs = legacyRoot ? ['i', '-D', DOCNEXUS_PKG] : ['install', '--prefix', './docnexus', '--save-exact', DOCNEXUS_PKG];
  // DocNexus 在别处时：它自己不链接 skills、不写 CLAUDE.md / AGENTS.md（那些会落在文档仓库里），改由本工具接到本项目
  const initAgent = shared ? 'none' : agent;
  step(`接入 DocNexus${shared ? `（位置 ${dnRel}/docnexus/）` : ''}（npm ${npmArgs.join(' ')}；docnexus init --agent ${initAgent}）`);
  if (legacyRoot) warn('检测到项目根已装 DocNexus（旧装法），沿用该位置升级；新装法见 DocNexus README（装在 docnexus/ 下）');
  if (!run(IS_WIN ? 'npm.cmd' : 'npm', npmArgs, dn)) { warn('npm 安装 DocNexus 失败，已跳过 DocNexus 接入（skills 已正常安装）'); return 'failed'; }
  const bin = docnexusBin(root);
  if (!bin) { warn('安装后未找到 docnexus/node_modules/.bin/docnexus，已跳过 DocNexus 接入'); return 'failed'; }
  const rel = `./${path.relative(dn, bin).split(path.sep).join('/')}`;
  if (!run(bin, ['init', '--agent', initAgent], dn, true)) {
    warn(`docnexus init 失败，已跳过 DocNexus 接入（可在 ${shared ? dnRel : '项目根'} 手动执行 ${rel} init --agent ${initAgent}）`);
    return 'failed';
  }
  ok(`docnexus init 完成：${shared ? `${dnRel}/` : ''}docnexus/ 工作区 + skills（docnexus/skills）`);
  if (shared) {
    const t = agentTargets(sel);
    linkDocNexusSkills(root, t.dirs);
    writeDocNexusContext(root, t.files);
    if (fs.existsSync(path.join(root, 'docnexus', 'project.json'))) warn(`本项目里还有一个 docnexus/ 工作区，现在已不再使用（DocNexus 改在 ${dnRel}）；里面的知识不会自动搬过去，需要的话按 DocNexus 的流程导入后再删除`);
    if (sel.includes('qwen')) warn('qwen：不会写 QWEN.md；需要自动召回时可在 QWEN.md 引用 AGENTS.md 中的 DocNexus 段落，或在 .qwen/settings.json 的 context.fileName 加入 AGENTS.md');
    return 'ok';
  }
  const where = { all: '.claude/skills 与 .agents/skills，并写入 CLAUDE.md / AGENTS.md', claude: '.claude/skills，并写入 CLAUDE.md', codex: '.agents/skills，并写入 AGENTS.md' }[agent];
  if (where) ok(`已链接到 ${where} 的 DocNexus 段落`);
  if (sel.includes('doubao')) ok('doubao 与 codex 共用 .agents/skills，按 codex 接入');
  if (sel.includes('qwen')) {
    linkQwenDocNexus(root);
    warn(agent === 'codex' || agent === 'all'
      ? 'qwen：docnexus 不会写 QWEN.md；需要自动召回时可在 QWEN.md 引用 AGENTS.md 中的 DocNexus 段落，或在 .qwen/settings.json 的 context.fileName 加入 AGENTS.md'
      : 'qwen：docnexus 不会写 QWEN.md；需要自动召回时可执行 ./docnexus/node_modules/.bin/docnexus init --agent codex 生成 AGENTS.md 的 DocNexus 段落，再在 QWEN.md 引用它或在 .qwen/settings.json 的 context.fileName 加入 AGENTS.md（会同时链接到 .agents/skills）');
  }
  return 'ok';
}

// 已装 DocNexus 是否支持调用方显式分类（draft seal --category，0.14.0 之后）。旧版会静默忽略该参数，
// skill 的写入仍靠 metadata.category 落到同一分类，只是不会记成调用方指定；这里只用于提示升级
function docnexusHelp(root) {
  const bin = docnexusBin(root);
  if (!bin) return null;
  const r = spawnSync(bin, ['--help'], { cwd: docnexusRoot(root), encoding: 'utf8', shell: IS_WIN });
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
  return fs.existsSync(path.join(docnexusRoot(root), 'docnexus', 'project.json')) && docnexusBin(root) !== null;
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
    const r = spawnSync('git', ['diff', '--no-index', '--no-color', '--', path.join(docnexusRoot(root), lib), def], { encoding: 'utf8' });
    if (r.error) { warn(`未找到 git，无法生成差异；请手动对比上面两个文件`); continue; }
    console.log(r.stdout.split('\n').filter((l) => !/^(diff --git|index |--- |\+\+\+ )/.test(l)).join('\n'));
  }
  console.log('「-」是知识库现有内容，「+」是新默认模板；其中既有团队自己的改动也有默认模板的新改动，只采纳需要的部分。合并方式：按 DocNexus 的更新流程改写知识库里的模板（写入需要授权）。');
  return list.length;
}
