#!/usr/bin/env node
// 只交接事实与证据，不交接实现者自审结论；生成过程不推进运行。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readRun } from '../lib/runs.mjs';
import { readProfile } from '../lib/project.mjs';
import { snapshotReader, assertSnapshot, assertWorkingBranch, hash } from '../lib/code-snapshot.mjs';
import { isDev, assertValidation, reviewInputs, documentReviewBasis } from '../lib/run-gates.mjs';
import { documentReviewStage, documentReviewInputs, requiresDocumentReview } from '../lib/document-review.mjs';
import { artifactDraft } from '../lib/artifact-finalize.mjs';
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

export function documentHandoff(root, { branch, id, kind, text }) {
  const { req, run } = readRun(root, branch, id);
  if (!requiresDocumentReview(run, kind) || ['completed', 'cancelled'].includes(run.status)) throw new Error('只有需要文档审查的进行中运行可生成此交接');
  if (run.stage !== documentReviewStage(run, kind)) throw new Error(`请在 ${documentReviewStage(run, kind)} 阶段生成文档审查交接`);
  if (req.meta.pending_finalization) throw new Error('先恢复待完成的产物收尾');
  assertWorkingBranch(root, run);
  const basis = documentReviewBasis(root, req, run, kind);
  const basisText = basis ? fs.readFileSync(path.resolve(root, basis.path), 'utf8') : null;
  if (basis && hash(basisText) !== basis.hash) throw new Error('文档审查依据在交接期间变化，请重新收尾后再试');
  const draft = artifactDraft(req, kind, text);
  const draftHash = hash(draft.text);
  const inputs = documentReviewInputs(run, kind, draftHash, basis);
  return {
    run_id: id, revision: run.revision, project_root: path.resolve(root), branch, kind, inputs,
    draft: { text: draft.text, hash: draftHash },
    basis: basis ? { path: basis.path, hash: basis.hash, version: basis.version, text: basisText } : null,
    result_schema: { run_id: id, inputs, mode: 'independent', reviewer: '实际子 agent 标识', summary: '审查结论与已复核修订',
      findings: [{ location: '章节或验收编号', evidence: '依据及来源', impact: '实际影响', blocking: false }] },
  };
}

export function main(argv) {
  try {
    const args = [...argv]; const opts = {};
    while (args.length) {
      const key = args.shift();
      if (!['--root', '--branch', '--id', '--depth', '--capabilities', '--kind', '--draft'].includes(key) || !args.length) throw new Error(`未知或缺少值的参数：${key}`);
      opts[key.slice(2)] = args.shift();
    }
    const root = path.resolve(opts.root ?? '.');
    const branch = opts.branch ?? spawnSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout?.trim();
    let packet;
    let fileName = 'handoff.json';
    if (opts.kind || opts.draft) {
      if (!['requirement', 'plan'].includes(opts.kind) || !opts.draft || opts.depth || opts.capabilities) throw new Error('文档审查使用 --kind requirement|plan --draft <草稿.md>');
      packet = documentHandoff(root, { branch, id: opts.id, kind: opts.kind, text: fs.readFileSync(path.resolve(root, opts.draft), 'utf8') });
      fileName = `${packet.kind}-${packet.inputs}.json`;
    } else {
      const capabilities = opts.capabilities ? JSON.parse(fs.readFileSync(path.resolve(root, opts.capabilities), 'utf8')) : null;
      packet = handoff(root, { branch, id: opts.id, depth: opts.depth, capabilities });
    }
    const file = path.join(root, 'workflow-run/tmp/review', packet.run_id, fileName);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(packet, null, 2)}\n`);
    console.log(JSON.stringify({ ok: true, path: path.relative(root, file).split(path.sep).join('/'), packet }, null, 2)); return 0;
  } catch (e) { console.error(e.message); return 1; }
}
const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exit(main(process.argv.slice(2)));
