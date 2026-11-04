#!/usr/bin/env node
// 为技术方案和上线方案只读查询同需求、同分支的 dev 产物。
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { FILES, parseBranch } from '../lib/artifact-model.mjs';
import { hash } from '../lib/code-snapshot.mjs';
import { archivePath } from '../lib/requirements.mjs';
import { isDev } from '../lib/run-gates.mjs';
import { loadWorkspace } from '../lib/workspace-read.mjs';

function readArchive(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

function sources(root, branch, id) {
  const workspace = loadWorkspace(root);
  const doc = workspace.runs.find((run) => run.id === id && run.branch === branch);
  if (!doc || !['tech', 'release'].includes(doc.kind)) throw new Error('请指定目标分支上的技术方案或上线方案运行 id');
  const req = workspace.requirements.find((item) => item.dir === doc.dir);
  const items = workspace.artifacts.filter((a) => path.posix.dirname(a.path) === req.dir && a.branch === branch);
  const latest = (kind) => req.meta.pending_finalization?.kind === kind ? null : items.findLast((a) => a.kind === kind);
  const reference = ({ path, cite, version }) => ({ path, cite, version });
  const dev = workspace.runs.filter((run) => run.dir === req.dir && run.branch === branch && isDev(run)
    && run.status === 'completed' && run.completed_at).sort((a, b) => a.completed_at.localeCompare(b.completed_at)).at(-1);
  const artifacts = {};
  const missing = [];
  const kinds = dev ? ['requirement', 'delivery', 'plan', 'review', 'clarification'] : doc.kind === 'release' ? ['requirement', 'delivery'] : ['requirement'];
  for (const kind of kinds) {
    if (!dev) {
      const item = latest(kind);
      if (item) artifacts[kind] = reference(item);
      continue;
    }
    const record = dev.artifacts?.[kind];
    const current = items.find((a) => a.path === `${req.dir}/${FILES[kind]}.md` && a.version === record?.version);
    const pending = req.meta.pending_finalization?.kind === kind;
    if (current && !pending && hash(current.text) === record.hash) {
      artifacts[kind] = reference(current);
      continue;
    }
    if (Number.isSafeInteger(record?.version) && record.version > 0) {
      const archive = archivePath(root, req.abs, kind, record.version);
      const text = readArchive(archive);
      if (text && hash(text) === record.hash && parseBranch(text) === branch) {
        artifacts[kind] = { path: path.relative(root, archive).split(path.sep).join('/'), cite: workspace.layout.ref(path.join(req.abs, `${FILES[kind]}.md`)), version: record.version };
        continue;
      }
    }
    // 发布 Wiki 或更新 DocNexus 状态会改变文件哈希，仍可按登记版本读取为待核对的背景。
    if (current && !pending) artifacts[kind] = { ...reference(current), content_changed: true };
    else if (kind !== 'clarification' || record) missing.push(kind);
  }
  const tech = doc.kind === 'release' ? latest('tech') : null;
  return { dev: dev ? { id: dev.id, completed_at: dev.completed_at, snapshot: dev.validation?.snapshot ?? null } : null,
    artifacts, missing, ...(doc.kind === 'release' ? { tech: tech ? reference(tech) : null } : {}) };
}

try {
  const { values } = parseArgs({ options: { root: { type: 'string', default: '.' }, branch: { type: 'string' }, id: { type: 'string' } } });
  if (!values.branch || !values.id) throw new Error('用法：document-sources.mjs --branch <开发分支> --id <文档运行id>');
  console.log(JSON.stringify(sources(path.resolve(values.root), values.branch, values.id), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
