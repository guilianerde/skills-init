# 开工能力与失败处理

依赖 workflow 的 Skill 共用本规则。开工在项目根运行一次：

```sh
node <skills>/workflow/scripts/resolve.mjs status
```

保留输出作为本轮能力快照；同一项目的流程跳转、子 agent 直接复用，由主 agent 一并交接，可用 workflow-run/tmp/capabilities.json 暂存交接。新会话恢复、切换项目、配置或安装发生变化时重新探测。快照仅本轮使用，不作为团队配置或固定状态写入 meta.json。

独立 nacos-config 不要求加载 workflow 或运行本命令，也没有对应的集中能力字段；其 `inspect` 仅检查本地候选，`get` 才验证远端。dev / project-review 内调用它时沿用已有工作流快照，Nacos 读取结果另带配置来源，不据 `profile.config_center` 推断连接可用。

## 开工门槛

`ready` 表示必装组件 DocNexus 已接入；为 false 时先报告 `blockers`，修复后再开始任务。不跳过知识库，不回退到内置模板。status / profile / report / view 等诊断、只读查看与安装修复仍可执行。

开工时仅一次查看当前会话工具：有 wiki MCP 就将本轮 `wiki.channel` 选为 `mcp`、`wiki.ok` 视为 true，否则沿用输出的 `rest` 或空通道；MCP、子 agent 无法由脚本探测，不把 unknown 解释为不存在。wiki / 数据库的配置检查不代表远端连接、鉴权已通过。

## 本轮能力选择

| 能力字段 | 选择 |
|---|---|
| `docnexus` | 必需：按 `run` 调用；知识检索无匹配是正常结果，调用失败必须修复后继续 |
| `codegraph.mode=script` | `cg.mjs impact / entry`，读链路可使用当前会话的 CodeGraph MCP 或已可用的 CLI |
| `codegraph.mode=cli` | 用 CodeGraph 原生查询命令；不要调用依赖 Node 库的 `cg.mjs impact / entry` |
| `codegraph.mode=source` | 直接搜索、读代码与调用链；不自动安装或建索引 |
| `codegraph.scan=true` | `cg.mjs mq / jobs / tables` 源码扫描可用，不要求索引或 Node 库 |
| `wiki.channel` | 用选定通道读 PRD或发布；无通道时读 PRD 可改用用户提供的内容，发布任务必须先配置 |
| `database.ok` | 配置存在时可做实际库核对；未配置则读 schema / DDL，注明「未与实际库核对」；用户明确要求查库时必须先配置 |
| `templates` | 只使用当前 Skill 所需条目的 `path`；缺失按 templates.md 处理，不能用其他模板凑数 |

缺少可选增强时不试跑对应命令、不逐步重复提示安装；在最终产物汇总未覆盖项。没有调用方、没有知识命中不代表代码安全或业务事实不存在。

## 执行中失败

- **DocNexus 或所需模板失败**：保留错误与进度，修复后重试；不降级，不把失败当作没有相关知识。已有运行按 runs.md 保存阻塞与原因。
- **可选增强失败**：保留原因，本轮换到已知可用通道或源码，不反复重试；PRD 拉取按 prd-fetch.md 回退，数据库核对标未验证。明确要求发布或查库时不能降级成已完成。
- **模板缺失**：`resolve.mjs template <skill> <id>` 输出最新的 path / expected / hint；统一按 templates.md 创建或导入，完成后刷新快照，不在各 Skill 复制分支。
- **其他错误**：按命令自身语义处理。退出码 2 不是统一的「未接入」：需求未绑定、缺模板、数据库语句拦截等不能当作可选增强跳过。

知识写入、发布、数据库写操作仍遵守各流程的用户授权要求；组件必装不代表自动授权沉淀。
