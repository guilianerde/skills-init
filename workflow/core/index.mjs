import path from 'node:path';

import { changeRun, readRun, runState, startRun } from '../lib/runs.mjs';
import {
  bind as bindRequirement,
  reindex as reindexRequirements,
  which as whichRequirement,
} from '../lib/requirements.mjs';
import { finalizeArtifact } from '../lib/artifact-finalize.mjs';
import { codeSnapshot } from '../lib/code-snapshot.mjs';
import { WORKFLOW_ERROR_CODES, WorkflowError, toWorkflowError } from './errors.mjs';
import {
  createCodeHandoff,
  createDocumentHandoff,
  writeReviewPacket,
} from './review-handoff.mjs';

export { WORKFLOW_ERROR_CODES, WorkflowError };

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = (message, details) => {
  throw new WorkflowError(WORKFLOW_ERROR_CODES.INVALID_ARGUMENT, message, { details });
};
const invoke = (operation, fallbackCode) => {
  try {
    return operation();
  } catch (error) {
    throw toWorkflowError(error, fallbackCode);
  }
};
const requireObject = (value, name) => {
  if (!isObject(value)) invalid(`${name} 必须是对象`);
  return value;
};
const requireBranch = (branch) => {
  if (typeof branch !== 'string' || !branch.trim()) invalid('branch 必须是非空字符串');
  return branch;
};
const requireRunId = (id) => {
  if (typeof id !== 'string' || !id.trim()) invalid('id 必须是非空字符串');
  return id;
};
const requireRevision = (expectedRevision) => {
  if (!Number.isInteger(expectedRevision)) invalid('expectedRevision 必须是整数');
  return expectedRevision;
};
const requireInput = (input, name = 'input') => {
  if (input === undefined) return {};
  if (!isObject(input)) invalid(`${name} 必须是对象`);
  return input;
};
const pendingBlocker = (operation) => {
  throw new WorkflowError(
    WORKFLOW_ERROR_CODES.NOT_IMPLEMENTED,
    `${operation} 的核心契约尚待 Issue #4 明确，当前仅完成入口占位`,
    { details: { issue: 4, operation } },
  );
};

function normalizeRoot(root) {
  if (typeof root !== 'string' || !root.trim() || !path.isAbsolute(root)) {
    throw new WorkflowError(
      WORKFLOW_ERROR_CODES.PROJECT_ROOT_INVALID,
      'root 必须是明确的绝对项目路径',
    );
  }
  return path.resolve(root);
}

export function createWorkflow({ root, documentPolicy } = {}) {
  const projectRoot = normalizeRoot(root);
  if (documentPolicy !== undefined && (typeof documentPolicy !== 'object' || documentPolicy === null || typeof documentPolicy.validate !== 'function')) {
    invalid('documentPolicy 必须提供 validate 方法');
  }

  return Object.freeze({
    root: projectRoot,

    requirements: Object.freeze({
      bind(options) {
        const { name = null, branch, base = null } = requireObject(options, 'requirements.bind');
        requireBranch(branch);
        return invoke(
          () => bindRequirement(projectRoot, { name, branch, base }),
          WORKFLOW_ERROR_CODES.REQUIREMENT_NOT_READY,
        );
      },

      which(options) {
        const { branch } = requireObject(options, 'requirements.which');
        requireBranch(branch);
        return invoke(
          () => whichRequirement(projectRoot, branch),
          WORKFLOW_ERROR_CODES.REQUIREMENT_NOT_READY,
        );
      },
    }),

    maintenance: Object.freeze({
      reindex(options) {
        const { branch = null, all = false } = requireObject(options, 'maintenance.reindex');
        if (!all) requireBranch(branch);
        return invoke(
          () => reindexRequirements(projectRoot, { branch, all }),
          WORKFLOW_ERROR_CODES.REQUIREMENT_NOT_READY,
        );
      },
    }),

    runs: Object.freeze({
      start(options) {
        const { branch, kind = 'feature', size = null, input, dir = null } = requireObject(options, 'runs.start');
        requireBranch(branch);
        return invoke(() => startRun(projectRoot, {
          branch,
          kind,
          size,
          input: requireInput(input),
          dir,
        }));
      },

      status(options) {
        const { branch, id = null } = requireObject(options, 'runs.status');
        requireBranch(branch);
        if (id !== null) requireRunId(id);
        const state = invoke(() => runState(projectRoot, branch, undefined, id));
        if (id !== null && !state.current) {
          throw new WorkflowError(WORKFLOW_ERROR_CODES.RUN_NOT_FOUND, `找不到运行：${id}`, {
            details: { id, branch },
          });
        }
        return state;
      },

      get(options) {
        const { branch, id } = requireObject(options, 'runs.get');
        requireBranch(branch);
        requireRunId(id);
        const result = invoke(() => readRun(projectRoot, branch, id));
        return { dir: result.req.dir, run: result.run };
      },

      save(options) {
        const { branch, id, expectedRevision, input } = requireObject(options, 'runs.save');
        requireBranch(branch);
        requireRunId(id);
        requireRevision(expectedRevision);
        return invoke(() => changeRun(projectRoot, {
          branch,
          id,
          revision: expectedRevision,
          input: requireInput(input),
          action: 'save',
        }));
      },

      complete(options) {
        const { branch, id, expectedRevision, input } = requireObject(options, 'runs.complete');
        requireBranch(branch);
        requireRunId(id);
        requireRevision(expectedRevision);
        return invoke(() => changeRun(projectRoot, {
          branch,
          id,
          revision: expectedRevision,
          input: requireInput(input),
          action: 'complete',
        }));
      },

      cancel(options) {
        const { branch, id, expectedRevision, reason } = requireObject(options, 'runs.cancel');
        requireBranch(branch);
        requireRunId(id);
        requireRevision(expectedRevision);
        if (typeof reason !== 'string' || !reason.trim()) invalid('reason 必须是非空字符串');
        return invoke(() => changeRun(projectRoot, {
          branch,
          id,
          revision: expectedRevision,
          input: { reason },
          action: 'cancel',
        }));
      },
    }),

    snapshots: Object.freeze({
      capture(options) {
        const { branch, id } = requireObject(options, 'snapshots.capture');
        requireBranch(branch);
        requireRunId(id);
        return invoke(() => {
          const { req, run } = readRun(projectRoot, branch, id);
          if (req.meta.pending_finalization) {
            throw new WorkflowError(
              WORKFLOW_ERROR_CODES.PENDING_FINALIZATION,
              '先处理待完成的产物收尾，再获取代码快照',
              { details: { runId: id, operationId: req.meta.pending_finalization.id ?? null } },
            );
          }
          return { ok: true, snapshot: codeSnapshot(projectRoot, run) };
        });
      },
    }),

    artifacts: Object.freeze({
      finalize(options) {
        const {
          branch,
          id,
          expectedRevision,
          kind,
          text,
          input,
          packet = null,
          result = null,
        } = requireObject(options, 'artifacts.finalize');
        requireBranch(branch);
        requireRunId(id);
        requireRevision(expectedRevision);
        if (typeof kind !== 'string' || !kind.trim()) invalid('kind 必须是非空字符串');
        if (typeof text !== 'string') invalid('text 必须是非空正式正文');
        if (!documentPolicy) invalid('正式产物发布必须提供 documentPolicy');
        if (packet !== null && !isObject(packet)) invalid('packet 必须是对象或 null');
        if (result !== null && !isObject(result)) invalid('result 必须是对象或 null');
        const finalized = invoke(() => finalizeArtifact(projectRoot, {
          branch,
          id,
          revision: expectedRevision,
          kind,
          text,
          input: requireInput(input),
          packet,
          result,
        }, (candidate) => documentPolicy.validate({ kind, text: candidate })));
        return { ...finalized, alreadyFinalized: finalized.already_finalized === true };
      },
      resume() {
        pendingBlocker('artifacts.resume');
      },
      abort() {
        pendingBlocker('artifacts.abort');
      },
    }),

    reviews: Object.freeze({
      prepare(options) {
        const {
          branch,
          id,
          kind = null,
          text = null,
          depth = '标准',
          capabilities = null,
        } = requireObject(options, 'reviews.prepare');
        requireBranch(branch);
        requireRunId(id);
        if (kind !== null && !['requirement', 'plan'].includes(kind)) invalid('kind 只能是 requirement / plan 或 null');
        if (kind !== null && typeof text !== 'string') invalid('文档审查需要提供 text');
        if (capabilities !== null && !isObject(capabilities)) invalid('capabilities 必须是对象或 null');
        return invoke(() => {
          const packet = kind === null
            ? createCodeHandoff(projectRoot, { branch, id, depth, capabilities })
            : createDocumentHandoff(projectRoot, { branch, id, kind, text });
          const fileName = kind === null ? 'handoff.json' : `${kind}-${packet.inputs}.json`;
          return { ok: true, path: writeReviewPacket(projectRoot, packet, fileName), packet };
        });
      },
    }),
  });
}
