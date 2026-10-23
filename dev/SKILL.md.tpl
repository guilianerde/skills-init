---
name: dev
description: "Implement a feature or fix a bug in this project end to end: understand the requirement, study existing code, clarify open decisions with the user in rounds, plan at the right size, implement in small verified steps, run tests, have an independent subagent review and write a report, then let the user choose fixes or delivery with config/SQL checklists. Use when the user asks to develop, implement, add, change or fix something in the codebase — including concrete refactors that touch several classes (swap a type such as Date → LocalDateTime, rename, replace an API) followed by running tests — or invokes /dev <需求> or /dev --bug <现象>. Trigger phrases: 帮我开发 / 实现这个需求 / 加个接口 / 改一下这个逻辑 / 把 X 改成 Y / 重构一下 / 改完跑一下测试 / 修这个 bug / 排查并修复 / 线上报错了帮我修 / implement this feature / fix this bug. Not for pure code review (project-review), SQL lookups (database-query) or doc generation (create-tech-md-doc / create-release-md-doc)."
---

# Dev

把一个开发需求或 bug 从「理解」推进到「可交付」。本 skill 负责编排，复用同项目的其他 skill：

| 环节 | 复用 | 不可用时 |
|---|---|---|
| 需求背景 | wiki 中的 PRD（按 `references/prd-fetch.md` 拉取） | 只用对话中的需求描述 |
| 项目约定 / 历史决策 | DocNexus（`docnexus-recall` skill） | 读 `CLAUDE.md` / `AGENTS.md` 与代码 |
| 读代码 / 调用链 / 影响面 | CodeGraph（见 `<skills>/workflow/references/codegraph.md`） | grep / 读文件 |
| 涉及哪些表 / 实际表结构 / 数据核对 | `workflow/scripts/tables.mjs` 定位表 → `database-query`（`query.mjs --schema --tables … --indexes`，只读） | 读 `schema.md` 与 DDL 脚本，注明「未与实际库核对」 |
| 审查 | 优先派独立子 agent 执行 `project-review` 并生成报告（见 F7） | 当前会话按同一清单自查，报告「审查者」写当前 agent |
| 交付文档 | `create-tech-md-doc` / `create-release-md-doc` | 只在对话中汇总 |

## Command Format

```
/dev <需求描述 | PRD pageId/url>          # 功能开发（默认）
/dev --bug <现象 | 报错 | 日志片段>        # 缺陷修复
```

没有斜杠命令时按用户意图判断模式：描述的是「要新增/改变的行为」→ 功能开发；描述的是「现在的行为不对」→ 缺陷修复。

## Step 0 — 前置检查（两种模式共用）

1. **项目画像**：运行 `node <skills>/workflow/scripts/resolve.mjs profile`，读输出的 `profile`、`empty`（空字段列表）与 `toolchain`（开发环境配置，见 `workflow` skill）。本 skill 用到 `main_branch`、`build`、`test`、`test_single`（`{target}` 替换为测试类或文件）、`lint`、`config_center`、`notes`。
   - 需要的字段为空 → 按 `<skills>/workflow/references/profile.md`「填写与更新」的步骤推断，经用户确认后写回；用户不确认就只在本次使用，不落盘。
   - **开发环境配置**：`toolchain.configured` 为 true 时，编译 / 测试按它跑（JDK 用 `java_home`、Maven 用 `maven.settings` / `maven.repository`，写命令时把对应的 `env_vars`（如 `JAVA_HOME`）带上，例如 `JAVA_HOME=<值> <profile.build>`）。构建或测试失败且像是环境问题（找不到 java、依赖下载不下来、版本不对）时，先运行 `node <skills>/workflow/scripts/resolve.mjs env --check`：字段 `exists: false` 或带 `unset_vars` 就是环境没配对，把 `resolved` 和 `current`（本机实际值）一起给用户看，问清楚再继续，**不要自己改画像**。配过但本机对不上时属于个人差异，按 `references/profile.md` 写进 `profile.local.json`。
2. **工作区状态与工作分支**：`git status --short` 与当前分支。
   - 有未提交改动或未跟踪文件 → 列出这些文件，**问用户哪些属于本需求**（例如用户先手写了一部分，让你接着做）；可以和后面的澄清问题一起问。不要替用户 stash / 丢弃。
     - 属于本需求的：和你之后的改动同等对待，影响面、相关测试、审查、交付说明「改动」节都纳入。
     - 不属于的：照常在测试里跑到（测试跑的是整个工作区），但不算本次改动——审查在这些文件里发现的问题写进「范围外发现」，交付说明单独列出，提交时不 add。同一个文件里两边都改了的，告诉用户，审查只按本需求那部分下结论。
   - 当前在主分支（`profile.main_branch`）上 → 建议先建特性分支，用户同意后再建。
3. **需求名**：确定本次工作分支后，运行 `node <skills>/workflow/scripts/requirement.mjs which`。
   - 后续新建或切换分支时，重新运行 `requirement.mjs which`；不要沿用旧分支的 `bound` 结果或自动读到的需求名。用户明确确认继续同一需求时，才将该名字用于新分支。
   - 当前工作分支已绑定 → 直接用，不再问。
   - 本次对话里用户（或 `/workflow` 入口）已经给过名字、只是还没绑定 → 直接用这个名字，不再问。
   - 没绑定 → **现在就问用户这个需求叫什么**（默认值用输出的 `suggested_name`；用户说「按分支名」也行）。**用户给不出名字、或说不清这次要做什么时停在这里，不进入 F1**，已开始的改动保持原样，不替用户猜。名字在第一次落盘时按 Artifact Location bind；S 快速通道只问不 bind、不落盘。
4. **审查方式**：确认当前环境能否派独立子 agent（`resolve.mjs status` 探测不到这个能力）。能派 → F7 用独立子 agent；不能派 → F7 在当前会话按 project-review 自查，报告「审查者」写当前 agent，不阻塞流程。
5. **增强能力探测**：运行 `node <skills>/workflow/scripts/resolve.mjs status`，按输出的 `wiki` / `docnexus` / `database` 判断是否可用（wiki MCP 脚本探测不到，另看当前环境有没有 wiki 工具）。都不阻塞，不可用就跳过对应增强，并在交付说明中注明。
6. **基线**：动代码前运行一次 `profile.build`，再跑和本需求相关的测试（`profile.test_single` 或相关模块，不必全量），记下已经失败的测试和编译错误。之后只对新增的失败负责：已有失败不顺手修，写进交付说明「开工前已有的失败」。跑不了就记「未跑基线」和原因。

## 功能开发流程

### F1 — 理解需求

- 需求来源是 PRD pageId/URL → 按 `references/prd-fetch.md` 拉取并提炼；wiki 不可用 → 请用户贴出关键内容。
- DocNexus 可用 → 先运行 `node <skills>/workflow/scripts/knowledge.mjs dev --match <模块名 / 业务名词> --query "<一句话需求>"`，看以往开发沉淀、技术方案和反复出现的审查问题里有没有相关的（`--query` 在这些分类内按正文 recall）。引用 `workflow-run/docnexus/library/<path>`（见 `<skills>/workflow/references/docnexus.md`「按分类参考知识库」）。
- 先在心里列出初版 **需求要点 + 验收标准**（可验证的行为，而不是实现手段）和还没定的决定，带进 F2 查事实、F3 澄清。

### F2 — 现状调研

- 从入口（Controller / Handler / CLI / 页面）沿调用链读到持久层，理清数据流；不凭文件名猜内容。CodeGraph 可用时（`resolve.mjs status` 的 `codegraph.ok`）先用 `codegraph_explore` / `codegraph explore "<问题>"` 一次拿到链路上的源码和调用路径，再按需补读；Spring 注入、MyBatis XML、MQ、配置 key 这些图谱看不到的照常 grep（见 `<skills>/workflow/references/codegraph.md`）。
- 找到同类功能的既有实现，作为风格与结构的参照（命名、分层、异常、日志、事务、DTO 转换方式）。
- 涉及数据库 → 按 `<skills>/workflow/references/tables.md` 先确定涉及哪些表（`tables.mjs --files <读到的实体 / Mapper>`），数据库已配置时用 `query.mjs --schema --tables <表> --indexes` 只读拉取实际字段、索引与行数；方案里的字段名、类型、索引和 DDL 以查到的为准，不凭实体类推测。

### F3 — 需求澄清

按 `references/clarify.md` 分轮提问：把需求拆成决策树（行为、边界、异常、兼容、权限、数据、范围），**事实自己查**（代码、表结构、PRD、DocNexus），**决定交给用户**；每轮把现在就能问的问题一次问完，编号并给出推荐答案和依据，等用户回答后再问下一轮，直到没有被默默假设的决定。

| 情况 | 做法 |
|---|---|
| S 规模且 F2 后没有未定的决定 | 跳过需求澄清提问，写明本次的理解和假设；规模在 F4 判定并告知用户，不再确认 |
| 只有一两个小决定 | 问一轮即可 |
| M / L 规模，或用户说「拷问一下 / grill me / 先把需求问清楚」 | 按轮问到前沿为空，输出需求要点、验收标准、不在本次范围、已确认的决定，**等用户确认理解一致**再进 F4 |

不要边写代码边问：实现中才发现的新决定，停下来按同样格式问，再继续。

### F4 — 方案（落盘只看是否快速通道，写法按规模）

| 规模 | 判定 | 做法 |
|---|---|---|
| **S** | ≤3 个文件，无接口签名 / 表结构 / 配置项变更，不涉及权限 / 资金 | 符合快速通道条件时先问用户是否走：同意则不落盘、直接在对话里开始实现；不同意或未明确同意则落简版方案（要做什么、改哪些文件、怎么验证，一两行）再实现 |
| **M** | 新增或修改接口、配置项、少量表字段 | 方案落盘简版（要点 + 步骤），**等用户确认后再写代码** |
| **L** | 新模块、跨服务、表结构较大变更、数据迁移 | 按方案模板写完整方案文档落盘（见 Artifact Location），用户确认后再写代码；完成后建议用 `create-tech-md-doc` 生成正式技术方案 |

规模拿不准时按大一级处理。涉及权限（鉴权、角色、数据可见范围）或资金（金额计算、扣款、退款、对账）的改动，文件再少也至少按 M：需求理解（F3）和方案都要用户确认。

**规模判定（S / M / L 都必做，不再询问用户）**：规模由你按上表判定，向用户说明判定的规模与依据（预计改动文件 / 模块、接口 / 数据 / 配置变化及风险）即可，**不询问、不等确认**，直接按该规模推进后续流程；用户主动提出不同意见时，按用户说的规模继续。用户调整范围或实现中发现规模变化时，说明变化依据，按新规模继续。规模判定属于流程选择，不算 F3 的业务决定，不影响 S 规模快速通道资格。

**落盘前绑定需求名**：Step 0 已经问定需求名；确定不走快速通道、第一次要落盘时，按 Artifact Location 运行 `requirement.mjs bind`（已绑定则跳过），之后的方案、审查、交付、技术方案、上线方案都归到这个需求下。S 快速通道不绑定。

**S 规模快速通道（问用户）**：判定为 S 规模，且改动**不涉及**配置项、SQL / DDL、对外接口（HTTP 接口签名、MQ 消息体、对外 DTO）、表结构、权限、资金，也没有 F3 中确认过的业务决定时，**明确询问用户是否走快速通道**：说明走快速通道时 F5～F6 照常（编译、测试都不省），审查按 F7 的快速通道说明在当前会话做，但**不绑定需求、不落任何产物文件**——方案、`review.md`、交付说明都不写（运行反馈仍照常记一行），F8 在对话里一次交付并注明 DocNexus「未询问」。**问完等本轮答复再继续：明确同意才走快速通道；拒绝或答复没有明确同意，就按完整流程落盘交付（F4 方案 → F7 审查 → F8 交付）。** 实现中一旦碰到上面任何一项、改动超过 3 个文件，或用户要求落盘 → 退出快速通道：先停下后续实现，重新评估并说明规模，按 Artifact Location 绑定需求，回到 F4 补写 `plan.md` 并自检（缺陷修复按 B4 追加修复方案）；M / L 等用户确认方案后再继续，S 按简版方案推进。之后回 F5 完成实现、F6 验证、F7 审查并生成 `review.md`，交报告后等待用户选择交付，不从绑定直接跳到审查或交付。快速通道只省落盘与沉淀询问，不省审查。

**方案一律落盘（走快速通道除外）**：S / M / L 都写方案文档，规模只决定详细程度和确认方式。方案模板：在项目根运行 `node <skills>/workflow/scripts/resolve.mjs template dev plan-template.md`，读输出的 `path`；退出码 2（已接入 DocNexus 但缺模板）时停下并按 `hint` 处理。方案落盘后运行 `node <skills>/workflow/scripts/lint-doc.mjs <方案路径> --skill dev` 自检；M / L 等用户确认后再写代码，S 可以在同一轮确认并开始（方案按简版写）。S 先按上面的快速通道问一次：同意则不写方案，不同意或未明确同意才落盘。

### F5 — 实现

- **小步推进**：按逻辑分步实现，一步改完（或改了公共签名、跨了模块）运行 `profile.build`（没有则用对应构建工具的编译命令）确认通过，再进入下一步。不必每改一个文件就编译，代码没变时不重复跑。
- **改动前看影响面**：要改公共方法、接口签名、DTO 字段时，先 `node <skills>/code-graph/scripts/cg.mjs entry <Class.method>`（code-graph skill；退出码 2 时用 grep），把会被波及的入口和调用方纳入本次改动或写进交付说明。
- **贴合现有代码**：沿用参照实现的写法；不顺手重构、不改无关代码、不升级依赖。看到范围外的问题记进交付说明，不在本次修。
- **配置**：新增配置项记入配置清单（key、位置、用途、建议默认值、上线前需下发的环境），按 `profile.config_center` 与审查清单的配置维度处理（清单路径用 `node <skills>/workflow/scripts/resolve.mjs template project-review checklist.md` 取，接入 DocNexus 时是团队维护的版本）。
- **数据库变更**：DDL / 数据修正写成 SQL 脚本放进项目约定的目录（没有约定则放进交付说明），**不在任何环境直接执行**。写之前按 `<skills>/workflow/references/tables.md` 核对实际表结构：要加的列 / 索引是否已存在、新查询条件有没有索引、表有多大（大表 DDL 写进上线注意事项）。
- **敏感信息**：不硬编码密钥、密码、内网地址；日志不打印敏感字段。

### F6 — 验证

- 按验收标准补充或更新单元测试 / 集成测试，测试放在项目既有测试目录、沿用既有测试框架。
- **验收项对应到证据**：F1 / F3 的每条验收标准写明靠哪个测试或手动操作验证、结果如何；没有测试也没法操作的标「未验证」并写原因。交付说明「验证」节的表格按这个填，快速通道在对话里列同样的对应。
- 先跑相关测试（`profile.test_single`，或代码图谱的 `impact` 选出的测试），修到通过；最后跑一次 `profile.test` 全量（之后又改了代码就再跑）。有 `profile.lint` 时一并运行。全量里出现、基线没跑到的失败，先看失败的测试是否碰到本次改动的代码，确认无关的按已有失败记录并写明依据。代码图谱可用时相关测试取自 `node <skills>/code-graph/scripts/cg.mjs impact --base <main_branch>` 输出的 `tests`；`impact` 的 `entry_points`、`sql`、`config_keys` 写进交付说明（受影响的接口 / 消费者 / 定时任务、表、配置）。改动碰到 SQL、实体或 DDL 时运行 `node <skills>/workflow/scripts/tables.mjs --base <main_branch>`，对其中的表再核对一次实际表结构（见 `<skills>/workflow/references/tables.md`），结果写进交付说明的 SQL 节。
- 如实报告结果：失败就给出失败输出并继续修；环境跑不了（缺依赖、缺中间件）就明确写「未验证」以及用户该如何验证。**不得声称未运行的测试已通过。**

### F7 — 审查、报告与用户选择

**S 快速通道不走本节**：在当前会话按 project-review 的标准清单自查，不写方案、不落 `review.md`、不绑定需求、不交报告等选择；审查结论写进 F8 的对话交付。碰到快速通道的退出条件时，再按下面的完整流程走。

- 按 `project-review` skill 审本次改动，用户未指定深度时按 project-review 的「标准」审查。范围用 `node <skills>/workflow/scripts/review-scope.mjs --base <main_branch>`：分支已有的提交、未提交的改动和未跟踪的新文件一起列出。Step 0 确认不属于本需求的文件用 `--exclude <文件,文件>` 排除，它们不计入本次结论（见 Step 0「工作区状态与工作分支」）；之后 project-review 的 `rules`、`locate.mjs` 都带同样的参数。
- **优先由独立子 agent 审查**：派一个未参与本轮实现的子 agent，执行 project-review 的第 1～7 步（含复核和落盘报告）。只交接项目根、skills 路径、分支 / 基线、排除范围、审查深度（默认标准）、需求与验收标准、已确认决定、方案路径、验证命令与结果、上次报告路径；不要传实现者的自审结论或预设问题，让它自己读当前代码判断。审查期间主 agent 不再修改被审代码。子 agent 只审查、写审查产物，不修代码、不生成交付说明、不提交。
- **没有子 agent 时在当前会话审查**：按 project-review 第 1～7 步自己走完并落盘 `review.md`，报告的「审查者」写当前 agent（未派子 agent）；问题表、复核、报告、等用户选择都不省。不要写成独立审查，也不要跳过审查直接进 F8。
- **每轮必须落盘 `review.md`**：按 Artifact Location 先绑定需求，再按 project-review 第 7 步生成报告、运行 lint 和 sync。问题表、影响面、未覆盖项都要保留；没有发现也生成报告。只跳过 project-review 第 8 步沉淀与第 9 步反馈，沉淀和反馈留给 dev F8 统一处理；DocNexus 可用时，报告的元信息固定写「未询问（由 dev 交付统一处理）」，不可用时写「未接入」。F8 只更新交付说明的沉淀状态，不将内部审查报告同步为交付的沉淀结果，避免把一次询问或沉淀重复计数。本轮尚无交付说明，不能把缺少 `delivery.md` 当成漏项；旧交付说明只能作为历史参考，当前需求与验证以本次交接为准。
- **先交报告，再等选择**：主 agent 读取报告，将报告内容与路径交给用户，明确询问「修复报告中的问题，还是按当前结果交付？」并等待本轮明确答复。没有发现时也要等用户选择交付；答复含糊或未答复时留在 F7。此时**不创建、不覆盖 `delivery.md`，不提前进入提交、PR 或沉淀环节**。
  - **修复问题**：按用户选定的问题回到 F5 修复、F6 验证，再由未参与修复的子 agent（没有子 agent 时在当前会话）重新走 F7；复审更新 `review.md`，旧版按产物规则归档，逐条核对「已修复 / 仍存在 / 不再适用」。再次交报告、等待选择，不因已修复就自动交付。用户自己修复后也走 F6 → F7，不能只凭口头说已修复关闭问题。
  - **交付**：确认报告对应当前代码；审查后代码有变动就先回 F6 → F7。仍有已复核的 CRITICAL / HIGH 时，明确建议先修复，说明具体风险并让用户确认是否仍按当前结果交付；不能将一般的「交付」视为接受未说明的严重风险。用户明确接受遗留风险后才进 F8，如实记录遗留问题与未验证项，不得把带问题交付写成「审查通过」或「建议合并」。MEDIUM / LOW 的处理结果也写进交付说明（快速通道写在对话里）。

### F8 — 交付

**完整流程的进入条件**：F7 的审查报告已完成并交给用户（独立子 agent 或当前会话审查均可），且用户明确选择「交付」。修复后仍需完成验证与复审、重新取得交付选择；此前不创建或更新 `delivery.md`。选择交付不等于授权提交、推送、发布或沉淀。S 快速通道不经过这个条件、也不生成报告，见下面的「快速通道交付」。

独立文档仓库中 F7 的报告提交提示延后到本步：完整流程交付完成后运行 `requirement.mjs pending`，按 `<skills>/workflow/references/requirements.md`「文档仓库的提交」询问；不让审查环节提前询问或执行提交。

**快速通道交付**（见 F4「S 规模快速通道」）：一次对话交付，不绑定需求、不落任何产物文件——方案、`review.md`、交付说明都不写，不跑 lint、不问 DocNexus 沉淀（运行反馈仍照常记一行），交付里注明「DocNexus：未询问（快速通道不问沉淀）」。给：结果一句话、改动文件、验证（验收项 → 测试 / 操作 → 结果，构建 / 测试命令与结果，开工前已有的失败，未验证项如实写）、当前会话审查的结论与遗留问题；按完整流程第 4 步记录运行反馈；然后只问提交（建议的 commit message）。用户说「落盘交付说明」或之后要出上线方案时，先绑定需求，回到 F4 补方案、F7 补审查报告（`review.md`），取得交付选择后，才按下面的完整流程生成交付说明、判断沉淀。

完整流程：

1. **落盘交付说明**：模板路径用 `node <skills>/workflow/scripts/resolve.mjs template dev delivery-template.md` 取（退出码 2 时停下并按 `hint` 处理），写到 `requirement.mjs path delivery` 给出的路径（见 Artifact Location）。元信息行的「对比分支」写当前分支和 `profile.main_branch`，`artifacts.mjs`、project-review、上线方案靠它找到这份交付；「参考产物」写最新审查报告，有方案（`plan.md`）时也写方案路径。「审查」节记录报告结论、修复与复审结果、用户选择交付及接受的遗留风险。DocNexus 可用但尚未发起询问时，交付说明的元信息先写「未询问」，再按第 5 步更新；不可用写「未接入」。小改动每节一两行即可，不适用的节写「无」，但验证结果必须如实。
2. **自检**：运行 `node <skills>/workflow/scripts/lint-doc.mjs <交付路径> --skill dev --template delivery-template.md`，有「错误」先修正。
3. **对话里给摘要**：结果、验证（含未验证项）、最新审查报告路径与结论、遗留问题和用户接受的风险、配置 / SQL 有无、交付文件路径；不必把全文贴进对话。
4. **记录运行反馈**（不问用户）：按 `<skills>/workflow/references/feedback.md` 运行 `node <skills>/workflow/scripts/feedback.mjs add --skill dev --model <模型名> --mode <feature|bug> --size <S|M|L> --fast <yes|no> --rounds <提问轮数> --corrections <用户纠正理解的次数> --acceptance <已验证>/<总数> --baseline-failures <n>`，有跳过的步骤、不清楚或做不到的规则、用户的抱怨时再加 `--skipped` / `--unclear` / `--feedback`。只写过程，不写代码和业务名词；报错就提一句，不影响交付。
5. **询问下一步**，不要自行执行：
   - 提交：给出建议的 commit message 和要 add 的文件（只含本需求的改动，Step 0 确认无关的不 add；建议把方案、审查报告和交付说明一起提交，随分支保留），用户同意后再 `git commit`；**不 push**，除非用户明确要求。
   - PR / MR：用户要提 PR / MR 时，运行 `node <skills>/workflow/scripts/pr-desc.mjs`（缺省当前分支、基线 `profile.main_branch`），它把本分支的交付说明、审查报告、技术方案、上线方案汇总成描述（没有交付说明时退回用提交记录和改动文件），把输出给用户；用 `gh pr create` / `glab mr create` 创建要用户明确同意。
   - 文档：运行 `node <skills>/workflow/scripts/artifacts.mjs` 看本分支已有哪些产物（方案、交付说明、审查报告、技术方案、上线方案及 wiki 发布记录），按输出的 `next` 建议下一步：M / L 规模缺技术方案时建议 `create-tech-md-doc`，要上线时建议 `create-release-md-doc`（会自动引用本分支的技术方案和交付说明）。
   - **沉淀到 DocNexus**（`resolve.mjs status` 的 `docnexus.ok` 为 true 时）：先判断本次交付有没有**特别值得记录**的内容——已确认的决定、新约定、踩到的坑、缺陷根因、配置 / 表结构变化；标准是「下次做同类需求时，它能不能少踩一次坑或少做一次决定」，分支、产物路径这类工作流信息不算。
     - 没有 → **不提沉淀**：元信息行写「无需沉淀」，交付摘要里一句话带过（如「只是改了文案，没有值得沉淀的知识」），不追问。
     - 有 → 明确问用户「要不要启动 DocNexus 流程，把本次交付沉淀到 DocNexus？」，并列出建议沉淀的条目；发起询问时将交付说明的元信息改成「未沉淀」，成功入库后再写知识路径，避免将已询问但尚未入库算成「未询问」。
       - 用户同意 → 以交付说明为来源，按 DocNexus 入口 skill `docnexus` 的 capture 流程写入；正文只写知识，不写分支、路径；有 facts 时按 `<skills>/workflow/references/docnexus.md`「沉淀的来源」的格式写 provenance；分类用 `node <skills>/workflow/scripts/resolve.mjs category dev` 的结果作为调用方显式分类封存（见 `<skills>/workflow/references/docnexus.md`「写入 DocNexus 的分类」）。只沉淀确认过的事实，不沉淀「未验证」「待确认」的内容；知识库已有同主题的沉淀时更新那一篇（带 `--base-version`），不重复新建。写入成功后把交付说明的「DocNexus」元信息行改成 `workflow-run/docnexus/library/<path>`，并回报给用户。
       - 用户不同意 → 交付说明的元信息行改成「未沉淀」，不再追问。
     - 未接入 DocNexus（`docnexus.ok` 不为 true）→ 元信息行写「未接入」，不提问、不提示安装。
     - 元信息更新后运行 `requirement.mjs sync <交付路径>`；F7 内部审查报告的「未询问 / 未接入」不随此结论改变。

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

- 修复前按 F4 的标准判定规模并告知用户（规模不询问确认）；S 规模符合快速通道条件时照 F4 问用户是否走快速通道，问完等本轮答复再改代码：明确同意才走快速通道（不落盘），拒绝或未明确同意按完整流程。
- **完整流程先把修复方案追加进 `plan.md`**：按 Artifact Location 运行 `requirement.mjs bind`（未绑定时），再用 `requirement.mjs path plan` 拿路径（已有 `plan.md` 时脚本会先把上一版归档到 `workflow-run/tmp/old-artifacts/`），把根因结论与修复方式写成 `plan.md` 的「修复方案」一节**追加**在原文之后（前面留一个空行与上一节隔开，避免标题被上一行吞掉）——保留已有方案正文、不另建文件；同时将文档头的分支更新为当前修复分支、日期更新为本次日期，不能只在追加的章节里写新分支，否则产物索引仍会归到旧分支。没有 `plan.md` 时按模板建一份，只填适用的节。写完 `requirement.mjs sync <方案路径>` 更新 `meta.json`，运行 `node <skills>/workflow/scripts/lint-doc.mjs <方案路径> --skill dev` 自检，再运行 `artifacts.mjs --branch <当前修复分支>` 确认 `latest.plan` 指向这份方案；M / L 等用户确认修复方式后再改代码，S 可以在同一轮确认并开始。修复中规模变化时说明变化依据，按新规模继续。
- 做能消除根因的**最小改动**；B2 的测试由红变绿，相关已有测试保持通过（运行方式同 F6）。
- 如果历史脏数据需要修正，写成 SQL 脚本交给用户，不直接执行。

### B5 — 审查与交付

同 F7、F8：优先由独立子 agent 审查（没有子 agent 时在当前会话自查）并落盘 `review.md`，交报告后等待用户选择修复或交付；修复后验证、复审，再等选择，完整流程仅在用户选择交付后生成 `delivery.md`（「类型」写缺陷修复）。快速通道同样适用于缺陷修复：S 规模、用户在 B4 已同意走快速通道，不涉及配置 / SQL / 对外接口 / 表结构 / 权限 / 资金，且同类风险排查没有发现其他调用方受影响时，不绑定需求、不落任何产物文件，审查在当前会话做，交付在对话里一次完成并注明「DocNexus：未询问（快速通道不问沉淀）」；根因（证据链、修复方式）必须在对话里写清楚。完整交付时，交付说明的「根因」节必须写：证据链、修复方式、为什么这样修、同类风险排查结果；DocNexus 沉淀时根因是首要候选。

## Rules

- 不执行任何写库操作；不修改 `config.json` / `wiki-config.json` 等凭据文件。
- 不 `git commit` / `git push` / 改写历史 / 删除分支，除非用户在本次对话中明确要求。
- 不安装新依赖；确实需要时说明理由，等用户同意。
- 每个关于现有代码的结论都指向真实文件和行号；读不到的内容如实说明。
- 用户中途改变需求 → 回到 F3，只就变化的部分重新澄清并更新验收标准，再继续。

## Artifact Location

产物按需求归档在 `workflow-run/docs/requirements/<需求名>/<项目名>/`，规则见 `<skills>/workflow/references/requirements.md`：

- **需求名**：Step 0 已运行 `requirement.mjs which` 并问定名字。第一次落盘前运行 `requirement.mjs bind --name "<需求名>"`（用户明确同意按分支名生成时不带 `--name`）；S 快速通道不 bind、不落盘。缺陷修复同样处理（可以选择挂到原需求下）。
- **路径**：交付说明用 `requirement.mjs path delivery`，方案（非快速通道一律落，S / M 写简版）用 `requirement.mjs path plan`，写到输出的 `path`；文件名固定，已有旧版时直接写新版，上一版由脚本归档（输出的 `previous`）。缺陷修复在 B4 把根因与修复方式**追加**到同一个 `plan.md`（不另建文件）。
- 写完运行 `requirement.mjs sync <path>` 更新 `meta.json`；输出里 `archived` 非空（上一版已归档到 `workflow-run/tmp/old-artifacts/`）时告诉用户归档了哪些文件，请用户确认不再需要后自己删除；输出里 `commit` 非空（独立文档仓库模式）时按 `<skills>/workflow/references/requirements.md`「文档仓库的提交」处理。文档里引用其他产物（「参考产物」等）写 `requirement.mjs path` 输出的 `cite`。

## 终端命令

本 skill 给出的 `node …`、`git …` 命令在 bash、zsh、PowerShell 里写法一样，原样运行即可。需要自己写其他终端命令时，先看本机的系统和终端：`node <skills>/workflow/scripts/resolve.mjs env`（安装时记录，一次对话查一次就够；`resolve.mjs profile` / `status` 的输出里也带着 `env`）。按输出的 `os`、`shell`、`note` 写命令，不要再用 `uname`、`$PSVersionTable`、`ver` 之类去探测。
