// 文件发布与 meta 更新之间用同一 meta.json 中的待办恢复；不声称多个文件可一次原子提交。
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FILES, parseBranch } from './artifact-model.mjs';
import { hash, assertWorkingBranch, snapshotReader } from './code-snapshot.mjs';
import { layout } from './project.mjs';
import { readRun, assertRunVersion, applyCheckpoint } from './runs.mjs';
import { isDev, coreSteps, applyDevEvidence, assertRequirement, assertPlanBasis, assertReview, assertDelivery, reviewEvidence } from './run-gates.mjs';
import { updateMeta } from './meta-store.mjs';
import { OLD_DIR, indexArtifacts } from './requirements.mjs';

export const ARTIFACT_TEMPLATES = {
  requirement: ['dev', 'requirement-template.md'],
  plan: ['dev', 'plan-template.md'], review: ['project-review', 'report.md'], delivery: ['dev', 'delivery-template.md'],
  tech: ['create-tech-md-doc', 'template.md'], release: ['create-release-md-doc', 'template.md'],
};
const allowed = { feature: ['requirement', 'plan', 'review', 'delivery'], bug: ['requirement', 'plan', 'review', 'delivery'], review: ['review'], tech: ['tech'], release: ['release'] };
const relative = (root, file) => path.relative(root, file).split(path.sep).join('/');
const fileHash = (file) => fs.existsSync(file) ? hash(fs.readFileSync(file)) : null;

export function resumeFinalization(root, { branch, id }) {
  const { req } = readRun(root, branch, id);
  let result;
  updateMeta(path.join(req.abs, 'meta.json'), (meta) => {
    const p = meta.pending_finalization;
    if (!p || p.run_id !== id) throw new Error('没有该运行待恢复的产物收尾');
    const run = meta.runs[id];
    assertRunVersion(run, branch, p.revision);
    if (isDev(run)) assertWorkingBranch(root, run);
    const staged = path.resolve(root, p.staged);
    if (fileHash(staged) !== p.hash) throw new Error('收尾草稿缺失或已变化，保留待办；请恢复原草稿后重试');
    const file = path.join(req.abs, `${FILES[p.kind]}.md`);
    const current = fileHash(file);
    if (current !== p.before && current !== p.hash) throw new Error('正式产物在收尾中断后被其他操作修改，请先核对并恢复；不会覆盖');
    // 中断期间代码／报告也可能变化：发布前重新检查本轮门禁。
    const getSnapshot = snapshotReader(root, p.run);
    applyDevEvidence(root, req, p.run, p.checkpoint, p.run.updated_at, { [p.kind]: fs.readFileSync(staged, 'utf8') }, getSnapshot);
    if (p.kind === 'plan') assertPlanBasis(root, req, p.run, { plan: fs.readFileSync(staged, 'utf8') });
    if (p.kind === 'review' || (isDev(p.run) && p.kind === 'delivery')) {
      if (p.kind === 'review') assertReview(root, req, p.run, { review: fs.readFileSync(staged, 'utf8') }, getSnapshot);
      else assertDelivery(root, req, p.run, undefined, getSnapshot);
    }
    if (current !== p.hash) {
      if (p.previous) {
        const archive = path.resolve(root, p.previous);
        fs.mkdirSync(path.dirname(archive), { recursive: true });
        if (fs.existsSync(archive) && fileHash(archive) !== p.before) throw new Error('归档版本已存在且内容不同，停止以免覆盖历史');
        fs.copyFileSync(file, archive);
      }
      const tmp = path.join(req.abs, `.${FILES[p.kind]}.${p.id}.tmp`);
      fs.writeFileSync(tmp, fs.readFileSync(staged));
      fs.renameSync(tmp, file);
    }
    const versions = { ...(meta.versions ?? {}), [p.kind]: p.version };
    const artifacts = indexArtifacts(req.abs, versions);
    const latest = Object.fromEntries(Object.keys(FILES).map((k) => [k, artifacts.filter((a) => a.kind === k).at(-1)?.file ?? null]));
    const { pending_finalization, ...rest } = meta;
    result = { ok: true, path: relative(root, file), cite: layout(root).ref(file), previous: p.previous, version: p.version, lint: p.run.artifacts[p.kind].lint, run: p.run };
    return { ...rest, versions, artifacts, latest, runs: { ...meta.runs, [id]: p.run }, updated: p.run.updated_at };
  }, { root, allowFinalization: true });
  return result;
}

export function abortFinalization(root, { branch, id }) {
  const { req } = readRun(root, branch, id);
  updateMeta(path.join(req.abs, 'meta.json'), (meta) => {
    const p = meta.pending_finalization;
    if (!p || p.run_id !== id) throw new Error('没有该运行待取消的产物收尾');
    assertRunVersion(meta.runs[id], branch, p.revision);
    const file = path.join(req.abs, `${FILES[p.kind]}.md`);
    const current = fileHash(file);
    if (current !== p.before && current !== p.hash) throw new Error('正式文件已被其他操作修改，先人工核对，不会覆盖');
    if (current === p.hash && p.before !== p.hash) {
      if (p.before === null) fs.unlinkSync(file);
      else {
        const archive = path.resolve(root, p.previous);
        if (fileHash(archive) !== p.before) throw new Error('原版本归档缺失，不能安全取消');
        const tmp = path.join(req.abs, `.${FILES[p.kind]}.${p.id}.tmp`);
        fs.copyFileSync(archive, tmp); fs.renameSync(tmp, file);
      }
    }
    const { pending_finalization, ...rest } = meta;
    return rest;
  }, { root, allowFinalization: true });
  return { ok: true, aborted: true, run_id: id };
}

export function finalizeArtifact(root, { branch, id, revision, kind, text, input = {}, packet = null, result = null }, check) {
  if (!FILES[kind] || typeof text !== 'string') throw new Error('需要有效的产物 kind 和草稿正文');
  const { req } = readRun(root, branch, id);
  const file = path.join(req.abs, `${FILES[kind]}.md`);
  const wikiRecord = (s) => /^<!-- md-to-wiki: [^\n]*-->/.exec(s)?.[0] ?? null;
  const existingWiki = fs.existsSync(file) ? wikiRecord(fs.readFileSync(file, 'utf8')) : null;
  const draftWiki = wikiRecord(text);
  if (existingWiki && draftWiki && existingWiki !== draftWiki) throw new Error('新版必须保留原 wiki 页面记录；页面变更由 wiki 发布流程处理');
  if (existingWiki && !draftWiki) text = `${existingWiki}\n${text}`;
  const digest = hash(text);
  const key = hash(JSON.stringify({ id, revision, kind, digest, input, packet, result }));
  let repeated = null;
  updateMeta(path.join(req.abs, 'meta.json'), (meta) => {
    const current = meta.runs[id];
    if (current.last_finalization === key && !meta.pending_finalization) {
      if (fileHash(path.join(req.abs, `${FILES[kind]}.md`)) !== digest) throw new Error('已收尾产物后来被修改，请用当前 revision 发起新的收尾');
      repeated = { ok: true, already_finalized: true, path: `${req.dir}/${FILES[kind]}.md`, run: current }; return meta;
    }
    if (meta.pending_finalization) {
      if (meta.pending_finalization.key !== key) throw new Error(`已有待完成收尾，先运行 artifact.mjs resume --id ${meta.pending_finalization.run_id}`);
      return meta;
    }
    assertRunVersion(current, branch, revision);
    if (isDev(current)) assertWorkingBranch(root, current);
    if (!allowed[current.kind]?.includes(kind)) throw new Error('该产物种类不属于当前运行');
    if (parseBranch(text) !== branch) throw new Error('草稿元信息的分支必须与运行分支一致');
    const lint = check(text);
    if (!lint?.ok) throw new Error(`草稿自检失败：${lint?.errors?.join('；') || '模板不可用'}`);
    const at = new Date().toISOString();
    const run = structuredClone(current);
    const getSnapshot = snapshotReader(root, run);
    // 文档收尾只能登记当前步骤，不能在一次落盘中跳到下游或替用户作确认。
    if (Object.keys(input).some((k) => !['steps', 'status', 'waiting_for', 'reason', 'context'].includes(k))) throw new Error('收尾 checkpoint 只接受 steps / status / waiting_for / reason / context；阶段和用户选择用 run.mjs save');
    const expectedStep = isDev(run) ? (kind === 'requirement' ? (run.kind === 'feature' ? 'F3' : 'B3') : kind === 'plan' ? (run.kind === 'feature' ? 'F4' : 'B4') : kind === 'review' ? (run.kind === 'feature' ? 'F7' : 'B5') : (run.kind === 'feature' ? 'F8' : 'B5')) : ({ review: 'R7', tech: 'T4', release: 'L4' })[run.kind];
    if (run.stage !== expectedStep || Object.keys(input.steps ?? {}).some((s) => s !== expectedStep)) throw new Error(`产物应在 ${expectedStep} 收尾，只能更新该步骤`);
    let requirement = null;
    if (kind === 'plan') {
      requirement = assertRequirement(root, req, run);
      if (run.steps[run.kind === 'feature' ? 'F3' : 'B3'].status !== 'completed') throw new Error('需求文档尚未完成，不能收尾方案');
    }
    if (isDev(run) && kind === 'delivery') assertDelivery(root, req, run, undefined, getSnapshot);
    if ((fs.existsSync(file) ? wikiRecord(fs.readFileSync(file, 'utf8')) : null) !== existingWiki) throw new Error('wiki 发布记录在收尾期间变化，请重新读取后重试');
    const before = fileHash(file);
    const oldVersion = meta.versions?.[kind] ?? 1;
    const version = before === null ? 1 : oldVersion + (before === digest ? 0 : 1);
    const previous = before !== null && before !== digest ? relative(root, path.join(root, OLD_DIR, path.relative(path.join(root, 'workflow-run/docs/requirements'), req.abs), `${FILES[kind]}_v${oldVersion}.md`)) : null;
    run.artifacts = { ...(run.artifacts ?? {}), [kind]: { hash: digest, version, path: relative(root, file), previous, lint, at,
      ...(requirement ? { requirement: { hash: requirement.hash, version: requirement.version } } : {}) } };
    if ((kind === 'plan' && (current.artifacts?.plan?.hash !== digest || current.artifacts?.plan?.requirement?.hash !== requirement.hash))
      || (kind === 'requirement' && current.artifacts?.requirement?.hash !== digest)) {
      run.plan_approval = null; run.implementation = null; run.validation = null; run.review = null; run.decision = null;
      if (kind === 'requirement') for (const step of coreSteps(run).slice(1)) run.steps[step] = { status: 'pending' };
    }
    applyCheckpoint(run, input, at, false);
    if (kind === 'review') {
      run.review = reviewEvidence(root, req, run, packet, result, { review: text }, getSnapshot);
      run.decision = null;
    }
    applyDevEvidence(root, req, run, input, at, { [kind]: text }, getSnapshot);
    run.history.at(-1).artifact = { kind, hash: digest, version };
    run.revision++; run.updated_at = at; run.last_finalization = key;
    const op = randomUUID();
    const staged = path.join(root, 'workflow-run/tmp/finalize', `${op}.md`);
    fs.mkdirSync(path.dirname(staged), { recursive: true });
    fs.writeFileSync(staged, text, { flag: 'wx' });
    return { ...meta, pending_finalization: { id: op, key, run_id: id, revision, kind, before, hash: digest, version, previous, staged: relative(root, staged), run, packet, checkpoint: input } };
  }, { root, allowFinalization: true });
  if (repeated) return repeated;
  return resumeFinalization(root, { branch, id });
}
