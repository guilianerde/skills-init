---
name: workflow
description: "Entry point for this project's dev workflow skills: routes a request to the right skill (dev, project-review, database-query, code-graph, create-tech-md-doc, create-release-md-doc, md-to-wiki, DocNexus), owns the shared project profile (workflow/profile.json) and the wiki / DocNexus / database capability check, and keeps per-requirement artifacts. Use when the user invokes /workflow, asks what the workflow can do, sets up the project profile, checks integrations, wants a PR / MR description from this branch's artifacts, a local report of how well the workflow works, a local page to browse docs per requirement, or to change a doc template, or hands over a multi-stage task. Triggers: 从需求到上线 / 这个需求从头到尾帮我搞定 / skills 配好了吗 / 项目画像 / workflow status / 写 PR 描述 / 提个 PR / 工作流效果怎么样 / workflow report / 看看项目文档 / workflow view / 改模板 / workflow template. When a request clearly belongs to one skill, use that skill directly."
---

# Workflow

**开工能力**：先运行 `node <skills>/workflow/scripts/resolve.mjs status`，按 `<skills>/workflow/references/capabilities.md` 选择本轮能力与模板；同一项目链路复用已有快照，失败统一按该规则处理。

本项目个人开发工作流的入口：决定由哪个 skill 处理请求，维护所有 skill 共用的**项目画像**，并统一**增强能力探测**。本 skill 自身不写业务代码。

## Command Format

```
/workflow                 # 根据用户请求路由；无具体请求时输出能力地图 + 状态
/workflow status          # 能力探测 + 当前分支运行进度（含已完成）
/workflow resume [<运行id>] # 读取 meta.json 中的状态，核对后续接
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
| 继续上次任务、恢复中断的流程 | `/workflow resume` | 先读运行状态和上下文，等待中的决定不能自动跳过 |
| 这套工作流效果怎么样、用得怎么样 | `/workflow report` | 只读统计 `workflow-run/docs/requirements/` 下的产物 |
| 看看项目文档、某个需求留下了哪些文档、审查记录 | `/workflow view` | 生成本地静态页面，按需求浏览 |
| 改技术方案 / 上线方案 / 交付说明 / 审查报告的模板，按样例建模板 | `/workflow template` | 草稿 → 校验与影响 → 用户确认后写入 DocNexus（知识库是模板唯一来源） |
| 记住 / 查找项目决策与约定 | DocNexus（入口 skill `docnexus`） | 需已接入；写入必须用户授权 |

意图明确时直接按对应 skill 执行，不必先输出这张表。目标 skill 没有安装（`resolve.mjs status` 输出的 `skills` 里没有它，安装时用了 `--skills` 子集）→ 告诉用户可以运行 `npx @rowansenne/workflow-run --skills <名称>` 补装，不要假装执行。意图横跨多个阶段时按下面的「完整链路」逐段推进，每段结束告诉用户下一段是什么，由用户决定是否继续。走到哪一步不靠记忆：运行 `node <skills>/workflow/scripts/artifacts.mjs [--branch <分支>]`，它扫描 `workflow-run/docs/requirements/` 下的产物，按元信息行里的分支归组，输出每类最新的一份、wiki 发布记录和 `next`（下一步建议）。

### 完整链路（从需求到上线）

```
dev（确定工作分支 → 定需求名 → 理解需求 → 方案 → 实现 → 测试 → 优先独立子 agent 审查并落盘报告，无则在当前会话自查 → 用户选择修复或交付）
  ↳ 修复：实现 → 验证 → 复审（无子 agent 时当前会话）→ 再次选择；交付：完整流程生成 delivery.md，S 快速通道只在对话交付、不落盘
  → create-tech-md-doc（M / L 规模）
  → md-to-wiki（发布技术方案，可选）
  → create-release-md-doc（要上线时）
  → md-to-wiki（发布上线方案，可选）
  → DocNexus 沉淀（可选，需授权）
```

开始完整链路时，先进入 dev 的 Step 0 确定本次工作分支，再运行 `node <skills>/workflow/scripts/requirement.mjs which` 确认需求名（见 `references/requirements.md`）。入口只转交用户明确给出或确认的名字，不把切换前从旧分支自动读到的名字当成用户已确认的需求名。**这里只问、不 bind**，等第一次真的要落盘产物时再由对应 skill `bind`。这样从入口进来也可以走 S 快速通道，不会提前创建需求目录和 `meta.json`。

提交、推送、发布 wiki、写入 DocNexus 都是对外动作，每一步都要用户明确同意。

## 共用约定（按需读取）

其他 skill 直接读对应文件，不必加载本 SKILL.md 全文：

| 文件 | 内容 |
|---|---|
| `references/profile.md` | 项目画像 `profile.json` 各字段含义（含开发环境配置 `toolchain` / `env_vars`）、填写与更新步骤（`resolve.mjs infer-profile`、`env --check`） |
| `references/templates.md` | 模板来源判定（`resolve.mjs template`）、创建与修改模板（`/workflow template`）、模板随知识库更新 |
| `references/docnexus.md` | 写入 DocNexus 的分类（`resolve.mjs category`）、按分类参考知识库（`knowledge.mjs`） |
| `references/capabilities.md` | 开工快照、必装组件门槛、可选增强通道与统一失败处理 |
| `references/status.md` | `/workflow status` 的输出格式 |
| `references/runs.md` | 完整流程在 meta.json 中的运行状态、步骤完成标记、保存与恢复、运行完成时间 |
| `references/requirements.md` | 产物按需求归档（`workflow-run/docs/requirements/<需求名>/<项目名>/`）：什么时候问需求名、`requirement.mjs` 绑定分支与给出落盘路径、`meta.json` |
| `references/tables.md` | 确定改动涉及哪些表（`tables.mjs`）、只读拉取实际表结构 / 索引 / 行数核对（`query.mjs --schema --indexes`），没有库连接时怎么退回 |
| `references/codegraph.md` | 用 CodeGraph 代码图谱读代码、查调用链与影响面（MCP 工具与 CLI 对照、图谱看不到的部分） |

`/workflow resume` → 按 `references/runs.md`「新会话恢复」读取 `run.mjs show [--id <运行id>]`，先核对项目根、分支、代码和证据，再进入对应 skill 的保存阶段；已完成运行只展示完成标记与时间，不能自动重启。`/workflow profile` → 按 `references/profile.md` 执行；`/workflow status` → 按 `references/status.md` 输出；`/workflow report` → 运行 `node <skills>/workflow/scripts/report.mjs [--since YYYY-MM-DD]`，原样给出输出的 Markdown，再用两三句话指出最值得关注的数字（例如修复率低、带未验证项的交付多、从不沉淀），不要编造报告里没有的数据。`/workflow view` → 运行 `node <skills>/workflow/scripts/view.mjs`（用户要直接打开时加 `--open`），把生成的页面路径告诉用户；页面只读、不联网，数据是生成那一刻的快照，产物有更新时重新生成。`/workflow template` → 按 `references/templates.md`「修改模板」一路走完：起草稿、按用户的要求改、校验并说明影响、用户确认后保存并确认生效；没说改哪份模板时先运行 `template.mjs list` 问用户。

## 增强能力探测

能力探测与选择统一由 `resolve.mjs status` 和 `references/capabilities.md` 负责。DocNexus 是必装组件；开工检查不通过时先修复。CodeGraph、wiki、数据库作为可选增强，按本轮能力快照选择通道，不在各步骤重复探测或复制降级规则。模板只从 DocNexus 读取，缺失处理见 `references/templates.md`。

## Rules

- 普通聊天生成的报告、分析、方案、草稿或导出等辅助文件默认放在项目根的 `workflow-run/other/`，不因分支已绑定需求而写入需求目录，也不调用需求归档或运行状态命令。工作流正式产物仍按 `references/requirements.md` 归档；源码、测试、配置和已有文件的维护、工作流指定的临时文件与知识库沿用各自目录，用户明确指定路径时以用户为准。
- 本 skill 只路由和维护 `profile.json`，不写业务代码；具体工作交给对应 skill，并遵守该 skill 的规则。
- `profile.json` 只记录项目事实（含 `toolchain` 开发环境配置：JDK / Maven / Node 的路径），**不写密码、token、内网凭据**；路径里的变量在 `env_vars` 里声明。
- 写 `toolchain` 前先用 `resolve.mjs env --check` 核对路径在本机存在；本机对不上、又只是个人差异的，写进个人的 `profile.local.json`（覆盖 `profile.json`），不要改团队那份。
- 用户的请求明显只属于某个 skill 时，直接进入对应 skill，并复用本轮开工能力快照。

## 终端命令

本 skill 给出的 `node …`、`git …` 命令在 bash、zsh、PowerShell 里写法一样，原样运行即可。构建 / 测试因环境跑不起来（找不到 java、依赖拉不下来）时，用 `node <skills>/workflow/scripts/resolve.mjs env --check` 核对画像里的开发环境配置（`toolchain`）在本机是否存在，把 `resolved` 与 `current` 给用户看。需要自己写其他终端命令时，先看本机的系统和终端：`node <skills>/workflow/scripts/resolve.mjs env`（安装时记录，一次对话查一次就够；`resolve.mjs profile` / `status` 的输出里也带着 `env`）。按输出的 `os`、`shell`、`note` 写命令，不要再用 `uname`、`$PSVersionTable`、`ver` 之类去探测。
