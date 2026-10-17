---
name: dev
description: "Implement a feature or fix a bug in this project end to end: understand the requirement, study existing code, clarify open decisions with the user in rounds, plan at the right size, implement in small verified steps, run tests, self-review the diff with project-review, and deliver a summary with config/SQL checklists. Use when the user asks to develop, implement, add, change or fix something in the codebase — including concrete refactors that touch several classes (swap a type such as Date → LocalDateTime, rename, replace an API) followed by running tests — or invokes /dev <需求> or /dev --bug <现象>. Trigger phrases: 帮我开发 / 实现这个需求 / 加个接口 / 改一下这个逻辑 / 把 X 改成 Y / 重构一下 / 改完跑一下测试 / 修这个 bug / 排查并修复 / 线上报错了帮我修 / implement this feature / fix this bug. Not for pure code review (project-review), SQL lookups (database-query) or doc generation (create-tech-md-doc / create-release-md-doc)."
---

# Dev

把一个开发需求或 bug 从「理解」推进到「可交付」。本 skill 负责编排，复用同项目的其他 skill：

| 环节 | 复用 | 不可用时 |
|---|---|---|
| 需求背景 | wiki 中的 PRD（按 `references/prd-fetch.md` 拉取） | 只用对话中的需求描述 |
| 项目约定 / 历史决策 | DocNexus（`docnexus-recall` skill） | 读 `CLAUDE.md` / `AGENTS.md` 与代码 |
| 读代码 / 调用链 / 影响面 | CodeGraph（见 `<skills>/workflow/references/codegraph.md`） | grep / 读文件 |
| 涉及哪些表 / 实际表结构 / 数据核对 | `workflow/scripts/tables.mjs` 定位表 → `database-query`（`query.mjs --schema --tables … --indexes`，只读） | 读 `schema.md` 与 DDL 脚本，注明「未与实际库核对」 |
| 自审 | `project-review` | 按审查清单手动过（`node <skills>/workflow/scripts/resolve.mjs template project-review checklist.md` 给出路径） |
| 交付文档 | `create-tech-md-doc` / `create-release-md-doc` | 只在对话中汇总 |

## Command Format

```
/dev <需求描述 | PRD pageId/url>          # 功能开发（默认）
/dev --bug <现象 | 报错 | 日志片段>        # 缺陷修复
```

没有斜杠命令时按用户意图判断模式：描述的是「要新增/改变的行为」→ 功能开发；描述的是「现在的行为不对」→ 缺陷修复。

## Step 0 — 前置检查（两种模式共用）

1. **项目画像**：运行 `node <skills>/workflow/scripts/resolve.mjs profile`，读输出的 `profile` 与 `empty`（空字段列表；字段含义见 `workflow` skill）。本 skill 用到 `main_branch`、`build`、`test`、`test_single`（`{target}` 替换为测试类或文件）、`lint`、`config_center`、`notes`。
   - 需要的字段为空 → 按 `<skills>/workflow/references/profile.md`「填写与更新」的步骤推断，经用户确认后写回；用户不确认就只在本次使用，不落盘。
2. **工作区状态**：`git status --short` 与当前分支。
   - 有与本需求无关的未提交改动 → 告知用户，不要混进本次改动，也不要替用户 stash / 丢弃。
   - 当前在主分支（`profile.main_branch`）上 → 建议先建特性分支，用户同意后再建。
3. **增强能力探测**：运行 `node <skills>/workflow/scripts/resolve.mjs status`，按输出的 `wiki` / `docnexus` / `database` 判断是否可用（wiki MCP 脚本探测不到，另看当前环境有没有 wiki 工具）。都不阻塞，不可用就跳过对应增强，并在交付说明中注明。

## 功能开发流程

### F1 — 理解需求

- 需求来源是 PRD pageId/URL → 按 `references/prd-fetch.md` 拉取并提炼；wiki 不可用 → 请用户贴出关键内容。
- DocNexus 可用 → 先运行 `node <skills>/workflow/scripts/knowledge.mjs dev --match <模块名 / 业务名词> --query "<一句话需求>"`，看以往开发沉淀、技术方案和反复出现的审查问题里有没有相关的（`--query` 在这些分类内按正文 recall；输出 `recall_by_category: false` 时改按 `docnexus-recall` 做不带分类的 recall）。引用 `docnexus/library/<path>`（见 `<skills>/workflow/references/docnexus.md`「按分类参考知识库」）。
- 先在心里列出初版 **需求要点 + 验收标准**（可验证的行为，而不是实现手段）和还没定的决定，带进 F2 查事实、F3 澄清。

### F2 — 现状调研

- 从入口（Controller / Handler / CLI / 页面）沿调用链读到持久层，理清数据流；不凭文件名猜内容。CodeGraph 可用时（`resolve.mjs status` 的 `codegraph.ok`）先用 `codegraph_explore` / `codegraph explore "<问题>"` 一次拿到链路上的源码和调用路径，再按需补读；Spring 注入、MyBatis XML、MQ、配置 key 这些图谱看不到的照常 grep（见 `<skills>/workflow/references/codegraph.md`）。
- 找到同类功能的既有实现，作为风格与结构的参照（命名、分层、异常、日志、事务、DTO 转换方式）。
- 涉及数据库 → 按 `<skills>/workflow/references/tables.md` 先确定涉及哪些表（`tables.mjs --files <读到的实体 / Mapper>`），数据库已配置时用 `query.mjs --schema --tables <表> --indexes` 只读拉取实际字段、索引与行数；方案里的字段名、类型、索引和 DDL 以查到的为准，不凭实体类推测。

### F3 — 需求澄清

按 `references/clarify.md` 分轮提问：把需求拆成决策树（行为、边界、异常、兼容、权限、数据、范围），**事实自己查**（代码、表结构、PRD、DocNexus），**决定交给用户**；每轮把现在就能问的问题一次问完，编号并给出推荐答案和依据，等用户回答后再问下一轮，直到没有被默默假设的决定。

| 情况 | 做法 |
|---|---|
| S 规模且 F2 后没有未定的决定 | 跳过提问，在开工前用一两句话写明本次的理解和假设 |
| 只有一两个小决定 | 问一轮即可 |
| M / L 规模，或用户说「拷问一下 / grill me / 先把需求问清楚」 | 按轮问到前沿为空，输出需求要点、验收标准、不在本次范围、已确认的决定，**等用户确认理解一致**再进 F4 |

不要边写代码边问：实现中才发现的新决定，停下来按同样格式问，再继续。

### F4 — 方案（按规模分级）

| 规模 | 判定 | 做法 |
|---|---|---|
| **S** | ≤3 个文件，无接口签名 / 表结构 / 配置项变更 | 在对话中列改动步骤，直接开始 |
| **M** | 新增或修改接口、配置项、少量表字段 | 在对话中给出简要方案（方案模板的精简版），**等用户确认后再写代码** |
| **L** | 新模块、跨服务、表结构较大变更、数据迁移 | 按方案模板写方案文档落盘（见 Artifact Location），用户确认后再写代码；完成后建议用 `create-tech-md-doc` 生成正式技术方案 |

规模拿不准时按大一级处理。

**M / L 规模先定需求名**：规模定下来、确定要落盘时，按 Artifact Location 运行 `requirement.mjs which`，当前分支没绑定需求就在这一轮问用户这个需求叫什么（可以和澄清问题一起问），之后的方案、交付、审查、技术方案、上线方案都归到这个需求下。

**S 规模快速通道**：S 规模，且改动**不涉及**配置项、SQL / DDL、对外接口（HTTP 接口签名、MQ 消息体、对外 DTO）、表结构，也没有 F3 中确认过的决定 → 走快速通道：F5～F7 照常（编译、测试、自审都不省），F8 只在对话里交付，不落盘交付说明、不问 DocNexus 沉淀（见 F8「快速通道交付」）。开工时用一句话告诉用户「按快速通道处理，不落盘交付说明」。实现中一旦碰到上面任何一项、改动超过 3 个文件，或用户要求落盘 → 退出快速通道，按完整 F8 交付。小改动也要走完整流程是用户绕开 dev 的主要原因，所以只在上面这些会影响上线和团队的情况下才落盘。

方案模板：在项目根运行 `node <skills>/workflow/scripts/resolve.mjs template dev plan-template.md`，读输出的 `path`；退出码 2（已接入 DocNexus 但缺模板）时停下并按 `hint` 处理。L 规模的方案文档落盘后运行 `node <skills>/workflow/scripts/lint-doc.mjs <方案路径> --skill dev` 自检，再请用户确认。

### F5 — 实现

- **小步推进**：每完成一个可编译的单元，就运行 `profile.build`（没有则用对应构建工具的编译命令）确认通过，再进入下一步。
- **改动前看影响面**：要改公共方法、接口签名、DTO 字段时，先 `node <skills>/code-graph/scripts/cg.mjs entry <Class.method>`（code-graph skill；退出码 2 时用 grep），把会被波及的入口和调用方纳入本次改动或写进交付说明。
- **贴合现有代码**：沿用参照实现的写法；不顺手重构、不改无关代码、不升级依赖。看到范围外的问题记进交付说明，不在本次修。
- **配置**：新增配置项记入配置清单（key、位置、用途、建议默认值、上线前需下发的环境），按 `profile.config_center` 与审查清单的配置维度处理（清单路径用 `node <skills>/workflow/scripts/resolve.mjs template project-review checklist.md` 取，接入 DocNexus 时是团队维护的版本）。
- **数据库变更**：DDL / 数据修正写成 SQL 脚本放进项目约定的目录（没有约定则放进交付说明），**不在任何环境直接执行**。写之前按 `<skills>/workflow/references/tables.md` 核对实际表结构：要加的列 / 索引是否已存在、新查询条件有没有索引、表有多大（大表 DDL 写进上线注意事项）。
- **敏感信息**：不硬编码密钥、密码、内网地址；日志不打印敏感字段。

### F6 — 验证

- 按验收标准补充或更新单元测试 / 集成测试，测试放在项目既有测试目录、沿用既有测试框架。
- 运行 `profile.test`（或只跑相关测试的 `profile.test_single`）。有 `profile.lint` 时一并运行。代码图谱可用时先跑 `node <skills>/code-graph/scripts/cg.mjs impact --base <main_branch>` 输出的 `tests`，再跑全量；`impact` 的 `entry_points`、`sql`、`config_keys` 写进交付说明（受影响的接口 / 消费者 / 定时任务、表、配置）。改动碰到 SQL、实体或 DDL 时运行 `node <skills>/workflow/scripts/tables.mjs --base <main_branch>`，对其中的表再核对一次实际表结构（见 `<skills>/workflow/references/tables.md`），结果写进交付说明的 SQL 节。
- 如实报告结果：失败就给出失败输出并继续修；环境跑不了（缺依赖、缺中间件）就明确写「未验证」以及用户该如何验证。**不得声称未运行的测试已通过。**

### F7 — 自审

- 按 `project-review` skill 审本次改动：分支已有提交时用 `git diff <main_branch>...HEAD`，再加上 `git diff HEAD` 的未提交部分。
- CRITICAL / HIGH 必须修掉后重新跑 F6；MEDIUM / LOW 修掉或写进交付说明。
- 自审结论放进交付说明即可，不单独落盘审查报告（用户要求时再按 project-review 的产物规范落盘）。

### F8 — 交付

**快速通道交付**（见 F4「S 规模快速通道」）：不落盘、不跑 lint、不问 DocNexus 沉淀。对话里给：结果一句话、改动文件、验证（构建 / 测试命令与结果，未验证项如实写）、自审结论；然后只问提交（建议的 commit message）。用户说「落盘交付说明」或之后要出上线方案时，再按下面的完整流程补落盘。

完整流程：

1. **落盘交付说明**：模板路径用 `node <skills>/workflow/scripts/resolve.mjs template dev delivery-template.md` 取（退出码 2 时停下并按 `hint` 处理），写到 `requirement.mjs path delivery` 给出的路径（见 Artifact Location）。元信息行的「对比分支」写当前分支和 `profile.main_branch`，`artifacts.mjs`、project-review、上线方案靠它找到这份交付；有开发方案时「参考产物」写方案路径。小改动每节一两行即可，不适用的节写「无」，但验证结果必须如实。
2. **自检**：运行 `node <skills>/workflow/scripts/lint-doc.mjs <交付路径> --skill dev --template delivery-template.md`，有「错误」先修正。
3. **对话里给摘要**：结果、验证（含未验证项）、配置 / SQL 有无、交付文件路径；不必把全文贴进对话。
4. **询问下一步**，不要自行执行：
   - 提交：给出建议的 commit message（建议把交付说明一起提交，随分支保留），用户同意后再 `git commit`；**不 push**，除非用户明确要求。
   - PR / MR：用户要提 PR / MR 时，运行 `node <skills>/workflow/scripts/pr-desc.mjs`（缺省当前分支、基线 `profile.main_branch`），它把本分支的交付说明、审查报告、技术方案、上线方案汇总成描述（没有交付说明时退回用提交记录和改动文件），把输出给用户；用 `gh pr create` / `glab mr create` 创建要用户明确同意。
   - 文档：运行 `node <skills>/workflow/scripts/artifacts.mjs` 看本分支已有哪些产物（开发方案、交付说明、审查报告、技术方案、上线方案及 wiki 发布记录），按输出的 `next` 建议下一步：M / L 规模缺技术方案时建议 `create-tech-md-doc`，要上线时建议 `create-release-md-doc`（会自动引用本分支的技术方案和交付说明）。
   - **沉淀到 DocNexus**（`resolve.mjs status` 的 `docnexus.ok` 为 true 时**每次都问**）：明确问用户「要不要启动 DocNexus 流程，把本次交付沉淀到 DocNexus？」，并从交付说明里列出建议沉淀的内容（已确认的决定、新约定、踩到的坑、缺陷根因、配置 / 表结构变化）；没有特别值得记的也照问，并说明这一点。
     - 用户同意 → 以交付说明为来源，按 DocNexus 入口 skill `docnexus` 的 capture 流程写入；正文只写知识，不写分支、路径；有 facts 时按 `<skills>/workflow/references/docnexus.md`「沉淀的来源」的格式写 provenance；分类用 `node <skills>/workflow/scripts/resolve.mjs category dev` 的结果作为调用方显式分类封存（见 `<skills>/workflow/references/docnexus.md`「写入 DocNexus 的分类」）。只沉淀确认过的事实，不沉淀「未验证」「待确认」的内容；知识库已有同主题的沉淀时更新那一篇（带 `--base-version`），不重复新建。写入成功后把交付说明的「DocNexus」元信息行改成 `docnexus/library/<path>`，并回报给用户。
     - 用户不同意 → 元信息行保持「未沉淀」，不再追问。
     - 未接入 DocNexus → 元信息行写「未接入」，不提问、不提示安装。

## 缺陷修复流程（`--bug`）

### B1 — 收集现象

整理：现象、期望行为、触发条件、影响范围、首次出现时间、相关日志 / 报错 / 数据。信息不足以复现时，列出缺的信息问用户：只问只有用户知道的（日志、发生时间、操作步骤、受影响的用户），代码和数据能查到的自己查；格式同 `references/clarify.md`。

### B2 — 复现

- 优先写一个**能稳定失败的测试**来复现；写不出测试时给出可执行的复现步骤（请求、参数、数据）。
- 涉及数据问题 → 用 `database-query` 只读查询核对现场数据，敏感字段脱敏。
- 复现不了 → 停下来说明尝试过什么，不要在没复现的情况下猜着改。

### B3 — 定位根因

- 沿调用链找到**第一个**出错的位置，用证据（代码行、日志、数据、git 历史 `git log -L` / `git blame`）说明为什么错。
- 区分根因与症状：只在出错表象处加判空 / try-catch 不算修复，除非能说明那里就是根因。
- 检查同一根因是否在其他调用方同样存在。

### B4 — 修复与验证

- 做能消除根因的**最小改动**；B2 的测试由红变绿，相关已有测试保持通过（运行方式同 F6）。
- 如果历史脏数据需要修正，写成 SQL 脚本交给用户，不直接执行。

### B5 — 自审与交付

同 F7、F8（交付说明同样落盘，「类型」写缺陷修复）。快速通道同样适用于缺陷修复：S 规模、不涉及配置 / SQL / 对外接口 / 表结构，且同类风险排查没有发现其他调用方受影响时，在对话里交付，但根因（证据链、修复方式）必须在对话里写清楚。交付说明的「根因」节必须写：证据链、修复方式、为什么这样修、同类风险排查结果；DocNexus 沉淀时根因是首要候选。

## Rules

- 不执行任何写库操作；不修改 `config.json` / `wiki-config.json` 等凭据文件。
- 不 `git commit` / `git push` / 改写历史 / 删除分支，除非用户在本次对话中明确要求。
- 不安装新依赖；确实需要时说明理由，等用户同意。
- 每个关于现有代码的结论都指向真实文件和行号；读不到的内容如实说明。
- 用户中途改变需求 → 回到 F3，只就变化的部分重新澄清并更新验收标准，再继续。

## Artifact Location

产物按需求归档在 `skills-init/docs/requirements/<需求名>/`，规则见 `<skills>/workflow/references/requirements.md`：

- **需求名**：确定规模为 M / L（要落盘）时，先运行 `node <skills>/workflow/scripts/requirement.mjs which`；当前分支还没绑定需求就问用户这个需求叫什么（默认值用输出的 `suggested_name`），再 `requirement.mjs bind --name "<需求名>"`；用户不给名字时 `bind` 按分支名生成。S 规模快速通道不落盘，不问。缺陷修复同样处理（可以选择挂到原需求下）。
- **路径**：交付说明用 `requirement.mjs path delivery`，L 规模方案（或用户要求落盘的 M 规模方案）用 `requirement.mjs path plan`，写到输出的 `path`；已有旧版时自动给出 `_v2`、`_v3`，不覆盖。
- 写完运行 `requirement.mjs sync <path>` 更新 `meta.json`；输出里 `commit` 非空（独立文档仓库模式）时按 `<skills>/workflow/references/requirements.md`「文档仓库的提交」处理。文档里引用其他产物（「参考产物」等）写 `requirement.mjs path` 输出的 `cite`。

## 终端命令

本 skill 给出的 `node …`、`git …` 命令在 bash、zsh、PowerShell 里写法一样，原样运行即可。需要自己写其他终端命令时，先看本机的系统和终端：`node <skills>/workflow/scripts/resolve.mjs env`（安装时记录，一次对话查一次就够；`resolve.mjs profile` / `status` 的输出里也带着 `env`）。按输出的 `os`、`shell`、`note` 写命令，不要再用 `uname`、`$PSVersionTable`、`ver` 之类去探测。
