// 把 skills-init 自带的文档模板导入 DocNexus（seed-templates），并跟踪导入时的版本。
// 模板存为 skills-init/docnexus/library/templates/<skill>/<文件名>，分类 doc-template；接入 DocNexus 后文档类 skill 只从这里读取模板，
// 之后模板随 DocNexus 知识库更新（每次变更都有 timeline）。
//
// 导入记录（records）：{ "<库内路径>": { version, sha256 } }，保存在安装清单的 templates 字段，用来区分：
//   current     知识库模板与当前默认模板一致
//   outdated    知识库模板没被改过（仍是导入时的内容），但默认模板有新版 → seed-templates --update 可直接更新
//   customized  知识库模板被团队改过，默认模板也有新版 → 需要人工对比合并（不自动改）
//   edited      知识库模板被团队改过，默认模板没变 → 正常
//   untracked   没有导入记录（本功能之前导入的），且内容与默认模板不同 → 无法判断，只提示
//   missing     知识库里没有

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadSkills, deriveMeta, TEMPLATE_CATEGORY, TEMPLATE_CATEGORY_REASON } from './skills.mjs';
import { docnexusBin, docnexusRoot } from './lib/core.mjs';

// 模板清单来自各 skill 的 skill.json（templates 字段）。没有 src 的（技术方案、上线方案）不随 skills 提供默认版本，
// 由用户第一次使用时按样例创建，不在导入与版本跟踪之列
export const TEMPLATES = deriveMeta(loadSkills(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))).templates.filter((t) => t.src);
export { TEMPLATE_CATEGORY };

const IS_WIN = process.platform === 'win32';
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
// DocNexus 以 skills-init/ 为项目根：命令在那里运行，草稿与知识库路径也相对那里
const binPath = (root) => docnexusBin(root) ?? path.join(docnexusRoot(root), 'docnexus', 'node_modules', '.bin', IS_WIN ? 'docnexus.cmd' : 'docnexus');

function docnexus(root, args) {
  const r = spawnSync(binPath(root), args, { cwd: docnexusRoot(root), encoding: 'utf8', shell: IS_WIN, maxBuffer: 64 * 1024 * 1024 });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* 非 JSON 输出 */ }
  return { ok: r.status === 0, json, err: (r.stderr || r.stdout || '').trim() };
}

function requireDocNexus(root) {
  if (!fs.existsSync(path.join(docnexusRoot(root), 'docnexus', 'project.json')) || !docnexusBin(root)) {
    throw new Error('未检测到 DocNexus（需要 skills-init/docnexus/project.json 与 skills-init/docnexus/node_modules/.bin/docnexus）。先加 --with-docnexus 接入。');
  }
}

const libFile = (root, t) => path.join(docnexusRoot(root), 'docnexus', 'library', t.file);
const defaultContent = (tplDir, t) => fs.readFileSync(path.join(tplDir, t.src), 'utf8');

// 写草稿并提交；baseVersion 为 'new'（新建）或已有记录的 record_version（更新，带 --replace）。成功返回 null，失败返回错误信息
// 分类以调用方显式分类封存（--category doc-template），不走模型分类；不支持该参数的旧版 DocNexus 会忽略它，仍按 metadata.category 入库
function writeDraft(root, t, content, metadata, baseVersion) {
  const draft = docnexus(root, ['draft', 'new', '--slug', `template-${t.skill}`]);
  if (!draft.ok || !draft.json?.artifacts) return draft.err || 'draft new 失败';
  const a = draft.json.artifacts;
  const dn = docnexusRoot(root);
  fs.writeFileSync(path.join(dn, a.source), content);
  fs.writeFileSync(path.join(dn, a.document), content);
  fs.writeFileSync(path.join(dn, a.metadata), JSON.stringify(metadata, null, 2) + '\n');
  const seal = docnexus(root, ['draft', 'seal', '--id', draft.json.draft_id, '--file', t.file, '--base-version', baseVersion,
    '--category', TEMPLATE_CATEGORY, '--category-reason', TEMPLATE_CATEGORY_REASON]);
  const add = seal.ok ? docnexus(root, ['document', 'add', '--draft', draft.json.draft_id, ...(baseVersion === 'new' ? [] : ['--replace'])]) : seal;
  if (add.ok) return null;
  docnexus(root, ['draft', 'discard', '--id', draft.json.draft_id, '--force']);
  return add.err || '提交失败';
}

const newMetadata = (t) => ({
  title: t.title,
  summary: t.summary,
  category: TEMPLATE_CATEGORY,
  category_reason: TEMPLATE_CATEGORY_REASON,
  tags: ['skills-init-template', t.skill],
  entities: [],
  relationships: [],
});

// 导入缺失的模板。返回 { seeded, skipped, failed: [{ file, error }], records }；records 为本次导入的记录
// skills：只处理这些 skill 的模板（缺省为全部），--skills 子集安装时不导入没装的 skill 的模板
const pick = (skills) => (skills ? TEMPLATES.filter((t) => skills.includes(t.skill)) : TEMPLATES);

export function seedTemplates(root, tplDir, { ok = console.log, warn = console.error, version = '', skills, quietSkip = false } = {}) {
  requireDocNexus(root);
  const result = { seeded: [], skipped: [], failed: [], records: {} };
  for (const t of pick(skills)) {
    if (fs.existsSync(libFile(root, t))) {
      result.skipped.push(t.file);
      if (!quietSkip) ok(`DocNexus 中已有 ${t.file}，保留不覆盖`);
      continue;
    }
    const content = defaultContent(tplDir, t);
    const err = writeDraft(root, t, content, newMetadata(t), 'new');
    if (err) { result.failed.push({ file: t.file, error: err }); warn(`导入 ${t.file} 失败：${err}`); continue; }
    result.seeded.push(t.file);
    result.records[t.file] = { version, sha256: sha256(content) };
    ok(`已导入 DocNexus：skills-init/docnexus/library/${t.file}`);
  }
  return result;
}

// 只读文件，不调用 docnexus；records 来自安装清单
export function templateStatus(root, tplDir, records = {}, skills) {
  return pick(skills).map((t) => {
    if (!fs.existsSync(libFile(root, t))) return { file: t.file, status: 'missing', seededFrom: null, defaultPath: t.src };
    const def = sha256(defaultContent(tplDir, t));
    const lib = sha256(fs.readFileSync(libFile(root, t), 'utf8'));
    const rec = records[t.file];
    let status;
    if (lib === def) status = 'current';
    else if (!rec) status = 'untracked';
    else if (lib === rec.sha256) status = 'outdated';
    else status = rec.sha256 === def ? 'edited' : 'customized';
    return { file: t.file, status, seededFrom: rec?.version ?? null, defaultPath: t.src };
  });
}

// 把 outdated 的模板更新为当前默认模板（保留库中已有的元数据）。返回 { updated, failed, records }
export function updateTemplates(root, tplDir, records = {}, { ok = console.log, warn = console.error, version = '', skills } = {}) {
  requireDocNexus(root);
  const result = { updated: [], failed: [], records: {} };
  const targets = templateStatus(root, tplDir, records, skills).filter((s) => s.status === 'outdated');
  if (!targets.length) { ok('没有可自动更新的模板（只更新导入后未被改动、且默认模板有新版的）'); return result; }
  const q = docnexus(root, ['document', 'query', '--all', '--category', TEMPLATE_CATEGORY]);
  if (!q.ok) throw new Error(`document query 失败：${q.err}`);
  for (const s of targets) {
    const t = TEMPLATES.find((x) => x.file === s.file);
    const doc = (q.json?.documents ?? []).find((d) => d.file_path === t.file);
    if (!doc) { result.failed.push({ file: t.file, error: '知识库中找不到对应记录' }); warn(`更新 ${t.file} 失败：知识库中找不到对应记录`); continue; }
    const got = docnexus(root, ['document', 'get', '--id', doc.id, '--include', 'metadata']);
    // 保留库中已有的元数据，但分类固定为 doc-template（模板按这个分类查询）
    const metadata = got.ok && got.json?.metadata
      ? { ...got.json.metadata, category: TEMPLATE_CATEGORY, category_reason: TEMPLATE_CATEGORY_REASON }
      : newMetadata(t);
    const content = defaultContent(tplDir, t);
    const err = writeDraft(root, t, content, metadata, got.json?.record_version ?? doc.record_version);
    if (err) { result.failed.push({ file: t.file, error: err }); warn(`更新 ${t.file} 失败：${err}`); continue; }
    result.updated.push(t.file);
    result.records[t.file] = { version, sha256: sha256(content) };
    ok(`已更新 DocNexus 模板：skills-init/docnexus/library/${t.file}（原导入自 ${s.seededFrom || '未知版本'}）`);
  }
  return result;
}

export const STATUS_TEXT = {
  current: '与默认模板一致',
  outdated: '默认模板有新版，库中模板未改动：运行 skills-init seed-templates --update 更新',
  customized: '团队改过，默认模板也有新版：运行 skills-init seed-templates --diff 查看差异后手动合并',
  edited: '团队改过（默认模板无变化）',
  untracked: '没有导入记录，内容与默认模板不同：如需采用新默认模板，运行 skills-init seed-templates --diff 对比',
  missing: '知识库中缺失：运行 skills-init seed-templates 导入（upgrade 时会自动导入）',
};
