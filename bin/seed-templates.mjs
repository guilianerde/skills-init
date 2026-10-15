// 把 skills-init 自带的文档模板导入 DocNexus（--seed-templates）。
// 模板存为 docnexus/library/templates/<skill>/<文件名>，分类 doc-template；文档类 skill 优先从这里读取模板，
// 之后模板随 DocNexus 知识库更新（每次变更都有 timeline）。已存在的模板一律不覆盖。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadSkills, deriveMeta, TEMPLATE_CATEGORY } from './skills.mjs';

// 模板清单来自各 skill 的 skill.json（templates 字段）
export const TEMPLATES = deriveMeta(loadSkills(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))).templates;
export { TEMPLATE_CATEGORY };

const IS_WIN = process.platform === 'win32';

function docnexus(root, args) {
  const bin = path.join(root, 'node_modules', '.bin', IS_WIN ? 'docnexus.cmd' : 'docnexus');
  const r = spawnSync(bin, args, { cwd: root, encoding: 'utf8', shell: IS_WIN });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* 非 JSON 输出 */ }
  return { ok: r.status === 0, json, err: (r.stderr || r.stdout || '').trim() };
}

// 返回 { seeded: [...], skipped: [...], failed: [{ file, error }] }；DocNexus 不可用时抛出带说明的错误
export function seedTemplates(root, tplDir, { ok = console.log, warn = console.error } = {}) {
  const bin = path.join(root, 'node_modules', '.bin', IS_WIN ? 'docnexus.cmd' : 'docnexus');
  if (!fs.existsSync(path.join(root, 'docnexus', 'project.json')) || !fs.existsSync(bin)) {
    throw new Error('未检测到 DocNexus（需要 docnexus/project.json 与 node_modules/.bin/docnexus）。先加 --with-docnexus 接入，或在项目根执行 npx docnexus init。');
  }
  const result = { seeded: [], skipped: [], failed: [] };
  for (const t of TEMPLATES) {
    if (fs.existsSync(path.join(root, 'docnexus', 'library', t.file))) {
      result.skipped.push(t.file);
      ok(`DocNexus 中已有 ${t.file}，保留不覆盖`);
      continue;
    }
    const content = fs.readFileSync(path.join(tplDir, t.src), 'utf8');
    const draft = docnexus(root, ['draft', 'new', '--slug', `template-${t.skill}`]);
    if (!draft.ok || !draft.json?.artifacts) { result.failed.push({ file: t.file, error: draft.err }); warn(`导入 ${t.file} 失败：${draft.err}`); continue; }
    const a = draft.json.artifacts;
    fs.writeFileSync(path.join(root, a.source), content);
    fs.writeFileSync(path.join(root, a.document), content);
    fs.writeFileSync(path.join(root, a.metadata), JSON.stringify({
      title: t.title,
      summary: t.summary,
      category: TEMPLATE_CATEGORY,
      category_reason: '供 skills-init 文档类 skill 读取的写作模板，与普通知识文档区分；模板随知识库更新。',
      tags: ['skills-init-template', t.skill],
      entities: [],
      relationships: [],
    }, null, 2) + '\n');
    const seal = docnexus(root, ['draft', 'seal', '--id', draft.json.draft_id, '--file', t.file, '--base-version', 'new']);
    const add = seal.ok ? docnexus(root, ['document', 'add', '--draft', draft.json.draft_id]) : seal;
    if (!add.ok) {
      result.failed.push({ file: t.file, error: add.err });
      warn(`导入 ${t.file} 失败：${add.err}`);
      docnexus(root, ['draft', 'discard', '--id', draft.json.draft_id, '--force']);
      continue;
    }
    result.seeded.push(t.file);
    ok(`已导入 DocNexus：docnexus/library/${t.file}`);
  }
  return result;
}
