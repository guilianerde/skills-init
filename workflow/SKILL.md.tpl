---
name: workflow
description: "Entry point for this project's personal dev workflow skills. Routes a request to the right skill (dev, project-review, database-query, code-graph, create-tech-md-doc, create-release-md-doc, md-to-wiki, DocNexus), owns the shared project profile (workflow/profile.json: main branch, build/test commands, config center, deploy platform) and the capability check for wiki / DocNexus / database. Use when the user invokes /workflow, asks what the workflow can do, wants to set up or update the project profile, check which integrations are configured, wants a PR / MR description assembled from this branch's delivery note, review report and docs, wants a local report of how well the workflow is working (review findings and fix rate, clarified decisions, DocNexus capture and reuse), or hands over a multi-stage task such as 从需求到上线 / 这个需求从头到尾帮我搞定 / 现在 skills 配好了吗 / 项目画像 / workflow status / 写 PR 描述 / 生成 MR 描述 / 提个 PR / 工作流效果怎么样 / workflow report. Other skills in this project read workflow/profile.json and follow the capability check defined here. When a request clearly belongs to a single skill, use that skill directly instead."
---

# Workflow

本项目个人开发工作流的入口：决定由哪个 skill 处理请求，维护所有 skill 共用的**项目画像**，并统一**增强能力探测**。本 skill 自身不写业务代码。

## Command Format

```
/workflow                 # 根据用户请求路由；无具体请求时输出能力地图 + 状态
/workflow status          # 能力探测报告
/workflow profile         # 填写或更新项目画像
/workflow report          # 本地效果报告（审查发现与修复率、需求澄清、沉淀与复用、各分支链路）
```

## 能力地图（路由）

| 用户意图 | 交给 | 备注 |
|---|---|---|
| 开发新功能、改逻辑、加接口 | `dev` | 默认功能开发模式 |
| 修 bug、排查报错、线上问题 | `dev --bug` | 先复现再修 |
| 审代码、审分支、合并前检查 | `project-review` | |
| 查库、跑 SQL、核对数据 | `database-query` | 只读优先 |
| 影响面、谁调用了、从哪些入口进来、topic 谁发谁收、定时任务、表在哪些 SQL 里 | `code-graph` | 需 CodeGraph 索引；`mq` / `jobs` / `tables` 不需要 |
| 根据分支 diff 出技术方案 | `create-tech-md-doc` | 可带 `--prd` |
| 根据分支 diff 出上线方案 | `create-release-md-doc` | 可带 `--tech` 复用技术方案 |
| 把 md 发布到 wiki | `md-to-wiki` | 需 wiki 已配置 |
| 写 PR / MR 描述、提 PR | `workflow/scripts/pr-desc.mjs` | 汇总本分支交付说明、审查报告、技术 / 上线方案；创建 PR 需用户同意 |
| 这套工作流效果怎么样、用得怎么样 | `/workflow report` | 只读统计 `docs/skills/` 下的产物 |
| 记住 / 查找项目决策与约定 | DocNexus（入口 skill `docnexus`） | 需已接入；写入必须用户授权 |

意图明确时直接按对应 skill 执行，不必先输出这张表。目标 skill 没有安装（`resolve.mjs status` 输出的 `skills` 里没有它，安装时用了 `--skills` 子集）→ 告诉用户可以运行 `skills-init --skills <名称>` 补装，不要假装执行。意图横跨多个阶段时按下面的「完整链路」逐段推进，每段结束告诉用户下一段是什么，由用户决定是否继续。走到哪一步不靠记忆：运行 `node <skills>/workflow/scripts/artifacts.mjs [--branch <分支>]`，它扫描 `docs/skills/` 下各 skill 的产物，按元信息行里的分支归组，输出每类最新的一份、wiki 发布记录和 `next`（下一步建议）。

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

## 共用约定（按需读取）

其他 skill 直接读对应文件，不必加载本 SKILL.md 全文：

| 文件 | 内容 |
|---|---|
| `references/profile.md` | 项目画像 `profile.json` 各字段含义、填写与更新步骤（`resolve.mjs infer-profile`） |
| `references/templates.md` | 模板来源判定（`resolve.mjs template`）、模板随知识库更新 |
| `references/docnexus.md` | 写入 DocNexus 的分类（`resolve.mjs category`）、按分类参考知识库（`knowledge.mjs`） |
| `references/status.md` | `/workflow status` 的输出格式 |
| `references/codegraph.md` | 用 CodeGraph 代码图谱读代码、查调用链与影响面（MCP 工具与 CLI 对照、图谱看不到的部分） |

`/workflow profile` → 按 `references/profile.md` 执行；`/workflow status` → 按 `references/status.md` 输出；`/workflow report` → 运行 `node <skills>/workflow/scripts/report.mjs [--since YYYY-MM-DD]`，原样给出输出的 Markdown，再用两三句话指出最值得关注的数字（例如修复率低、带未验证项的交付多、从不沉淀），不要编造报告里没有的数据。

## 增强能力探测

所有 skill 用同一套判断；任何一项不可用都**不阻塞主流程**，只是跳过对应增强并在产出中注明。

| 能力 | 判定为可用 | 用途 |
|---|---|---|
| wiki | `md-to-wiki/wiki-config.json` 中 `enabled=true` 且 `wiki.base_url` 非空；或环境存在 wiki MCP 工具 | 读 PRD（各 skill 按 `references/prd-fetch.md`，REST 通道统一调 `md-to-wiki/scripts/upload.mjs get`）、发布文档 |
| DocNexus | 项目根有 `docnexus/project.json`，且 CLI 可执行：`./docnexus/node_modules/.bin/docnexus`（0.17.0 起的装法）或 `./node_modules/.bin/docnexus`（旧装法）；`resolve.mjs status` 的 `docnexus.bin` 给出实际路径，直接调用 CLI 时用它 | 查约定与历史决策、沉淀知识、提供文档模板 |
| 数据库 | `database-query/config.json` 存在且 `connections` 非空 | 查表结构、核对数据 |
| 代码图谱（CodeGraph） | 项目根有 `.codegraph/` 索引，且 `codegraph` 命令可用（`resolve.mjs status` 的 `codegraph.ok`） | 读代码、查调用链与影响面、找受影响的测试；用法见 `references/codegraph.md` |
| 项目画像 | `workflow/profile.json` 中 `main_branch` 与 `build` / `test` 非空 | dev 构建与测试 |

## Rules

- 本 skill 只路由和维护 `profile.json`，不写业务代码；具体工作交给对应 skill，并遵守该 skill 的规则。
- `profile.json` 只记录项目事实，不写密码、token、内网凭据。
- 用户的请求明显只属于某个 skill 时，不要先跑完整链路或状态检查，直接进入那个 skill。
