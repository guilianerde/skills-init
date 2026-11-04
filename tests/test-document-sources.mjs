import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bind } from '../workflow/lib/requirements.mjs';
import { startRun } from '../workflow/lib/runs.mjs';
import { BRANCH, flowFixture } from './helpers/run-flow.mjs';

const script = fileURLToPath(new URL('../workflow/scripts/document-sources.mjs', import.meta.url));
function query(root, run, branch = BRANCH) {
  const result = spawnSync(process.execPath, [script, '--id', run.id, '--branch', branch], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('技术和上线方案引用同一已完成 dev 的版本，后续运行更新时读取归档', (t) => {
  const f = flowFixture(t);
  let dev = f.save(f.ready(), { stage: 'F8', decision: { action: 'deliver', confirmed: true } });
  dev = f.finalize(dev, 'delivery');
  dev = f.save(dev, { steps: { F8: { status: 'completed' } } }, 'complete');
  const tech = f.start(BRANCH, 'tech');
  const release = f.start(BRANCH, 'release');
  const initial = query(f.root, tech);
  assert.equal(initial.dev.id, dev.id);
  assert.equal(initial.dev.snapshot.digest, dev.validation.snapshot.digest);
  assert.deepEqual(Object.keys(initial.artifacts), ['requirement', 'delivery', 'plan', 'review']);
  assert.deepEqual(initial.missing, []);

  const next = f.finalize(f.start(), 'requirement', {}, { text: `${f.text('requirement.md')}新一轮需求\n` });
  const after = query(f.root, release);
  assert.equal(after.dev.id, dev.id);
  assert.equal(after.artifacts.requirement.path, next.artifacts.requirement.previous);
  assert.equal(after.artifacts.requirement.version, dev.artifacts.requirement.version);
  assert.equal(after.artifacts.delivery.path, initial.artifacts.delivery.path);

  fs.rmSync(path.join(f.root, after.artifacts.requirement.path));
  fs.appendFileSync(path.join(f.root, after.artifacts.delivery.path), '> DocNexus：无需沉淀\n');
  const missing = query(f.root, tech);
  assert.deepEqual(missing.missing, ['requirement']);
  assert.equal(missing.artifacts.requirement, undefined);
  assert.equal(missing.artifacts.delivery.content_changed, true);
});

test('缺少已完成 dev 时回退到同需求、同分支的现有文档', (t) => {
  const f = flowFixture(t);
  for (const name of ['requirement.md', 'delivery.md', 'tech-doc.md', 'plan.md']) f.put(name);
  const tech = f.start(BRANCH, 'tech');
  assert.deepEqual(Object.keys(query(f.root, tech).artifacts), ['requirement']);
  const release = f.start(BRANCH, 'release');
  const legacy = query(f.root, release);
  assert.equal(legacy.dev, null);
  assert.deepEqual(Object.keys(legacy.artifacts), ['requirement', 'delivery']);
  assert.equal(legacy.tech.path, `${f.req.dir}/tech-doc.md`);

  const other = bind(f.root, { name: '另一需求', branch: BRANCH, base: 'main' });
  const otherRelease = startRun(f.root, { branch: BRANCH, kind: 'release', dir: other.dir }).run;
  assert.deepEqual(query(f.root, otherRelease), { dev: null, artifacts: {}, missing: [], tech: null });
});
