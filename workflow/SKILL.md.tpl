---
name: workflow
description: "Entry point for this project's dev workflow skills: routes a request to the right skill (dev, project-review, database-query, code-graph, create-tech-md-doc, create-release-md-doc, md-to-wiki, DocNexus), owns the shared project profile (workflow/profile.json) and the wiki / DocNexus / database capability check, and keeps per-requirement artifacts. Use when the user invokes /workflow, asks what the workflow can do, sets up the project profile, checks integrations, wants a PR / MR description from this branch's artifacts, a local report of how well the workflow works, a local page to browse docs per requirement, or to change a doc template, or hands over a multi-stage task. Triggers: 从需求到上线 / 这个需求从头到尾帮我搞定 / skills 配好了吗 / 项目画像 / workflow status / 写 PR 描述 / 提个 PR / 工作流效果怎么样 / workflow report / 看看项目文档 / workflow view / 改模板 / workflow template. When a request clearly belongs to one skill, use that skill directly."
---

# Workflow

本项目个人开发工作流的入口：决定由哪个 skill 处理请求，维护所有 skill 共用的**项目画像**，并统一**增强能力探测**。本 skill 自身不写业务代码。

## Command Format

```
/workflow                 # 根据用户请求路由；无具体请求时输出能力地图 + 状态
/workflow status          # 能力探测报告
/workflow profile         # 填写或更新项目画像
/workflow report          # 本地效果报告（审查发现与修复率、需求澄清、沉淀与复用、各分支链路）
/workflow view            # 项目文档视图：按需求浏览方案、交付、审查、技术 / 上线方案（本地静态页面）
/workflow template [<模板>] [怎么改]   # 修改 / 创建文档模板：tech、release、plan、delivery、review、checklist
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
| 这套工作流效果怎么样、用得怎么样 | `/workflow report` | 只读统计 `workflow-run/docs/requirements/` 下的产物 |
| 看看项目文档、某个需求留下了哪些文档、审查记录 | `/workflow view` | 生成本地静态页面，按需求浏览 |
| 改技术方案 / 上线方案 / 交付说明 / 审查报告的模板，按样例建模板 | `/workflow template` | 草稿 → 校验与影响 → 用户确认后写入 DocNexus（默认模板只读，未接入 DocNexus 时不能改） |
| 记住 / 查找项目决策与约定 | DocNexus（入口 skill `docnexus`） | 需已接入；写入必须用户授权 |

意图明确时直接按对应 skill 执行，不必先输出这张表。目标 skill 没有安装（`resolve.mjs status` 输出的 `skills` 里没有它，安装时用了 `--skills` 子集）→ 告诉用户可以运行 `npx @rowansenne/workflow-run --skills <名称>` 补装，不要假装执行。意图横跨多个阶段时按下面的「完整链路」逐段推进，每段结束告诉用户下一段是什么，由用户决定是否继续。走到哪一步不靠记忆：运行 `node <skills>/workflow/scripts/artifacts.mjs [--branch <分支>]`，它扫描 `workflow-run/docs/requirements/` 下的产物，按元信息行里的分支归组，输出每类最新的一份、wiki 发布记录和 `next`（下一步建议）。

### 完整链路（从需求到上线）

```
dev（需求 → 方案 → 实现 → 测试 → 自审）
  → create-tech-md-doc（M / L 规模）
  → md-to-wiki（发布技术方案，可选）
  → create-release-md-doc（要上线时）
  → md-to-wiki（发布上线方案，可选）
  → DocNexus 沉淀（可选，需授权）
```

开始完整链路时先确定需求名：`node <skills>/workflow/scripts/requirement.mjs which`，当前分支没绑定就问用户这个需求叫什么并 `bind`（见 `references/requirements.md`），之后各段产物都落在 `workflow-run/docs/requirements/<需求名>/<项目名>/`。

提交、推送、发布 wiki、写入 DocNexus 都是对外动作，每一步都要用户明确同意。

## 共用约定（按需读取）

其他 skill 直接读对应文件，不必加载本 SKILL.md 全文：

| 文件 | 内容 |
|---|---|
| `references/profile.md` | 项目画像 `profile.json` 各字段含义（含开发环境配置 `toolchain` / `env_vars`）、填写与更新步骤（`resolve.mjs infer-profile`、`env --check`） |
| `references/templates.md` | 模板来源判定（`resolve.mjs template`）、创建与修改模板（`/workflow template`）、模板随知识库更新 |
| `references/docnexus.md` | 写入 DocNexus 的分类（`resolve.mjs category`）、按分类参考知识库（`knowledge.mjs`） |
| `references/status.md` | `/workflow status` 的输出格式 |
| `references/requirements.md` | 产物按需求归档（`workflow-run/docs/requirements/<需求名>/<项目名>/`）：什么时候问需求名、`requirement.mjs` 绑定分支与给出落盘路径、`meta.json` |
| `references/tables.md` | 确定改动涉及哪些表（`tables.mjs`）、只读拉取实际表结构 / 索引 / 行数核对（`query.mjs --schema --indexes`），没有库连接时怎么退回 |
| `references/codegraph.md` | 用 CodeGraph 代码图谱读代码、查调用链与影响面（MCP 工具与 CLI 对照、图谱看不到的部分） |

`/workflow profile` → 按 `references/profile.md` 执行；`/workflow status` → 按 `references/status.md` 输出；`/workflow report` → 运行 `node <skills>/workflow/scripts/report.mjs [--since YYYY-MM-DD]`，原样给出输出的 Markdown，再用两三句话指出最值得关注的数字（例如修复率低、带未验证项的交付多、从不沉淀），不要编造报告里没有的数据。`/workflow view` → 运行 `node <skills>/workflow/scripts/view.mjs`（用户要直接打开时加 `--open`），把生成的页面路径告诉用户；页面只读、不联网，数据是生成那一刻的快照，产物有更新时重新生成。`/workflow template` → 按 `references/templates.md`「修改模板」一路走完：起草稿、按用户的要求改、校验并说明影响、用户确认后保存并确认生效；没说改哪份模板时先运行 `template.mjs list` 问用户。

## 增强能力探测

所有 skill 用同一套判断；任何一项不可用都**不阻塞主流程**，只是跳过对应增强并在产出中注明。

| 能力 | 判定为可用 | 用途 |
|---|---|---|
| wiki | `md-to-wiki/wiki-config.json` 中 `enabled=true` 且 `wiki.base_url` 非空；或环境存在 wiki MCP 工具 | 读 PRD（各 skill 按 `references/prd-fetch.md`，REST 通道统一调 `md-to-wiki/scripts/upload.mjs get`）、发布文档 |
| DocNexus | `.docnexus/project.json` 为 format 7 且 `output_dir=workflow-run`，CLI 可执行：`.docnexus/node_modules/.bin/docnexus`（`resolve.mjs status` 的 `docnexus.bin`）；命令用 `node <skills>/workflow/scripts/docnexus.mjs <参数>` 运行（`docnexus.run`），见 `references/docnexus.md`「DocNexus 的运行位置」 | 查约定与历史决策、沉淀知识、提供文档模板 |
| 数据库 | `database-query/config.json` 存在且 `connections` 非空 | 查表结构、核对数据 |
| 代码图谱（CodeGraph） | 项目根有 `.codegraph/` 索引，且 `codegraph` 命令可用（`resolve.mjs status` 的 `codegraph.ok`） | 读代码、查调用链与影响面、找受影响的测试；用法见 `references/codegraph.md` |
| 项目画像 | `workflow/profile.json` 中 `main_branch` 与 `build` / `test` 非空 | dev 构建与测试 |
| 开发环境配置 | `profile.json` 的 `toolchain`（可被 `profile.local.json` 覆盖）配了 JDK / Maven / Node 的路径；`resolve.mjs env --check` 逐个核对在本机是否存在 | dev 跑编译与测试（跑不起来时先看它） |

## Rules

- 本 skill 只路由和维护 `profile.json`，不写业务代码；具体工作交给对应 skill，并遵守该 skill 的规则。
- `profile.json` 只记录项目事实（含 `toolchain` 开发环境配置：JDK / Maven / Node 的路径），**不写密码、token、内网凭据**；路径里的变量在 `env_vars` 里声明。
- 写 `toolchain` 前先用 `resolve.mjs env --check` 核对路径在本机存在；本机对不上、又只是个人差异的，写进个人的 `profile.local.json`（覆盖 `profile.json`），不要改团队那份。
- 用户的请求明显只属于某个 skill 时，不要先跑完整链路或状态检查，直接进入那个 skill。

## 终端命令

本 skill 给出的 `node …`、`git …` 命令在 bash、zsh、PowerShell 里写法一样，原样运行即可。构建 / 测试因环境跑不起来（找不到 java、依赖拉不下来）时，用 `node <skills>/workflow/scripts/resolve.mjs env --check` 核对画像里的开发环境配置（`toolchain`）在本机是否存在，把 `resolved` 与 `current` 给用户看。需要自己写其他终端命令时，先看本机的系统和终端：`node <skills>/workflow/scripts/resolve.mjs env`（安装时记录，一次对话查一次就够；`resolve.mjs profile` / `status` 的输出里也带着 `env`）。按输出的 `os`、`shell`、`note` 写命令，不要再用 `uname`、`$PSVersionTable`、`ver` 之类去探测。
