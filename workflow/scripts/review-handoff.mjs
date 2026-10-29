#!/usr/bin/env node
// 只交接事实与证据，不交接实现者自审结论；生成过程不推进运行。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readRun } from '../lib/runs.mjs';
import { readProfile } from '../lib/project.mjs';
import { snapshotReader, assertSnapshot, hash } from '../lib/code-snapshot.mjs';
import { isDev, assertValidation, reviewInputs } from '../lib/run-gates.mjs';
import { scope } from './review-scope.mjs';

export function handoff(root, { branch, id, depth = '标准', capabilities = null }) {
  const { req, run } = readRun(root, branch, id);
  if (!['feature', 'bug', 'review'].includes(run.kind) || ['completed', 'cancelled'].includes(run.status)) throw new Error('只有进行中的开发／审查运行可生成交接材料');
  if (req.meta.pending_finalization) throw new Error('先恢复待完成的产物收尾');
  const getSnapshot = snapshotReader(root, run);
  if (isDev(run)) {
    if (run.stage !== (run.kind === 'feature' ? 'F7' : 'B5')) throw new Error('请先完成验证并进入审查阶段');
    assertValidation(root, req, run, undefined, getSnapshot);
  }
  if (!['快审', '标准', '深审'].includes(depth)) throw new Error('审查深度须为快审 / 标准 / 深审');
  const snapshot = getSnapshot();
  const reviewScope = scope(root, { base: run.scope?.base ?? 'main', exclude: run.scope?.exclude ?? [] });
  if (!reviewScope.ok) throw new Error(reviewScope.error);
  assertSnapshot(root, run, snapshot);
  const profile = readProfile(root).profile;
  const inputs = reviewInputs(run);
  return {
    run_id: id, revision: run.revision, project_root: path.resolve(root), skills: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
    branch, depth, snapshot, inputs: hash(JSON.stringify(inputs)), scope: reviewScope, requirement: req.name, facts: inputs.facts,
    requirement_document: run.artifacts?.requirement ?? null, plan: run.artifacts?.plan ?? null, previous_report: run.artifacts?.review ?? null,
    validation: run.validation ?? null,
    commands: Object.fromEntries(['main_branch', 'build', 'test', 'test_single', 'lint'].map((k) => [k, profile?.[k] ?? null])),
    capabilities,
    result_schema: { run_id: id, code: snapshot.digest, inputs: hash(JSON.stringify(inputs)), findings: [{ id: '唯一编号', severity: 'CRITICAL|HIGH|MEDIUM|LOW', verification: 'confirmed|pending', scope: 'in_scope|outside（范围外发现单列）', file: '真实路径', line: 1, summary: '触发条件与影响' }], coverage: { reviewed: ['已审文件'], uncovered: ['未审文件'] } },
    rules: '独立读代码，按 project-review 第 1～7 步审查；返回报告草稿和结构化结果，不改代码、不生成 delivery.md、不提交、不另建运行；主 agent 负责 finalize。零发现 findings 为空数组，scope.review 中每个文件必须进入 reviewed 或 uncovered。',
  };
}

export function main(argv) {
  try {
    const args = [...argv]; const opts = {};
    while (args.length) {
      const key = args.shift();
      if (!['--root', '--branch', '--id', '--depth', '--capabilities'].includes(key) || !args.length) throw new Error(`未知或缺少值的参数：${key}`);
      opts[key.slice(2)] = args.shift();
    }
    const root = path.resolve(opts.root ?? '.');
    const branch = opts.branch ?? spawnSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout?.trim();
    const capabilities = opts.capabilities ? JSON.parse(fs.readFileSync(path.resolve(root, opts.capabilities), 'utf8')) : null;
    const packet = handoff(root, { branch, id: opts.id, depth: opts.depth, capabilities });
    const file = path.join(root, 'workflow-run/tmp/review', packet.run_id, 'handoff.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(packet, null, 2)}\n`);
    console.log(JSON.stringify({ ok: true, path: path.relative(root, file).split(path.sep).join('/'), packet }, null, 2)); return 0;
  } catch (e) { console.error(e.message); return 1; }
}
const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exit(main(process.argv.slice(2)));
