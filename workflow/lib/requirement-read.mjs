// 需求目录读取与查询；不写索引或运行状态。
import fs from 'node:fs';
import path from 'node:path';
import { layout } from './project.mjs';
import { FILES, parseFile } from './artifact-model.mjs';
import { readMeta } from './meta-store.mjs';

const relative = (root, file) => path.relative(root, file).split(path.sep).join('/');
const directories = (dir) => fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.'));

export function readRequirementDirectories(root, L = layout(root), { allProjects = false, diagnostics = [] } = {}) {
  if ((!allProjects && !L.ok && L.mode === 'repo') || !fs.existsSync(L.base)) return [];
  const out = [];
  for (const req of directories(L.base)) {
    for (const project of directories(path.join(L.base, req.name))) {
      if (!allProjects && project.name !== L.project) continue;
      const abs = path.join(L.base, req.name, project.name);
      const file = path.join(abs, 'meta.json');
      let meta = {}; let valid = true;
      try {
        meta = readMeta(file);
        if ((meta.branches !== undefined && (!Array.isArray(meta.branches) || meta.branches.some((b) => typeof b !== 'string')))
          || (meta.runs !== undefined && (!meta.runs || typeof meta.runs !== 'object' || Array.isArray(meta.runs)))) throw new Error(`无效的需求绑定或运行记录：${file}`);
      } catch (e) {
        diagnostics.push({ code: 'invalid_meta', path: relative(root, file), message: e.message });
        meta = {}; valid = false;
      }
      out.push({ abs, dir: relative(root, abs), slug: req.name, project: project.name, name: meta.name ?? req.name,
        branches: meta.branches ?? [], updated: meta.updated ?? null, meta, valid });
    }
  }
  return out;
}

export function requirements(root, L = layout(root)) {
  return readRequirementDirectories(root, L).map(({ dir, abs, slug, name, branches, updated, meta }) => ({ dir, abs, slug, name, branches, updated, meta }));
}

export function groupRequirements(dirs) {
  const groups = new Map();
  for (const d of dirs) {
    if (!groups.has(d.slug)) groups.set(d.slug, []);
    groups.get(d.slug).push(d);
  }
  return [...groups].map(([slug, rows]) => ({ slug, name: rows.map((d) => d.meta.name).find(Boolean) ?? slug,
    updated: rows.map((d) => d.updated ?? '').sort().at(-1) || null,
    projects: rows.map(({ project, abs, dir, meta }) => ({ project, abs, dir, meta })) }));
}

export function repoRequirements(root, L = layout(root)) {
  return groupRequirements(readRequirementDirectories(root, L, { allProjects: true }));
}

export function artifactFiles(root, { allProjects = false } = {}) {
  const L = layout(root);
  return readRequirementDirectories(root, L, { allProjects }).flatMap((d) => fs.readdirSync(d.abs).flatMap((name) => {
    const p = parseFile(name);
    if (!p) return [];
    const abs = path.join(d.abs, name);
    return [{ abs, rel: relative(root, abs), cite: L.ref(abs), slug: d.slug, project: d.project, ...p,
      ...(name === `${FILES[p.kind]}.md` ? { version: d.meta.versions?.[p.kind] ?? 1 } : {}) }];
  }));
}

export function find(root, branch, L = layout(root)) {
  return requirements(root, L).filter((r) => r.branches.includes(branch))
    .sort((a, b) => String(b.updated).localeCompare(String(a.updated)))[0] ?? null;
}
