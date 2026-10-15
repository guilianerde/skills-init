---
name: workflow
description: "Entry point for this project's personal dev workflow skills. Routes a request to the right skill (dev, code-review, database-query, create-tech-md-doc, create-release-md-doc, md-to-wiki, DocNexus), owns the shared project profile (workflow/profile.json: main branch, build/test commands, config center, deploy platform) and the capability check for wiki / DocNexus / database. Use when the user invokes /workflow, asks what the workflow can do, wants to set up or update the project profile, check which integrations are configured, or hands over a multi-stage task such as 从需求到上线 / 这个需求从头到尾帮我搞定 / 现在 skills 配好了吗 / 项目画像 / workflow status. Other skills in this project read workflow/profile.json and follow the capability check defined here."
---

# Workflow

本项目个人开发工作流的入口：决定由哪个 skill 处理请求，维护所有 skill 共用的**项目画像**，并统一**增强能力探测**。本 skill 自身不写业务代码。

## Command Format

```
/workflow                 # 根据用户请求路由；无具体请求时输出能力地图 + 状态
/workflow status          # 能力探测报告
/workflow profile         # 填写或更新项目画像
```

## 能力地图（路由）

| 用户意图 | 交给 | 备注 |
|---|---|---|
| 开发新功能、改逻辑、加接口 | `dev` | 默认功能开发模式 |
| 修 bug、排查报错、线上问题 | `dev --bug` | 先复现再修 |
| 审代码、审分支、合并前检查 | `code-review` | |
| 查库、跑 SQL、核对数据 | `database-query` | 只读优先 |
| 根据分支 diff 出技术方案 | `create-tech-md-doc` | 可带 `--prd` |
| 根据分支 diff 出上线方案 | `create-release-md-doc` | 可带 `--tech` 复用技术方案 |
| 把 md 发布到 wiki | `md-to-wiki` | 需 wiki 已配置 |
| 记住 / 查找项目决策与约定 | DocNexus（入口 skill `docnexus`） | 需已接入；写入必须用户授权 |

意图明确时直接按对应 skill 执行，不必先输出这张表。意图横跨多个阶段时按下面的「完整链路」逐段推进，每段结束告诉用户下一段是什么，由用户决定是否继续。

### 完整链路（从需求到上线）

```
dev（需求 → 方案 → 实现 → 测试 → 自审）
  → create-tech-md-doc（M / L 规模）
  → md-to-wiki（发布技术方案，可选）
  → create-release-md-doc（要上线时）
  → md-to-wiki（发布上线方案，可选）
  → DocNexus 沉淀（可选，需授权）
```

提交、推送、发布 wiki、写入 DocNexus 都是对外动作，每一步都要用户明确同意。

## 项目画像（workflow/profile.json）

所有 skill 共用的项目事实，放在本 skill 目录下，**不含任何凭据**，可以提交到 git。缺失的字段一律视为空。

| 字段 | 含义 | 谁在用 |
|---|---|---|
| `main_branch` | 主分支名，diff 基线 | dev、code-review、文档类 |
| `build` / `test` / `lint` | 构建、全量测试、静态检查命令 | dev |
| `test_single` | 只跑一个测试的命令，`{target}` 为测试类或文件，如 `mvn -q test -Dtest={target}` | dev |
| `config_center` | 配置中心：`nacos` / `apollo` / `spring-cloud-config` / `none`，空 = 未知 | code-review 第 10 维度、dev 配置清单、上线方案 |
| `deploy.platform` | 发布平台名称（如公司内部发布系统） | 技术 / 上线方案「上线服务」 |
| `deploy.regions` | 可选的部署环境 / Region 列表 | 技术 / 上线方案 |
| `job_annotation` | 定时任务注解（如 `@XxlJob`、`@Scheduled`） | 技术方案「定时任务变更」 |
| `data_review` | 上线前是否需要数据团队评审库表（`true` / `false`） | 技术方案模块 7、上线方案 2.3 |
| `notes` | 其他项目约定，一条一句（如「启动需要本地 Redis」） | 全部 |

### 填写与更新

由 `/workflow profile` 触发，或其他 skill 首次需要某个字段但它为空时触发：

1. 从仓库推断：`pom.xml` / `build.gradle`、`package.json` scripts、`go.mod`、`pyproject.toml`、`Makefile`、CI 配置（`.github/workflows`、`.gitlab-ci.yml`）、配置文件中的配置中心依赖（如 `spring-cloud-starter-alibaba-nacos-config`、`apollo-client`）、`CLAUDE.md` / `AGENTS.md` 的约定、`git symbolic-ref refs/remotes/origin/HEAD`。
2. 推断不出的字段（发布平台、Region、是否数据评审）问用户；用户不知道就留空，**不要沿用其他项目的取值**。
3. 把拟写入的完整 JSON 给用户确认，确认后再写入；未确认则只在本次对话中使用。
4. 只改用户确认的字段，保留其他已有字段。

## 增强能力探测

所有 skill 用同一套判断；任何一项不可用都**不阻塞主流程**，只是跳过对应增强并在产出中注明。

| 能力 | 判定为可用 | 用途 |
|---|---|---|
| wiki | `md-to-wiki/wiki-config.json` 中 `enabled=true` 且 `wiki.base_url` 非空；或环境存在 wiki MCP 工具 | 读 PRD、发布文档 |
| DocNexus | 项目根有 `docnexus/project.json`，且 `./node_modules/.bin/docnexus` 可执行 | 查约定与历史决策、沉淀知识 |
| 数据库 | `database-query/config.json` 存在且 `connections` 非空 | 查表结构、核对数据 |
| 项目画像 | `workflow/profile.json` 中 `main_branch` 与 `build` / `test` 非空 | dev 构建与测试 |

### `/workflow status` 输出

```
# Workflow 状态

| 能力 | 状态 | 说明 / 如何启用 |
|---|---|---|
| 项目画像 | ✅ / ⚠️ 部分字段为空 | <空字段>；运行 /workflow profile |
| wiki | ✅ / ❌ | 填写 md-to-wiki/wiki-config.json 或接入 wiki MCP |
| DocNexus | ✅ / ❌ | 重跑 init-skills 并加 --with-docnexus |
| 数据库 | ✅ / ❌ | 重跑 init-skills 补配 |
```

探测只读文件、只看命令是否存在，**不输出任何凭据内容**（密码、token 一律不回显）。

## Rules

- 本 skill 只路由和维护 `profile.json`，不写业务代码；具体工作交给对应 skill，并遵守该 skill 的规则。
- `profile.json` 只记录项目事实，不写密码、token、内网凭据。
- 用户的请求明显只属于某个 skill 时，不要先跑完整链路或状态检查，直接进入那个 skill。
