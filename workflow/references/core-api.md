# Workflow Core 内部接口

状态：第一实施切片。`resume/abort` 与 `reindex` 的最终字段约定仍由 [Issue #4](https://github.com/guilianerde/skills-init/issues/4) 跟踪。

入口：

```js
import { createWorkflow } from '../workflow/core/index.mjs';

const workflow = createWorkflow({
  root: '/absolute/business/project',
  documentPolicy,
});
```

`root` 必须显式且为绝对路径。构造不读写文件、不启动子进程、不创建运行。`documentPolicy` 只在正式产物收尾时需要；不提供时 `artifacts.finalize` 返回 `INVALID_ARGUMENT`。

## 方法

| 分组 | 方法 | 输入 | 结果 |
| --- | --- | --- | --- |
| requirements | `bind` | `{ name?, branch, base? }` | 绑定、目录和分支 |
| requirements | `which` | `{ branch }` | 当前绑定；只读 |
| maintenance | `reindex` | `{ branch?, all? }` | 派生索引结果；不推进运行 |
| runs | `start` | `{ branch, kind?, size?, input?, dir? }` | 新建或恢复现有活动运行 |
| runs | `status` | `{ branch, id? }` | 当前运行列表、下一步和证据新鲜度 |
| runs | `get` | `{ branch, id }` | 指定运行及需求目录 |
| runs | `save` | `{ branch, id, expectedRevision, input }` | 保存 checkpoint |
| runs | `complete` | `{ branch, id, expectedRevision, input? }` | 完成并通过末步门禁 |
| runs | `cancel` | `{ branch, id, expectedRevision, reason }` | 取消运行 |
| snapshots | `capture` | `{ branch, id }` | 当前分支代码快照 |
| artifacts | `finalize` | `{ branch, id, expectedRevision, kind, text, input?, packet?, result? }` | 发布、归档、索引和证据 |
| artifacts | `resume` | 暂定 | Issue #4 冻结前返回 `NOT_IMPLEMENTED` |
| artifacts | `abort` | 暂定 | Issue #4 冻结前返回 `NOT_IMPLEMENTED` |
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
- `STORAGE_ERROR`
- `NOT_IMPLEMENTED`

CLI 将错误作为 JSON 写到 stderr，并返回非零退出码。底层 I/O 错误保留为 `cause`，路径等安全元信息可放入 `details`。

## finalize 重放

请求标识使用递归键排序的稳定 JSON，包含 run、原始 `expectedRevision`、产物类型、发布正文摘要、checkpoint、packet 和 result。同一语义请求重复时返回 `alreadyFinalized: true`，不增加 revision、历史或版本；正文或输入变化后不能借旧 revision 绕过冲突检查。

## 配置来源

项目配置只从目标 root 解析。规范位置 `.agents/skills/workflow/` 优先；其他支持的安装位置只在规范位置不存在时参与解析。多个不同真实配置目录会返回 `PROJECT_CONFIG_AMBIGUOUS`，当前选择机制见 [Issue #5](https://github.com/guilianerde/skills-init/issues/5)。

## 尚未迁移

现有 `artifact.mjs resume/abort` 命令暂时保留原恢复实现，以便未定契约期间仍能处理已经存在的 pending 事务。核心 API 对两操作保持显式占位，不将旧签名误发布为最终契约。
