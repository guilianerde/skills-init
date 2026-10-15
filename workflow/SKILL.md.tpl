---
name: workflow
description: "Entry point for this project's personal dev workflow skills. Routes a request to the right skill (dev, project-review, database-query, create-tech-md-doc, create-release-md-doc, md-to-wiki, DocNexus), owns the shared project profile (workflow/profile.json: main branch, build/test commands, config center, deploy platform) and the capability check for wiki / DocNexus / database. Use when the user invokes /workflow, asks what the workflow can do, wants to set up or update the project profile, check which integrations are configured, or hands over a multi-stage task such as 从需求到上线 / 这个需求从头到尾帮我搞定 / 现在 skills 配好了吗 / 项目画像 / workflow status. Other skills in this project read workflow/profile.json and follow the capability check defined here. When a request clearly belongs to a single skill, use that skill directly instead."
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
| 审代码、审分支、合并前检查 | `project-review` | |
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
| `main_branch` | 主分支名，diff 基线 | dev、project-review、文档类 |
| `build` / `test` / `lint` | 构建、全量测试、静态检查命令 | dev |
| `test_single` | 只跑一个测试的命令，`{target}` 为测试类或文件，如 `mvn -q test -Dtest={target}` | dev |
| `config_center` | 配置中心：`nacos` / `apollo` / `spring-cloud-config` / `none`，空 = 未知 | project-review 第 10 维度、dev 配置清单、上线方案 |
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
| DocNexus | 项目根有 `docnexus/project.json`，且 `./node_modules/.bin/docnexus` 可执行 | 查约定与历史决策、沉淀知识、提供文档模板 |
| 数据库 | `database-query/config.json` 存在且 `connections` 非空 | 查表结构、核对数据 |
| 项目画像 | `workflow/profile.json` 中 `main_branch` 与 `build` / `test` 非空 | dev 构建与测试 |

### `/workflow status` 输出

```
# Workflow 状态

| 能力 | 状态 | 说明 / 如何启用 |
|---|---|---|
| 项目画像 | ✅ / ⚠️ 部分字段为空 | <空字段>；运行 /workflow profile |
| wiki | ✅ / ❌ | 填写 md-to-wiki/wiki-config.json 或接入 wiki MCP |
| DocNexus | ✅ / ❌ | 重跑 skills-init 并加 --with-docnexus；已接入但缺模板时列出缺的模板并提示 --seed-templates |
| 数据库 | ✅ / ❌ | 重跑 init-skills 补配 |
```

探测只读文件、只看命令是否存在，**不输出任何凭据内容**（密码、token 一律不回显）。

## 模板来源（文档类 skill 共用）

技术方案、上线方案、开发方案、审查清单的模板来源取决于项目是否接入了 DocNexus（判定见上方「增强能力探测」），并在产出中注明「模板来源」：

**已接入 DocNexus：只用 DocNexus 里的模板**

- 读取 `docnexus/library/templates/<skill>/<文件名>`（分类 `doc-template`）。它是普通 Markdown，直接读文件即可，你手工改过的内容也会立即生效；需要确认版本时用 `./node_modules/.bin/docnexus document query --category doc-template`。
- **不再使用** skill 自带的默认模板，也不使用 `docs/skills/templates/` 下的项目文件——知识库是唯一来源，避免几份模板各自演化。
- 库里没有需要的模板 → **停下这一步**，告诉用户缺哪份模板，提供两个选择：在项目根重跑 skills-init 加 `--seed-templates` 导入默认模板；或者由你现在把模板导入 DocNexus（项目里有 `docs/skills/templates/` 的同名文件时导入它，否则导入 skill 自带的默认模板），用户确认后按 DocNexus 的 capture 流程写入 `templates/<skill>/<文件名>`，分类 `doc-template`。导入完成后再继续生成。
- 发现 `docs/skills/templates/` 下还有模板文件 → 提醒用户它们已不再生效，建议导入 DocNexus 后删除。

**未接入 DocNexus：按顺序取第一个存在的**

1. 项目文件 `docs/skills/templates/<skill>/<文件名>`
2. skill 自带默认模板

| skill | 文件名 | 自带默认位置 |
|---|---|---|
| create-tech-md-doc | `template.md` | `create-tech-md-doc/template.md` |
| create-release-md-doc | `template.md` | `create-release-md-doc/template.md` |
| dev | `plan-template.md` | `dev/references/plan-template.md` |
| project-review | `checklist.md` | `project-review/references/checklist.md` |

- 把默认模板导入 DocNexus：`--with-docnexus` 接入时会自动导入；之后补导入可重跑 skills-init 并加 `--seed-templates`（已存在的不覆盖）。
- **模板随知识库更新**：用户在生成的文档里做了结构性调整（新增 / 删除 / 重排章节、改表格列、改必填项），且项目已接入 DocNexus 时，交付后列出这些调整，**询问**是否同步回模板；同意后按 DocNexus 的 capture 流程更新同一路径（先 `document get --include document,metadata,timeline` 取 `record_version`，以 `--base-version <record_version>` 封存，用户确认后 `document add --draft <id> --replace`），DocNexus 会在 timeline 中记录每次变更。只改结构，不把某次需求的具体内容写进模板。用户也可以直接编辑库里的模板文件，再用 `docnexus document sync --id <id>` 采纳。
- 模板里的 `{{...}}` 是给 agent 看的填写提示，不是模板引擎语法；不要写成单独一行的 `{{fact:...}}`（那是 DocNexus 的事实引用语法）。

## Rules

- 本 skill 只路由和维护 `profile.json`，不写业务代码；具体工作交给对应 skill，并遵守该 skill 的规则。
- `profile.json` 只记录项目事实，不写密码、token、内网凭据。
- 用户的请求明显只属于某个 skill 时，不要先跑完整链路或状态检查，直接进入那个 skill。
