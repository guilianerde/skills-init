// 运行状态服务：阶段、完成校验和 revision；不依赖命令入口。
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { find, requirements } from './requirement-read.mjs';
import { parseBranch } from './artifact-model.mjs';
import { updateMeta } from './meta-store.mjs';
import { loadWorkspace } from './workspace-read.mjs';

export const FLOWS = {
  feature: ['Step0', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8'],
  bug: ['Step0', 'B1', 'B2', 'B3', 'B4', 'B5'],
  review: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'],
  tech: ['T0', 'T1', 'T2', 'T3', 'T4'],
  release: ['L0', 'L1', 'L2', 'L3', 'L4'],
  wiki: ['W0', 'W1', 'W2'],
};
export const STATUS_LABELS = { running: '进行中', waiting_user: '等待用户', blocked: '受阻', completed: '已完成', cancelled: '已取消' };
const terminal = (s) => s === 'completed' || s === 'cancelled';
const done = (s) => s === 'completed' || s === 'skipped';
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const timestamp = () => new Date().toISOString();

export function allRuns(root, workspace = loadWorkspace(root)) {
  return workspace.runs.filter((run) => run.project === workspace.layout.project).map(({ project, ...run }) => run);
}

export const branchRuns = (root, branch, workspace) => allRuns(root, workspace).filter((run) => run.branch === branch);

export function runState(root, branch, workspace = loadWorkspace(root)) {
  const runs = branchRuns(root, branch, workspace);
  const current = runs.filter((r) => !terminal(r.status)).at(-1) ?? runs.at(-1) ?? null;
  const next = !current ? null : current.status === 'waiting_user' ? `等待用户：${current.waiting_for}`
    : current.status === 'blocked' ? `处理阻塞：${current.reason}`
      : terminal(current.status) ? `${STATUS_LABELS[current.status]}：${current.kind}（${current.id}）`
        : `继续 ${current.stage}（${current.kind}，运行 ${current.id}）`;
  return { branch, current, runs, next, ...(workspace.diagnostics.length ? { diagnostics: workspace.diagnostics } : {}) };
}

function applyCheckpoint(run, patch, at, reopen = true) {
  if (!object(patch)) throw new Error('checkpoint 必须是 JSON 对象');
  const allowed = ['stage', 'status', 'size', 'waiting_for', 'reason', 'steps', 'context', 'decision'];
  for (const key of Object.keys(patch)) if (!allowed.includes(key)) throw new Error(`不支持修改字段：${key}`);
  if (patch.status !== undefined && !['running', 'waiting_user', 'blocked'].includes(patch.status)) throw new Error('save 的状态只支持 running / waiting_user / blocked；完成用 complete，取消用 cancel');
  if (patch.size !== undefined) {
    if (!['S', 'M', 'L'].includes(patch.size)) throw new Error('size 必须是 S / M / L');
    run.size = patch.size;
  }
  const stages = FLOWS[run.kind];
  const stage = patch.stage ?? run.stage;
  if (!stages.includes(stage)) throw new Error(`无效阶段：${stage}`);
  const status = patch.status ?? run.status;
  // 回到已完成的阶段时，后续完成标记失效；历史 checkpoint 仍保留。
  if (reopen && patch.stage && (stages.indexOf(stage) < stages.indexOf(run.stage) || (status === 'running' && done(run.steps[stage].status)))) {
    for (const name of stages.slice(stages.indexOf(stage))) run.steps[name] = { status: 'pending' };
    run.decision = null;
  }
  if (patch.steps !== undefined) {
    if (!object(patch.steps)) throw new Error('steps 必须是对象');
    for (const [name, value] of Object.entries(patch.steps)) {
      if (!stages.includes(name) || !object(value)) throw new Error(`无效步骤：${name}`);
      if (!['pending', 'in_progress', 'completed', 'skipped'].includes(value.status)) throw new Error(`无效步骤状态：${name}`);
      if (value.status === 'skipped' && !value.reason?.trim()) throw new Error(`跳过 ${name} 必须注明 reason`);
      run.steps[name] = { ...value, updated_at: at, completed_at: value.status === 'completed' ? (run.steps[name].completed_at ?? at) : null };
    }
  }
  if (patch.context !== undefined) {
    if (!object(patch.context)) throw new Error('context 必须是对象');
    run.context = { ...run.context, ...patch.context };
  }
  if (patch.decision !== undefined) {
    if (!object(patch.decision) || !['fix', 'deliver'].includes(patch.decision.action) || patch.decision.confirmed !== true) throw new Error('decision 必须记录用户明确确认的 fix / deliver');
    run.decision = { ...patch.decision, at };
  }
  run.stage = stage;
  run.status = status;
  run.waiting_for = status === 'waiting_user' ? (patch.waiting_for ?? run.waiting_for) : null;
  run.reason = status === 'blocked' ? (patch.reason ?? run.reason) : null;
  if (status === 'waiting_user' && !run.waiting_for?.trim()) throw new Error('等待用户时必须填写 waiting_for');
  if (status === 'blocked' && !run.reason?.trim()) throw new Error('阻塞时必须填写 reason');
  if (status === 'running' && run.steps[stage].status === 'pending') run.steps[stage] = { status: 'in_progress', updated_at: at };
  run.updated_at = at;
  run.history.push({ at, stage, status, steps: patch.steps ?? {}, ...(patch.decision ? { decision: run.decision } : {}) });
  return run;
}

export function startRun(root, { branch, kind = 'feature', size = null, input = {}, dir = null }) {
  if (!branch || !FLOWS[kind]) throw new Error('start 需要有效分支及 kind：feature / bug / review / tech / release / wiki');
  if (['feature', 'bug'].includes(kind) && !['S', 'M', 'L'].includes(size)) throw new Error('完整 dev 流程需要 size：S / M / L；快速通道不创建运行记录');
  const req = dir ? requirements(root).find((r) => r.abs === path.resolve(root, dir)) : find(root, branch);
  if (!req || !req.branches.includes(branch)) throw new Error('当前分支尚未绑定指定需求，先确认需求名并运行 requirement.mjs bind；快速通道不要调用 start');
  let selected; let resumed = false;
  updateMeta(path.join(req.abs, 'meta.json'), (meta) => {
    const runs = meta.runs ?? {};
    selected = Object.values(runs).find((r) => r.branch === branch && r.kind === kind && !terminal(r.status));
    if (selected) { resumed = true; return meta; }
    const at = timestamp(); const id = randomUUID();
    selected = applyCheckpoint({ id, kind, size, branch, revision: 1, status: 'running', stage: FLOWS[kind][0],
      created_at: at, updated_at: at, completed_at: null, steps: Object.fromEntries(FLOWS[kind].map((s) => [s, { status: 'pending' }])),
      context: {}, waiting_for: null, reason: null, decision: null, history: [] }, input, at);
    return { ...meta, runs: { ...runs, [id]: selected }, updated: at };
  }, { root });
  return { ok: true, resumed, dir: req.dir, run: selected };
}

export function changeRun(root, { branch, id, revision, input = {}, action = 'save' }) {
  if (!branch || !id || !['save', 'complete', 'cancel'].includes(action)) throw new Error('需要当前分支、运行 id 和有效动作');
  const req = requirements(root).find((r) => Object.hasOwn(r.meta.runs ?? {}, id));
  if (!req) throw new Error(`找不到运行：${id}`);
  let result;
  updateMeta(path.join(req.abs, 'meta.json'), (meta) => {
    const run = structuredClone(meta.runs[id]);
    if (run.branch !== branch) throw new Error('运行属于其他分支，请切换到对应分支后恢复，不要修改原运行的分支');
    if (!Number.isInteger(revision) || run.revision !== revision) throw new Error(`运行版本冲突，重新读取状态后使用 --expect-revision ${run.revision}`);
    if (terminal(run.status)) throw new Error('运行已结束，不再修改；新的工作请 start 新运行');
    const at = timestamp();
    if (action === 'cancel') {
      if (!input.reason?.trim()) throw new Error('取消运行需要 reason');
      run.status = 'cancelled'; run.reason = input.reason; run.waiting_for = null; run.ended_at = at;
      run.history.push({ at, stage: run.stage, status: 'cancelled', reason: input.reason });
    } else {
      applyCheckpoint(run, input, at, action !== 'complete');
      if (action === 'complete') {
        const steps = FLOWS[run.kind];
        if (run.status !== 'running' || run.stage !== steps.at(-1) || !steps.every((s) => done(run.steps[s].status)) || run.steps[steps.at(-1)].status !== 'completed') throw new Error('还有未完成步骤、待用户决定或阻塞，不能标记已完成');
        if (['feature', 'bug'].includes(run.kind)) {
          const required = run.kind === 'feature' ? ['F4', 'F5', 'F6', 'F7', 'F8'] : ['B4', 'B5'];
          if (required.some((s) => run.steps[s].status !== 'completed') || run.decision?.action !== 'deliver' || !run.decision.confirmed) throw new Error('完整 dev 流程必须完成方案、实现、验证、审查和交付，且用户已选择交付');
        }
        const files = { feature: ['plan.md', 'review.md', 'delivery.md'], bug: ['plan.md', 'review.md', 'delivery.md'], review: ['review.md'], tech: ['tech-doc.md'], release: ['release-doc.md'] };
        for (const name of files[run.kind] ?? []) {
          const file = path.join(req.abs, name);
          if (!fs.existsSync(file) || parseBranch(fs.readFileSync(file, 'utf8')) !== branch) throw new Error(`缺少当前分支的产物：${name}`);
        }
        run.status = 'completed'; run.completed_at = at; run.waiting_for = null; run.reason = null;
        run.history.push({ at, stage: run.stage, status: 'completed' });
      }
    }
    run.updated_at = at; run.revision++;
    result = run;
    return { ...meta, runs: { ...meta.runs, [id]: run }, updated: at };
  }, { root });
  return { ok: true, dir: req.dir, run: result };
}
