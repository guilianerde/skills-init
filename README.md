# workflow-run — 项目级 Agent Skills

为 Codex、Claude Code、豆包办公、Qwen Code 和 WorkBuddy 安装 9 个项目级 skills，覆盖开发、代码审查、只读查询和文档交付。

## 安装

需要 **Node.js >= 22.13** 与 npm，在业务项目根执行；Windows 使用管理员终端。

```bash
# Codex：非交互安装，暂不配置数据库
npx @rowansenne/workflow-run@latest --envs codex --yes --skip-db

# 交互选择环境、配置数据库，并接入 CodeGraph
npx @rowansenne/workflow-run@latest --with-codegraph
```

DocNexus 必装并自动接入，CodeGraph 可选。安装后重新打开代理会话，运行 `/workflow profile` 填写项目画像，再运行 `/workflow status` 检查状态。

## 在代理里使用

以下输入放在代理对话中，分支、路径、连接名和页面 ID 按项目替换。

| Skill | 示例 |
| --- | --- |
| workflow | `/workflow resume` 继续流程；`/workflow view` 查看需求文档 |
| dev | `/dev 订单导出支持按渠道筛选`；`/dev --bug 导出订单时重复返回数据` |
| project-review | `用 project-review 审查当前分支相对 main 的改动` |
| code-graph | `用 code-graph 查看 OrderService.exportOrders 的调用入口` |
| database-query | `用 database-query 查询 test 连接：SELECT id, status FROM orders LIMIT 10` |
| nacos-config | `用 nacos-config 读取测试环境 order-test.yaml 中的 order.timeout` |
| create-tech-md-doc | `/create-tech-md-doc feature/order-export main` |
| create-release-md-doc | `/create-release-md-doc feature/order-export main` |
| md-to-wiki | `/md-to-wiki "技术方案.md" 123456`（需配置 wiki 和已有目标页面） |

完整 dev 流程：业务场景清单 → 技术澄清 → 方案 → 实现与验证（接口改动含 HTTP 测试）→ 审查 → 选择修复或交付。明确调用 dev 或要求完整开发流程后才启动，普通修改、测试和提交请求直接处理。

更多示例：[流程、模板与审查](docs/workflows.md#代理命令示例) · [数据库、CodeGraph、Nacos 与 wiki](docs/integrations.md)。

## 常用维护命令

以下命令在终端、业务项目根执行：

```bash
npx @rowansenne/workflow-run@latest upgrade                 # 升级 skills，保留用户配置
npx @rowansenne/workflow-run@latest doctor --offline        # 本地自检
npx @rowansenne/workflow-run@latest view --open             # 打开本地文档视图
npx @rowansenne/workflow-run@latest seed-templates --update # 补入模板并更新未定制的旧默认模板
```

团队共享 `.agents/skills/`、画像和流程产物；本机连接、凭据及 `profile.local.json` 不提交。更新 DocNexus 前阅读[旧布局清理说明](docs/integrations.md#破坏性更新旧布局强制清理)。

全部子命令与安装参数见[安装与升级](docs/installation.md#子命令)，提交边界和模板定制见[团队指南](docs/team-guide.md)。

## 文档

[安装与升级](docs/installation.md) · [工作流与命令](docs/workflows.md) · [外部能力集成](docs/integrations.md) · [团队指南](docs/team-guide.md) · [维护与发布](docs/development.md) · [更新记录](CHANGELOG.md)

[架构图解](docs/architecture.html) · [分步安装教程](docs/full-install.html)
