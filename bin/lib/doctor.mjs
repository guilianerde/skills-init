// upgrade 参数推导与 doctor 自检

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PKG, CANON_DIR, DOCNEXUS_PKG, docnexusUpgradeCmd, SKILLS, step, ok, warn, fail, toPosix, fileHash, readManifest, lstat, findManifests, cmpVersion } from './core.mjs';
import { reportTemplateStatus, docnexusSupportsCategory, docnexusSupportsRecallCategory } from './docnexus.mjs';
import { codegraphVersion } from './codegraph.mjs';

// upgrade = 用清单里记录的环境与模式非交互重装；数据库配置原样保留
export function upgradeOptions(o) {
  const found = findManifests(o.root);
  if (!found.length) fail('未找到安装清单（.agents/skills/.skills-init.json 等），无法判断装过哪些环境。请先运行 init。');
  const m = found[0].m;
  const from = m.version ?? '未知';
  if (cmpVersion(from, PKG.version) > 0) warn(`已安装的是 ${from}，比当前包 ${PKG.version} 新；继续会降级。`);
  step(`升级：${from} -> ${PKG.version}（环境 ${(m.envs ?? []).join(',') || '未记录'}，模式 ${m.mode ?? 'symlink'}）`);
  const envs = Array.isArray(m.envs) && m.envs.length ? m.envs.join(',') : '';
  if (!envs) fail('安装清单里没有记录环境，请用 init --envs <列表> 重装。');
  // 只升级装过的 skill（--skills 子集安装时清单里只有这些）
  const skills = Object.keys(m.skills ?? {}).filter((s) => SKILLS.includes(s)).join(',');
  return { ...o, cmd: 'init', upgrading: true, envs, copy: m.mode === 'copy', yes: true, skipDb: true, skills: o.skills || skills };
}

export function doctor(root, offline) {
  const errors = [];
  const warns = [];
  const bad = (m) => { errors.push(m); console.log(`    XX  ${m}`); };
  const meh = (m) => { warns.push(m); warn(m); };
  step(`skills-init doctor（${PKG.version}）  ${root}`);

  const [maj] = process.versions.node.split('.').map(Number);
  if (maj < 22) bad(`Node v${process.versions.node} 低于 22（skills-init 只在 Node 22 / 24 上测试；18、20 已停止维护）`); else ok(`Node v${process.versions.node}`);

  const found = findManifests(root);
  if (!found.length) { bad('未找到安装清单：本项目还没用 skills-init 安装过（或是清单功能之前的旧版本安装，重跑 init 即可生成）'); return 1; }
  const m = found[0].m;
  const c = cmpVersion(m.version ?? '0', PKG.version);
  if (c < 0) meh(`已安装 ${m.version}，当前包是 ${PKG.version}：运行 skills-init upgrade 升级`);
  else if (c > 0) meh(`已安装 ${m.version}，比当前包 ${PKG.version} 新（当前包版本过旧）`);
  else ok(`已安装版本 ${m.version}（环境 ${(m.envs ?? []).join(',')}，模式 ${m.mode}）`);

  step('文件完整性');
  for (const { rel, base, m: man } of found) {
    let modified = 0, missing = 0;
    for (const [skill, entry] of Object.entries(man.skills)) {
      const dir = path.join(base, skill);
      if (!fs.existsSync(dir)) { bad(`${toPosix(path.join(rel, skill))} 不存在：运行 skills-init upgrade 恢复`); continue; }
      for (const [f, h] of Object.entries(entry.files ?? {})) {
        const file = path.join(dir, f);
        const label = toPosix(path.join(rel, skill, f));
        if (!fs.existsSync(file)) { missing++; meh(`缺少 ${label}：运行 skills-init upgrade 恢复`); }
        else if (fileHash(file) !== h) { modified++; meh(`${label} 被手动修改过（升级时不会被覆盖，新模板另存 .new）`); }
      }
      for (const f of entry.pending ?? []) if (fs.existsSync(path.join(dir, f))) meh(`${toPosix(path.join(rel, skill, f))} 待合并：对比后删除`);
    }
    if (!modified && !missing) ok(`${toPosix(rel)}：${Object.keys(man.skills).length} 个 skill 的模板文件与安装时一致`);
  }

  const canon = found.find((x) => x.rel === CANON_DIR);
  if (canon && m.mode !== 'copy') {
    step('软链接');
    for (const env of ['claude', 'qwen']) {
      if (!(m.envs ?? []).includes(env)) continue;
      const dir = path.join(root, `.${env}`, 'skills');
      let good = 0;
      for (const skill of Object.keys(canon.m.skills)) {
        const link = path.join(dir, skill);
        const st = lstat(link);
        if (!st) bad(`.${env}/skills/${skill} 不存在：运行 skills-init upgrade 重建`);
        else if (!st.isSymbolicLink()) { if (!readManifest(dir)) meh(`.${env}/skills/${skill} 是普通目录而非软链接（可能是建链接失败后的独立拷贝）`); else good++; }
        else if (!fs.existsSync(link)) bad(`.${env}/skills/${skill} 是断开的软链接`);
        else good++;
      }
      if (good === Object.keys(canon.m.skills).length) ok(`.${env}/skills 全部指向 ${toPosix(CANON_DIR)}`);
    }
  }

  // 画像 / DocNexus / 数据库：调用已安装的 resolve.mjs，与 skill 运行时的判定完全一致
  const skillsBase = (canon ?? found[0]).base;
  const resolveJs = path.join(skillsBase, 'workflow', 'scripts', 'resolve.mjs');
  step('项目画像与增强能力');
  let st = null;
  if (fs.existsSync(resolveJs)) {
    const r = spawnSync(process.execPath, [resolveJs, '--root', root, 'status'], { encoding: 'utf8' });
    try { st = JSON.parse(r.stdout); } catch { bad(`resolve.mjs status 执行失败：${(r.stderr || '').trim().split('\n')[0]}`); }
  } else bad('缺少 workflow/scripts/resolve.mjs：运行 skills-init upgrade');
  if (st) {
    if (st.profile.ok) ok('项目画像已填写'); else meh(`项目画像未完成（空字段：${st.profile.empty.join('、')}）：运行 /workflow profile`);
    if (st.wiki.ok) ok('wiki 已配置'); else console.log('    --  wiki 未配置（可选；也可能通过 wiki MCP 提供）');
    if (st.docnexus.ok) {
      if (!reportTemplateStatus(root, meh)) ok('DocNexus 已接入，文档模板齐全且与默认模板同步（或为团队定制版）');
      for (const f of st.docnexus.stale_project_templates) meh(`${f} 在接入 DocNexus 后已不再生效，建议删除`);
      if (docnexusSupportsCategory(root) === false) meh(`已装的 DocNexus 不支持 draft seal --category：各 skill 的分类只能经 metadata.category 写入，不记为调用方指定。升级：${docnexusUpgradeCmd(root)}`);
      else ok('DocNexus 支持调用方显式分类（draft seal --category）');
      if (docnexusSupportsRecallCategory(root) === false) meh(`已装的 DocNexus 不支持 recall --category：knowledge.mjs --query 只列文档，skill 改用不带分类的 recall。升级：${docnexusUpgradeCmd(root)}`);
      else ok('DocNexus 支持按分类检索（recall --category）');
    } else console.log('    --  DocNexus 未接入（可选）');
    if (st.codegraph?.ok) ok(`CodeGraph 已接入（codegraph ${codegraphVersion(root)}，索引在 .codegraph/）`);
    else if (st.codegraph?.indexed) meh('有 .codegraph/ 索引但找不到 codegraph 命令：npm i -g @colbymchenry/codegraph，或重跑 skills-init 并加 --with-codegraph');
    else if (st.codegraph?.cli) console.log('    --  已装 codegraph，但本项目没有建索引（可选：在项目根运行 codegraph init）');
    else console.log('    --  CodeGraph 未接入（可选）');
    if (!st.database.ok) console.log('    --  数据库未配置（可选）');
  }

  if (st?.database.ok) {
    step(offline ? '数据库（--offline，跳过连通性测试）' : '数据库连通性（只读 SELECT 1）');
    const queryJs = path.join(skillsBase, 'database-query', 'scripts', 'query.mjs');
    for (const [name, info] of Object.entries(st.database.connections)) {
      if (offline) { ok(`${name}：${info.driver}，${info.readonly ? '只读' : '可写'}`); continue; }
      const r = spawnSync(process.execPath, [queryJs, '--conn', name, '--timeout', '10', '--format', 'tsv', 'SELECT 1'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const msg = (r.stderr || '').trim().split('\n')[0];
      if (r.status === 0) ok(`${name}：连接正常（${info.readonly ? '只读' : '可写'}）`);
      else if (r.status === 3) console.log(`    --  ${name}：${msg}`);
      else meh(`${name}：${msg || '连接失败'}`);
    }
  }

  step('.gitignore');
  const gi = path.join(root, '.gitignore');
  const lines = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8').split(/\r?\n/).map((l) => l.trim()) : [];
  const need = ['**/database-query/config.json', '**/wiki-config.json'];
  const lack = need.filter((r) => !lines.includes(r));
  if (lack.length) bad(`.gitignore 缺少 ${lack.join(' ')}：凭据可能被提交，重跑 skills-init upgrade 补齐`); else ok('凭据文件已被忽略');

  console.log(`\n${errors.length} 个错误，${warns.length} 个警告`);
  return errors.length ? 1 : 0;
}
