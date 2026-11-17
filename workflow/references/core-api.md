# Workflow Core 内部接口

状态：第一实施切片。`resume/abort` 已接入核心门面，pending revision 与 operationId 语义见下文；`reindex` 的最终字段约定仍由 [Issue #4](https://github.com/guilianerde/skills-init/issues/4) 跟踪。

入口：

```js
import { createWorkflow } from '../workflow/core/index.mjs';

const workflow = createWorkflow({
  root: '/absolute/business/project',
  documentPolicy,
});
```

`root` 必须显式且为绝对路径。构造不读写文件、不启动子进程、不创建运行。`documentPolicy` 只在正式产物收尾时需要；不提供时 `artifacts.finalize` 返回 `INVALID_ARGUMENT`。

Skills 命令脚本保留参数解析和人类可读输出，不转导出底层写函数。例如 `requirement.mjs` 只保留自身 CLI、只读查询与外围配置 helper，不再导出 `bind / which / reindex / reindexRequirement`；调用方必须进入 `createWorkflow` 的 `requirements.bind / which` 或 `maintenance.reindex`。核心实现模块仍供门面和同包测试内部使用，但不构成脚本级旁路。

| 能力 | 归属 | 入口 |
| --- | --- | --- |
| `bind` / `which` / `reindex` | 核心生命周期 / 查询 | `createWorkflow` |
| `list` / `pending` | Skills 外围只读展示 | `requirement.mjs` 与 `workflow/lib/workspace-read.mjs` |
| 项目配置读取与 `config` | Skills 外围配置 | `requirement.mjs` / `workflow/lib/project.mjs` |

架构测试扫描 `workflow/scripts/**/*.mjs`，禁止从 `workflow/lib/requirements.mjs` 导入或转导出 `bind / reindex / reindexRequirement`。新增旁路会直接使测试失败。

## 方法

| 分组 | 方法 | 输入 | 结果 |
| --- | --- | --- | --- |
| requirements | `bind` | `{ name?, branch, base? }` | 绑定、目录和分支 |
| requirements | `which` | `{ branch }` | 当前绑定；只读 |
| maintenance | `reindex` | `{ branch?, all? }` | 派生索引结果；不推进运行 |
| runs | `start` | `{ branch, kind?, size?, input?, dir? }` | 新建或恢复现有活动运行 |
| runs | `status` | `{ branch, id? }` | 当前运行列表、下一步、证据新鲜度以及 pending 的 revision / operationId |
| runs | `get` | `{ branch, id }` | 指定运行及需求目录 |
| runs | `save` | `{ branch, id, expectedRevision, input }` | 保存 checkpoint |
| runs | `complete` | `{ branch, id, expectedRevision, input? }` | 完成并通过末步门禁 |
| runs | `cancel` | `{ branch, id, expectedRevision, reason }` | 取消运行 |
| snapshots | `capture` | `{ branch, id }` | 当前分支代码快照 |
| artifacts | `finalize` | `{ branch, id, expectedRevision, kind, text, input?, packet?, result? }` | 发布、归档、索引和证据 |
| artifacts | `resume` | `{ branch, id, expectedRevision, operationId }` | 核对 pending 身份后发布并提交目标 revision |
| artifacts | `abort` | `{ branch, id, expectedRevision, operationId }` | 核对 pending 身份后还原文件并移除待办 |
| reviews | `prepare` | `{ branch, id, depth?, capabilities?, kind?, text? }` | 审查交接 JSON 文件 |

## 文档策略

`documentPolicy` 是受信任的代码扩展点：

```js
const documentPolicy = {
  validate({ kind, text }) {
    return {
      ok: true,
      errors: [],
      warnings: [],
    };
  },
};
```

Skills 使用 `workflow/integrations/skill-document-policy.mjs` 读取当前模板并执行正文检查。核心不跳过缺失 policy，也不把 policy 扩展成通用插件系统。

## 错误

领域失败抛出 `WorkflowError`：

```js
{
  name: 'WorkflowError',
  code: 'REVISION_CONFLICT',
  message: '...',
  details: {},
}
```

稳定 code 定义在 `workflow/core/errors.mjs`：

- `INVALID_ARGUMENT`
- `PROJECT_ROOT_INVALID`
- `PROJECT_CONFIG_AMBIGUOUS`
- `REQUIREMENT_NOT_READY`
- `REQUIREMENT_NOT_BOUND`
- `BRANCH_MISMATCH`
- `RUN_NOT_FOUND`
- `REVISION_CONFLICT`
- `RUN_TERMINAL`
- `STAGE_NOT_ALLOWED`
- `GATE_REJECTED`
- `EVIDENCE_INVALID`
- `PENDING_FINALIZATION`
- `PENDING_OPERATION_MISMATCH`
- `STORAGE_ERROR`
- `NOT_IMPLEMENTED`

CLI 将错误作为 JSON 写到 stderr，并返回非零退出码。底层 I/O 错误保留为 `cause`，路径等安全元信息可放入 `details`。

## finalize 重放

请求标识使用递归键排序的稳定 JSON，包含 run、原始 `expectedRevision`、产物类型、发布正文摘要、checkpoint、packet 和 result。同一语义请求重复时返回 `alreadyFinalized: true`，不增加 revision、历史或版本；正文或输入变化后不能借旧 revision 绕过冲突检查。

## pending 恢复与中止

收尾中断时，`meta.runs[id]` 保留已提交运行，`pending_finalization` 保存本次操作预定的下一版运行。`runs.status()` 用顶层字段表达两者：

```js
const state = workflow.runs.status({ branch, id });
// state.runRevision: 9
// state.current.revision: 8（已提交快照）
// state.pending: {
//   operationId: 'op-123',
//   runId: id,
//   kind: 'delivery',
//   baseRevision: 8,
//   runRevision: 9,
// }

workflow.artifacts.resume({
  branch,
  id,
  expectedRevision: state.runRevision,
  operationId: state.pending.operationId,
});
```

`expectedRevision` 始终是调用时的 `status.runRevision`，不是 pending 的 base revision。核心在需求锁内再次核对已保存运行等于 `baseRevision`、请求等于目标 `runRevision`，并精确比较 operationId；任一不符都不会打开、发布或还原正文。

`resume` 成功提交 pending 的目标运行。`abort` 只移除该 pending 并保留已保存的 base 运行；之后可以创建新的 pending，但它会获得新的 operationId，旧请求即使 revision 相同也不能操作新事务。若 pending 已消失、被替换或已由另一请求完成，旧 operationId 返回 `PENDING_OPERATION_MISMATCH`。

## 配置来源

项目配置只从目标 root 解析。规范位置 `.agents/skills/workflow/` 优先；其他支持的安装位置只在规范位置不存在时参与解析。多个不同真实配置目录会返回 `PROJECT_CONFIG_AMBIGUOUS`，当前选择机制见 [Issue #5](https://github.com/guilianerde/skills-init/issues/5)。

CLI 的 `artifact.mjs resume/abort --id <id>` 会先读取 status 中当前 pending 的 `runRevision` 和 `operationId`，再调用同一核心入口；若读取后 pending 被替换，核心拒绝旧请求，不会自动改绑。
