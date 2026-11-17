# 第一阶段实施报告：公共核心与 Skills 接入

状态：已实现，待发布。日期：2026-11-17。开发分支：`codex/extract-workflow-core`。

本报告记录第一阶段实际交付、验证边界和后续入口；接口定义见 [Workflow Core 内部接口](../workflow/references/core-api.md)，执行规则见 [执行约定](../workflow/references/execution.md)，原始方案见 [第一阶段方案](workflow-core-phase-one.md)。

## 交付结果

- `workflow/core/index.mjs` 提供唯一的 `createWorkflow({ root, documentPolicy })` 内部入口，覆盖需求绑定/查询、派生索引、运行、快照、正式产物收尾/恢复/中止和审查交接。
- `run.mjs`、`artifact.mjs`、`requirement.mjs`、`review-handoff.mjs` 保留 CLI 参数解析与人类可读输出，生命周期写操作统一进入核心；脚本不再转导出底层 `bind / which / reindex`。
- 需求树仍以 Markdown 和 `meta.json` 为事实来源。原子写、需求级锁、revision、pending operation identity、成功 finalize 重放和恢复冲突检查继续复用。
- `artifact.mjs finalize` 使用真实 Skills 模板策略完成 lint、发布、归档、版本与证据登记；安装后的 CLI、内部核心和发布 tarball 已验证操作同一运行。
- `requirement.mjs path`、`nextPath()`、旧 `sync` 版本 bump、旧导出与自动迁移入口已删除。正式正文只通过 finalize 发布。
- `reindex` 只允许写 `artifacts`、`latest`、`indexed_at`；无法确认版本的固定文件标记为 `version: null, registered: false`，不提升权威版本、不归档、不生成证据。
- 项目配置绑定目标 root。多环境 `--copy` 的等价 profile 自动复用；内容不同时通过 `workflow-run/profile-source.json` 和 `config --profile-source` 明确选择。
- 稳定错误通过 `WorkflowError.code / details / cause` 暴露；调用方不解析中文消息。

## 验证证据

以下为本分支最终验证范围：

- 非 upload 全量测试：286 项，255 pass、31 个平台项 skip、0 fail；覆盖核心、运行门禁、需求、文档、安装、打包、Review、DocNexus、Nacos 等本机可运行场景。
- 安装器专项：30 项，26 pass、4 个软链接平台项 skip、0 fail；真实创建单一来源、软链接和 `--copy` 目录，并验证 profile 来源选择。
- npm 发布包测试：1/1 通过；打包后安装 CLI 与全部 skills，执行安装后的脚本，再卸载并保留用户产物。
- GitHub CI：Ubuntu Node 22 / 24 跑完整测试与包测试，Windows Node 22 跑共同核心与流程测试。
- Windows 本机 `test-upload.mjs` 存在 Node/libuv 原生崩溃，作为平台限制未计入本地非 upload 全量；对应改动仍需 Linux CI 证明。
- `eval:triggers` 依赖的 Claude CLI 在当前环境持续超时，不能作为本分支的有效通过证据；不能把未完成评估写成成功。

最终提交 SHA、测试数量和 CI 链接在发布前由同一分支的最新运行补齐。

## 破坏性变化

旧流程已确认没有使用者。包含第一阶段的下一版本计划为 `0.36.0`，不提供兼容壳、双写、迁移工具或弃用期。发布说明必须列出被删除的命令、导出和字段变化；已有业务工作区中的正文、历史归档和运行数据不会被自动删除。真正更新包版本和发布 npm 仍需单独的发布流程。

## 限制与第二阶段入口

- 第一阶段内部 API 不是外部 JSON Schema、CLI 协议或 SDK，不稳定承诺不扩展到第二阶段外部接口。
- 验证执行器、可信执行来源分级、MCP、Agent Adapter、远程服务、多人权限和证据独立校验不在本阶段实现。
- 第二阶段可从 `createWorkflow` 的稳定操作面派生 CLI JSON/MCP 薄封装，但不应复制 run-gates、快照、产物版本或证据规则。
