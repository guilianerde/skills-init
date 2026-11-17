export const WORKFLOW_ERROR_CODES = Object.freeze({
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  PROJECT_ROOT_INVALID: 'PROJECT_ROOT_INVALID',
  PROJECT_CONFIG_AMBIGUOUS: 'PROJECT_CONFIG_AMBIGUOUS',
  REQUIREMENT_NOT_READY: 'REQUIREMENT_NOT_READY',
  REQUIREMENT_NOT_BOUND: 'REQUIREMENT_NOT_BOUND',
  BRANCH_MISMATCH: 'BRANCH_MISMATCH',
  RUN_NOT_FOUND: 'RUN_NOT_FOUND',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  RUN_TERMINAL: 'RUN_TERMINAL',
  STAGE_NOT_ALLOWED: 'STAGE_NOT_ALLOWED',
  GATE_REJECTED: 'GATE_REJECTED',
  EVIDENCE_INVALID: 'EVIDENCE_INVALID',
  PENDING_FINALIZATION: 'PENDING_FINALIZATION',
  PENDING_OPERATION_MISMATCH: 'PENDING_OPERATION_MISMATCH',
  STORAGE_ERROR: 'STORAGE_ERROR',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
});

const knownCodes = new Set(Object.values(WORKFLOW_ERROR_CODES));

export class WorkflowError extends Error {
  constructor(code, message, { details, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'WorkflowError';
    this.code = code;
    this.details = details && typeof details === 'object' && !Array.isArray(details) ? details : {};
  }
}

const rules = [
  [/项目存在多个不同的 workflow 配置目录/, WORKFLOW_ERROR_CODES.PROJECT_CONFIG_AMBIGUOUS],
  [/版本冲突|expect-revision/, WORKFLOW_ERROR_CODES.REVISION_CONFLICT],
  [/找不到运行/, WORKFLOW_ERROR_CODES.RUN_NOT_FOUND],
  [/运行已结束/, WORKFLOW_ERROR_CODES.RUN_TERMINAL],
  [/收尾尚未完成|待完成收尾|pending_finalization/i, WORKFLOW_ERROR_CODES.PENDING_FINALIZATION],
  [/operationId.*(?:不匹配|已消失|已替换)|待办操作.*不匹配/i, WORKFLOW_ERROR_CODES.PENDING_OPERATION_MISMATCH],
  [/尚未绑定|绑定指定需求|先确认需求/, WORKFLOW_ERROR_CODES.REQUIREMENT_NOT_BOUND],
  [/其他分支|实际工作区分支|当前分支.*不一致|不在.*分支/, WORKFLOW_ERROR_CODES.BRANCH_MISMATCH],
  [/无效阶段|不属于当前运行|应在 .* 收尾|该产物种类/, WORKFLOW_ERROR_CODES.STAGE_NOT_ALLOWED],
  [/证据|快照|报告版本|需求版本|方案依据|旧交付|审查结果|审查覆盖/, WORKFLOW_ERROR_CODES.EVIDENCE_INVALID],
];

export function toWorkflowError(error, fallbackCode = WORKFLOW_ERROR_CODES.GATE_REJECTED) {
  if (error instanceof WorkflowError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const explicitCode = error?.code;
  if (knownCodes.has(explicitCode)) {
    return new WorkflowError(explicitCode, message, { details: error.details, cause: error });
  }
  if (typeof explicitCode === 'string' && /^E[A-Z0-9_]+$/.test(explicitCode)) {
    return new WorkflowError(WORKFLOW_ERROR_CODES.STORAGE_ERROR, message, {
      details: { causeCode: explicitCode, path: error.path ?? null },
      cause: error,
    });
  }
  for (const [pattern, code] of rules) {
    if (pattern.test(message)) return new WorkflowError(code, message, { cause: error });
  }
  return new WorkflowError(fallbackCode, message, { cause: error });
}
