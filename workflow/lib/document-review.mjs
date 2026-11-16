import { hash } from './code-snapshot.mjs';

const stages = { feature: { requirement: 'F3', plan: 'F4' }, bug: { requirement: 'B3', plan: 'B4' } };
const nonempty = (value) => typeof value === 'string' && Boolean(value.trim());

export const documentReviewStage = (run, kind) => stages[run.kind]?.[kind];
export const requiresDocumentReview = (run, kind) =>
  run.document_review_policy === 1 && ['M', 'L'].includes(run.size) && Boolean(documentReviewStage(run, kind));

export function documentReviewInputs(run, kind, draftHash, basis) {
  return hash(JSON.stringify({
    run_id: run.id, branch: run.branch, kind, draft_hash: draftHash,
    basis: basis ? { hash: basis.hash, version: basis.version } : null,
  }));
}

export function documentReviewEvidence(run, kind, draftHash, basis, packet, result, at) {
  if (!packet || !result) throw new Error('本轮需要文档审查，请通过 --packet 和 --result 提交审查交接与结果');
  const inputs = documentReviewInputs(run, kind, draftHash, basis);
  const reviewedBasis = packet.basis;
  const basisMatches = basis ? reviewedBasis?.path === basis.path && reviewedBasis.hash === basis.hash &&
    reviewedBasis.version === basis.version && typeof reviewedBasis.text === 'string' && hash(reviewedBasis.text) === basis.hash
    : reviewedBasis === null;
  if (packet.run_id !== run.id || packet.kind !== kind || packet.inputs !== inputs ||
      !Number.isInteger(packet.revision) || packet.revision < 1 || packet.revision > run.revision ||
      packet.draft?.hash !== draftHash || typeof packet.draft.text !== 'string' || hash(packet.draft.text) !== draftHash || !basisMatches ||
      result.run_id !== run.id || result.inputs !== inputs) {
    throw new Error('文档审查不对应本轮草稿或其依据，请重新交接并审查');
  }
  if (!['independent', 'self'].includes(result.mode) || !nonempty(result.reviewer) || !nonempty(result.summary)) {
    throw new Error('文档审查结果需要审查方式、审查者和结论');
  }
  if (result.mode === 'self' && (result.fallback?.confirmed !== true || !nonempty(result.fallback.reason))) {
    throw new Error('自查降级须有用户明确同意及无法独立审查的原因');
  }
  if (!Array.isArray(result.findings) || result.findings.some((finding) =>
    !nonempty(finding?.location) || !nonempty(finding.evidence) || !nonempty(finding.impact) ||
    typeof finding.blocking !== 'boolean')) {
    throw new Error('文档审查发现需要位置、依据、影响和 blocking 标记；没有发现时填空数组');
  }
  if (result.findings.some((finding) => finding.blocking)) throw new Error('文档审查仍有阻塞项，请修订并复审后再收尾');
  return {
    inputs, mode: result.mode, reviewer: result.reviewer, summary: result.summary, findings: result.findings, at,
    ...(result.mode === 'self' ? { fallback: { confirmed: true, reason: result.fallback.reason } } : {}),
  };
}

export function assertDocumentReview(run, kind, artifact, basis) {
  if (requiresDocumentReview(run, kind) &&
      artifact.document_review?.inputs !== documentReviewInputs(run, kind, artifact.hash, basis)) {
    throw new Error(`缺少当前版本的文档审查：${kind}.md；请重新审查并收尾`);
  }
}
