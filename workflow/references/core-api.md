# Workflow Core 内部接口

状态：第一阶段内部接口契约已冻结（2026-11-17）。本接口只供同包 Skills 和内部 Node.js 调用，不是第二阶段外部协议。

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

## reindex 契约

`maintenance.reindex({ branch })` 处理当前绑定需求；`maintenance.reindex({ all: true })` 逐个处理当前项目的全部需求。`all` 必须是布尔值。有 `pending_finalization` 的目录拒绝维护；批量模式按目录加锁、继续处理其他目录，不声称跨目录原子性。

只允许写以下派生字段：

- `artifacts`：当前目录内已识别产物的派生索引。Wiki 发布记录直接从 Markdown 读取，重建索引时会移除旧索引项中的 `wiki` 字段。
- `latest`：每种产物的最新文件，可能包含未登记版本。
- `indexed_at`：只在 `artifacts` 或 `latest` 变化、或旧数据缺少该字段时更新。

`versions`、`runs`、`branches`、`base`、批准、证据、正文和 `updated` 均保持不变。固定文件名没有权威 `versions` 记录时，索引项持久化为 `version: null, registered: false`，并在 `unregistered` 中返回；reindex 不提升版本、不归档、不生成证据。

单需求结果：

```js
{
  ok: true,
  dir: 'workflow-run/docs/requirements/order/svc',
  changed: true,
  artifacts: 2,          // 兼容数量字段
  artifact_count: 2,
  latest: {},
  versions: {},
  unregistered: [{ kind: 'review', file: 'review.md' }],
}
```

`all` 结果：

```js
{
  ok: false,
  results: [
    { ok: true, dir: '...', changed: false, artifact_count: 1, latest: {}, versions: {}, unregistered: [] },
    { ok: false, dir: '...', error: '产物收尾尚未完成...', code: 'PENDING_FINALIZATION' },
  ],
}
```

损坏 JSON、branch 未绑定需求等单需求错误直接抛出 `WorkflowError`；批量模式把它们记录在对应结果中。

`list`、`pending` 是 Skills 外围只读查询，`config` 是外围配置入口；它们不进入核心生命周期，也不能写 run、产物索引或证据。

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

输入固定为 `{ kind, text }`，其中 `text` 已包含需要保留的 wiki 页面记录；返回结构固定为 `{ ok, errors, warnings }`，`errors` / `warnings` 均为字符串数组。`ok !== true` 时 finalize 拒绝发布，警告随成功结果返回。policy 抛出的异常按核心错误映射处理，不吞掉后继续写文件。

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

稳定字段是 `name`、`code`、`message`、`details`；发生底层异常时同时保留 `cause`。`details` 始终是对象。调用方按 `code` 分支，不解析中文 `message`。本阶段冻结的错误码集合见下方，新增或删除属于接口变更。

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
- `NOT_IMPLEMENTED`（保留码；第一阶段已迁移的操作不使用）

CLI 将错误作为 JSON 写到 stderr，并返回非零退出码。底层 I/O 错误保留为 `cause`，路径等安全元信息可放入 `details`。

## finalize 重放

请求标识使用递归键排序的稳定 JSON，包含 run、原始 `expectedRevision`、产物类型、发布正文摘要、checkpoint、packet 和 result。同一语义请求重复时返回 `alreadyFinalized: true`，不增加 revision、历史或版本；正文或输入变化后不能借旧 revision 绕过冲突检查。

首次成功和成功重放均有 `ok`、`path`、`run`；核心门面把底层 `already_finalized` 原样保留，并增加 camelCase `alreadyFinalized`。首次成功为 `false`，成功重放为 `true`。成功重放不承诺在后续别的 finalize 或正文变化后继续返回旧响应，调用方必须检查 `run.revision` 与正文当前状态。

首次发布还返回 `operationId`、`baseRevision`、`cite`、`previous`、`version`、`lint`；重放只证明请求对应操作的成功结果已经提交，调用方不能据旧 `alreadyFinalized` 声称当前代码证据仍然有效。

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

项目配置只从目标 root 解析。`workflow-run/profile-source.json` 中的显式选择优先级最高；没有显式选择时，规范位置 `.agents/skills/workflow/` 优先；其他支持的安装位置只在规范位置不存在时参与解析。

`--copy` 多环境安装首次生成的多份 `profile.json` / `profile.local.json` 内容完全相同时，可以自动使用按 `.agents` → `.claude` → `.qwen` → `.codebuddy` 固定顺序出现的第一份；任一份配置变化后，解析会返回 `PROJECT_CONFIG_AMBIGUOUS`，不会静默改选。显式选择只在目标 root 内受支持的安装目录中生效：

```sh
node <skills>/workflow/scripts/requirement.mjs config --profile-source claude
node <skills>/workflow/scripts/requirement.mjs config --profile-source .qwen/skills/workflow
node <skills>/workflow/scripts/requirement.mjs config --profile-source auto
```

选择写入 `workflow-run/profile-source.json` 的 `profile_dir`，`auto` 删除该文件并恢复自动解析。来源文件损坏、目录被删除或试图选择 root 外目录时返回 `PROJECT_CONFIG_AMBIGUOUS`，`details.reason` 为 `invalid_source`，同时列出可用来源。

CLI 的 `artifact.mjs resume/abort --id <id>` 会先读取 status 中当前 pending 的 `runRevision` 和 `operationId`，再调用同一核心入口；若读取后 pending 被替换，核心拒绝旧请求，不会自动改绑。
