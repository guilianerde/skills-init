// DocNexus：接入、模板导入记录与状态提示

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { templateStatus, STATUS_TEXT, TEMPLATES } from '../seed-templates.mjs';
import { TPL_DIR, IS_WIN, DOCNEXUS_SPEC, MANIFEST, PKG, CANON_DIR, step, ok, warn, fail, writeFile, readJson, toPosix, lstat, findManifests, removeLink, docnexusBin, docnexusWorkspace, docnexusInternal, HOME, INSTALL_BASES } from './core.mjs';

import { docnexusConfigured, docnexusConnected } from '../../workflow/scripts/docnexus-layout.mjs';
export { docnexusConnected } from '../../workflow/scripts/docnexus-layout.mjs';

// 破坏性升级：删除旧知识、运行环境与备份，不迁移、不回退。
// format 7 的知识输出不含 project.json / npm / skills 等内部文件，重复安装时保留它。
export function legacyDocNexusPaths(root) {
  const workspace = docnexusWorkspace(root);
  const oldOutput = ['project.json', 'package.json', 'node_modules', 'skills', 'schemas', 'drafts', 'store', '.runtime']
    .some((name) => lstat(path.join(workspace, name)));
  const marker = readJson(path.join(docnexusInternal(root), 'project.json'));
  const legacyRoot = path.join(root, 'docnexus');
  const rootPackage = readJson(path.join(legacyRoot, 'package.json'));
  const oldRoot = fs.existsSync(path.join(legacyRoot, 'project.json'))
    || Object.keys(rootPackage?.dependencies ?? {}).some((name) => /(^|\/)docnexus$/.test(name))
    || (marker?.format_version === 7 && marker.output_dir === '.');
  return [
    ...(oldOutput ? [workspace] : []),
    path.join(root, HOME, '.docnexus'),
    path.join(root, HOME, 'tmp', 'duplicate-docnexus'),
    ...(oldRoot ? [legacyRoot] : []),
    ...INSTALL_BASES.flatMap((base) => ['docnexus', 'docnexus-extract', 'docnexus-ingest', 'docnexus-recall', 'docnexus-library', 'docnexus-maintain']
      .map((name) => path.join(root, HOME, base, name))),
  ].filter((dir) => lstat(dir));
}

export function cleanupLegacyDocNexus(root) {
  root = path.resolve(root);
  const obsolete = legacyDocNexusPaths(root);
  // 目录本身的链接可移除；不能穿过父目录链接删除其他位置的文件。
  for (const dir of obsolete) {
    for (let parent = path.dirname(dir); parent !== path.resolve(root); parent = path.dirname(parent)) {
      if (lstat(parent)?.isSymbolicLink()) fail(`旧 DocNexus 路径的父目录是软链接，停止清理：${parent}`);
    }
  }
  const marker = readJson(path.join(docnexusInternal(root), 'project.json'));
  const oldSkills = obsolete.map((dir) => path.join(dir, 'skills'));
  for (const base of INSTALL_BASES) {
    const dir = path.join(root, base);
    for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      const link = path.join(dir, name);
      if (!lstat(link)?.isSymbolicLink()) continue;
      const target = path.resolve(dir, fs.readlinkSync(link).replace(/^\\\\\?\\/, ''));
      if (oldSkills.some((src) => target.startsWith(src + path.sep))) removeLink(link);
    }
  }
  for (const dir of obsolete) {
    if (!lstat(dir)) continue;
    if (lstat(dir).isSymbolicLink()) removeLink(dir); else fs.rmSync(dir, { recursive: true, force: true });
    warn(`破坏性更新：已删除旧版 ${toPosix(path.relative(root, dir))}/（不迁移、不备份）`);
  }
  if (marker && !docnexusConfigured(root)) {
    if (lstat(docnexusInternal(root))?.isSymbolicLink()) removeLink(docnexusInternal(root));
    else {
      for (const name of ['project.json', 'skills', 'schemas', 'drafts', 'store', '.runtime', '.docnexus-skills.json']) {
        fs.rmSync(path.join(docnexusInternal(root), name), { recursive: true, force: true });
      }
    }
    warn('破坏性更新：已清除旧版 .docnexus/ 的项目状态，运行依赖保留供重新初始化');
  }
  for (const file of ['CLAUDE.md', 'AGENTS.md', 'QWEN.md']) {
    dropBlock(path.join(root, HOME, file), CTX_START, CTX_END);
    dropBlock(path.join(root, HOME, file), '<!-- docnexus:start -->', '<!-- docnexus:end -->');
    if (obsolete.length || (marker && !docnexusConfigured(root))) dropBlock(path.join(root, file), '<!-- docnexus:start -->', '<!-- docnexus:end -->');
  }
  return obsolete;
}

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
// DocNexus 的 skills（.docnexus/skills/*）链接到所选 Agent 环境；init --agent none，由本工具统一接入。
// 已有的同名软链接换成新的；同名目录内容和 DocNexus 的一样（建不了链接时的拷贝）也换掉，否则跳过
export function linkDocNexusSkills(root, dirs) {
  const srcRoot = path.join(docnexusInternal(root), 'skills');
  const names = fs.existsSync(srcRoot) ? fs.readdirSync(srcRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : [];
  const sameSkill = (dir, name) => { const a = path.join(dir, 'SKILL.md'); const b = path.join(srcRoot, name, 'SKILL.md'); return fs.existsSync(a) && fs.existsSync(b) && fs.readFileSync(a).equals(fs.readFileSync(b)); };
  for (const rel of dirs) {
    const dst = path.join(root, rel);
    fs.mkdirSync(dst, { recursive: true });
    let n = 0;
    for (const name of names) {
      const link = path.join(dst, name);
      const st = lstat(link);
      if (st && !st.isSymbolicLink()) {
        if (!st.isDirectory() || !sameSkill(link, name)) { warn(`${link} 已存在且不是软链接，跳过（如需改用 DocNexus 版本请先移除）`); continue; }
        fs.rmSync(link, { recursive: true, force: true });
      }
      if (st?.isSymbolicLink()) removeLink(link);
      try { fs.symlinkSync(path.relative(dst, path.join(srcRoot, name)), link, 'dir'); n++; }
      catch (err) { warn(`无法创建软链接 ${link}（${err.code}）`); }
    }
    ok(`已链接 ${n} 个 DocNexus skill -> ${toPosix(rel)}`);
  }
}

// 本项目 agent 的说明段落：在业务项目根运行，知识路径使用 CLI 返回值。
// 用自己的标记，不碰 DocNexus 自己的段落
const CTX_START = '<!-- workflow-run:docnexus:start -->';
const CTX_END = '<!-- workflow-run:docnexus:end -->';
// AGENTS.md 由 codex / doubao / workbuddy 共用：命令指向装了 workflow 的那个目录（--copy 只装 workbuddy 时没有 .agents/skills）
function contextBlock(root, file) {
  const has = (dir) => fs.existsSync(path.join(root, dir, 'workflow', 'scripts', 'docnexus.mjs'));
  const dir = file === 'CLAUDE.md' ? '.claude/skills' : file === 'QWEN.md' ? '.qwen/skills' : ['.agents/skills', '.codebuddy/skills'].find(has) ?? '.agents/skills';
  const run = `${dir}/workflow/scripts/docnexus.mjs`;
  const index = file === 'CLAUDE.md' ? `@${HOME}/docnexus/CONCEPTS.md` : `\`${HOME}/docnexus/CONCEPTS.md\`（每个任务开始时读）`;
  return [
    CTX_START,
    `## DocNexus 项目记忆（在 ${HOME}/）`,
    '',
    `本项目的 DocNexus 工作区在 \`${HOME}/docnexus/\`，概念索引：${index}`,
    '',
    `- 运行环境、skills、草稿与检索索引在业务项目根的 \`.docnexus/\`；\`init --output-dir ${HOME}\` 将知识输出到 \`${HOME}/docnexus/\`，配置保存在 \`.docnexus/project.json\`。`,
    `- docnexus 系列 skill 的「项目根」就是业务项目根。命令用 \`./.docnexus/node_modules/.bin/docnexus <参数>\` 或 \`node ${run} <参数>\`；辅助脚本用 \`node ${run} --node .docnexus/skills/<…>.mjs <参数>\`。直接使用 status、draft、document 返回的路径，不再添加或剥离 workflow-run/ 前缀。`,
    '- 找不到运行环境或配置时，用 workflow-run 安装 / 升级修复；不要在 workflow-run/ 里安装、初始化第二份，也不要调用根目录旧 docnexus/ 或全局 CLI。',
    '- 规划或改代码前，看任务是否涉及概念索引里的概念，或已记录的决定、组件、约定；涉及就用 `docnexus-recall` skill 查，并以查到的内容为依据。',
    '- 任务产生值得保留的决定或知识时，提出用 `docnexus` skill 沉淀；没有用户同意不写入。',
    CTX_END,
  ].join('\n');
}
const insertBlock = (cur, start, end, block) => {
  const a = cur.indexOf(start); const b = cur.indexOf(end);
  return a >= 0 && b > a ? `${cur.slice(0, a)}${block}${cur.slice(b + end.length)}` : `${cur}${!cur || cur.endsWith('\n\n') ? '' : cur.endsWith('\n') ? '\n' : '\n\n'}${block}\n`;
};
// 删掉 start…end 段落，文件只剩这段时删文件；返回是否删了
function dropBlock(f, start, end) {
  if (!fs.existsSync(f)) return false;
  const cur = fs.readFileSync(f, 'utf8');
  const a = cur.indexOf(start); const b = cur.indexOf(end);
  if (a < 0 || b < a) return false;
  const rest = [cur.slice(0, a).replace(/\n+$/, ''), cur.slice(b + end.length).replace(/^\n+/, '')].filter(Boolean).join('\n\n');
  if (rest) fs.writeFileSync(f, `${rest}\n`); else fs.rmSync(f);
  return true;
}
export function writeDocNexusContext(root, files) {
  for (const file of files) {
    const f = path.join(root, file);
    const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    const next = insertBlock(cur, CTX_START, CTX_END, contextBlock(root, file));
    if (next !== cur) { fs.writeFileSync(f, next); ok(`${file} 已写入 DocNexus 段落（工作区在 ${HOME}/docnexus/）`); }
  }
}
export const removeDocNexusContext = (root) => ['CLAUDE.md', 'AGENTS.md', 'QWEN.md'].filter((file) => dropBlock(path.join(root, file), CTX_START, CTX_END));

// 选择的环境 → 本项目里要链接 DocNexus skills 的目录与要写段落的文件
function agentTargets(sel) {
  const dirs = new Set(); const files = new Set();
  if (sel.includes('claude')) { dirs.add(path.join('.claude', 'skills')); files.add('CLAUDE.md'); }
  if (sel.includes('codex') || sel.includes('doubao')) { dirs.add(CANON_DIR); files.add('AGENTS.md'); }
  if (sel.includes('qwen')) { dirs.add(path.join('.qwen', 'skills')); files.add('QWEN.md'); }
  // WorkBuddy 读项目的 AGENTS.md（与 CODEBUDDY.md 并存）
  if (sel.includes('workbuddy')) { dirs.add(path.join('.codebuddy', 'skills')); files.add('AGENTS.md'); }
  return { dirs: [...dirs], files: [...files] };
}

// 升级 / 重装都刷新本项目的链接与段落（DocNexus 新增或改名 skill 后跟上）
export function refreshDocNexusLinks(root, sel) {
  if (!docnexusConfigured(root)) return false;
  const t = agentTargets(sel);
  linkDocNexusSkills(root, t.dirs);
  writeDocNexusContext(root, t.files);
  return true;
}

export function setupDocNexus(root, sel) {
  const npmArgs = ['install', '--prefix', './.docnexus', '--save-exact', DOCNEXUS_SPEC];
  step(`接入 DocNexus（运行环境 .docnexus/；知识输出 ${HOME}/docnexus/）`);
  if (!run(IS_WIN ? 'npm.cmd' : 'npm', npmArgs, root)) { warn('npm 安装 DocNexus 失败，已跳过 DocNexus 接入（skills 已正常安装）'); return 'failed'; }
  const bin = docnexusBin(root);
  if (!bin) { warn('安装后未找到 .docnexus/node_modules/.bin/docnexus，已跳过 DocNexus 接入'); return 'failed'; }
  if (!run(bin, ['init', '--output-dir', HOME, '--agent', 'none'], root)) {
    warn(`DocNexus 初始化失败：需要支持 --output-dir 的 format 7 版本。修复后在项目根运行 ./.docnexus/node_modules/.bin/docnexus init --output-dir ${HOME} --agent none`);
    return 'failed';
  }
  if (!docnexusConfigured(root)) { warn('DocNexus 未生成 output_dir=workflow-run 的 format 7 配置，接入失败'); return 'failed'; }
  const t = agentTargets(sel);
  linkDocNexusSkills(root, t.dirs);
  writeDocNexusContext(root, t.files);
  if (sel.includes('doubao')) ok('doubao 与 codex 共用 .agents/skills，按 codex 接入');
  ok(`DocNexus 已初始化：.docnexus/ 运行环境，${HOME}/docnexus/ 知识输出`);
  return 'ok';
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


// 团队改过的模板（customized / untracked）与当前默认模板的差异：只读，不写 DocNexus。
// 只有导入时的哈希、没有导入时的原文，做不了三方合并，所以差异里同时包含团队自己的改动和默认模板的新改动。返回打印了几份
export function printTemplateDiffs(root) {
  const list = templateStatus(root, TPL_DIR, templateRecords(root), installedSkills(root)).filter((s) => ['customized', 'untracked'].includes(s.status));
  if (!list.length) { ok('没有需要手动合并的模板（团队改过、且默认模板有新版的）'); return 0; }
  for (const s of list) {
    const t = TEMPLATES.find((x) => x.file === s.file);
    const lib = path.join(HOME, 'docnexus', 'library', t.file);
    const def = path.join(TPL_DIR, t.src);
    step(`${lib}（${s.status === 'customized' ? '团队改过，默认模板有新版' : '无导入记录，内容与默认模板不同'}）`);
    console.log(`  --- 知识库：${lib}\n  +++ 新默认：${t.src}（workflow-run ${PKG.version}）`);
    const r = spawnSync('git', ['diff', '--no-index', '--no-color', '--', path.join(root, lib), def], { encoding: 'utf8' });
    if (r.error) { warn(`未找到 git，无法生成差异；请手动对比上面两个文件`); continue; }
    console.log(r.stdout.split('\n').filter((l) => !/^(diff --git|index |--- |\+\+\+ )/.test(l)).join('\n'));
  }
  console.log('「-」是知识库现有内容，「+」是新默认模板；其中既有团队自己的改动也有默认模板的新改动，只采纳需要的部分。合并方式：按 DocNexus 的更新流程改写知识库里的模板（写入需要授权）。');
  return list.length;
}
