// skill 元数据的唯一来源：每个 skill 目录下的 skill.json。
// 安装器（skill 列表、用户文件、改名清理）、--seed-templates（模板清单）和 resolve 脚本都从这里派生，
// 新增 skill 或模板只需改对应的 skill.json。
//
// skill.json 字段：
//   name         必填，与目录名一致
//   order        安装与展示顺序
//   userFiles    用户配置：{ "<安装后相对路径>": "<对应空模板的源路径>" | null }，重跑不覆盖；空模板用于判断是否还没填写
//   templates    可由 DocNexus 接管的文档模板：[{ id, src, title, summary }]，知识库路径为 templates/<skill>/<id>
//   renamedFrom  旧名 -> SKILL.md 签名正则（多行模式），升级时只清理能确认是本项目装的旧目录

import fs from 'node:fs';
import path from 'node:path';

export const SKILL_META = 'skill.json';
export const TEMPLATE_CATEGORY = 'doc-template';

export function loadSkills(tplDir) {
  const skills = [];
  for (const d of fs.readdirSync(tplDir, { withFileTypes: true })) {
    const f = path.join(tplDir, d.name, SKILL_META);
    if (!d.isDirectory() || !fs.existsSync(f)) continue;
    const m = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (m.name !== d.name) throw new Error(`${d.name}/${SKILL_META} 的 name（${m.name}）与目录名不一致`);
    skills.push({ order: 999, userFiles: {}, templates: [], renamedFrom: {}, ...m });
  }
  return skills.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

// 派生出安装器与 seed 使用的结构
export function deriveMeta(skills) {
  const userFiles = {};
  const renamed = {};
  const templates = [];
  for (const s of skills) {
    for (const [rel, blank] of Object.entries(s.userFiles)) userFiles[`${s.name}/${rel}`] = blank ? `${s.name}/${blank}` : null;
    for (const [old, sig] of Object.entries(s.renamedFrom)) renamed[old] = { to: s.name, signature: new RegExp(sig, 'm') };
    for (const t of s.templates) {
      templates.push({ skill: s.name, id: t.id, src: `${s.name}/${t.src}`, file: `templates/${s.name}/${t.id}`, title: t.title, summary: t.summary });
    }
  }
  return { skills: skills.map((s) => s.name), userFiles, renamed, templates };
}
