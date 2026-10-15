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
//   requires     运行时必需的其他 skill（会读它的脚本或文件），--skills 安装时自动带上
//   optional     协作但非必需的 skill：没装时本 skill 跳过对应增强（如 PRD 读取、自审），不报错
//   shared       共享参考文件名列表：源在仓库 shared/ 下，安装时拷进本 skill 的 references/（仓库里只维护一份，装好后各 skill 自带）
//   docnexus     本 skill 写入 DocNexus 时的显式分类：{ category, reason }，由 resolve.mjs category 读取（项目画像可覆盖），
//                入库时以调用方显式分类封存（draft seal --category），不走 DocNexus 的模型分类

import fs from 'node:fs';
import path from 'node:path';

export const SKILL_META = 'skill.json';
export const TEMPLATE_CATEGORY = 'doc-template';
export const TEMPLATE_CATEGORY_REASON = 'skills-init 文档类 skill 读取的写作模板，与普通知识文档区分；模板随知识库更新。';

// DocNexus 对显式分类名的约束：1–80 字符，无首尾空白与控制字符
export const validCategory = (c) => typeof c === 'string' && c.length >= 1 && c.length <= 80 && c === c.trim() && !/[\u0000-\u001f\u007f]/.test(c);

export function loadSkills(tplDir) {
  const skills = [];
  for (const d of fs.readdirSync(tplDir, { withFileTypes: true })) {
    const f = path.join(tplDir, d.name, SKILL_META);
    if (!d.isDirectory() || !fs.existsSync(f)) continue;
    const m = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (m.name !== d.name) throw new Error(`${d.name}/${SKILL_META} 的 name（${m.name}）与目录名不一致`);
    skills.push({ order: 999, requires: [], optional: [], shared: [], userFiles: {}, templates: [], renamedFrom: {}, docnexus: null, ...m });
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

// 选中的 skill 加上 requires 的传递闭包，按 order 排序；未知名称抛错
export function withDependencies(skills, names) {
  const byName = new Map(skills.map((s) => [s.name, s]));
  const unknown = names.filter((n) => !byName.has(n));
  if (unknown.length) throw new Error(`未知的 skill：${unknown.join('、')}（可选：${[...byName.keys()].join('、')}）`);
  const out = new Set();
  const visit = (n) => { if (out.has(n)) return; out.add(n); for (const d of byName.get(n).requires) visit(d); };
  names.forEach(visit);
  return skills.filter((s) => out.has(s.name)).map((s) => s.name);
}
