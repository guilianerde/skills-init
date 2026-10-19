---
name: project-review
description: "Review source code (any language; Java/Spring, Go, TypeScript, Python, etc.) for bugs, correctness, missing fields, null-safety, concurrency, exception handling, resource leaks and security issues (style only when asked). Use when the user asks to review code, review a branch/PR/MR against another branch (e.g. compare `main`), check a class/method/entity for missing fields or bugs, compare two classes to see whether a converter/mapper (DTO ↔ VO ↔ Entity, BeanUtils/MapStruct) drops or mismaps fields, verify changes before merge, or wants a structured code audit with an actionable findings report. Trigger phrases: 帮我审代码 / 审这个分支 / 这个类这段代码有没有问题 / 还缺哪些字段 / 是不是漏字段了 / 对照一下两个类 / 转换方法漏没漏字段 / review this branch / compare with main / code review / 影响面分析. Reports findings only and does not change code unless asked. Not for implementing or fixing (dev), reviewing the wording of a document, or generating tech/release docs."
---

# Code Review

## Workflow

1. **确定审查范围与深度**：范围是单文件 / 单方法、分支对比（如 `branch` vs `main`），还是未提交改动（见 `references/diff-strategy.md`「未提交改动」）。分支对比和未提交改动都先运行 `node <skills>/workflow/scripts/review-scope.mjs --diff <基线>...<dev>`（未提交改动用 `--base <基线>`，含未跟踪的新文件；dev 自审时加 dev 传来的 `--exclude`），**审哪些文件以它的 `review` 为准**：`skipped` 是按规则跳过的（删除、二进制、敏感文件、依赖目录、生成文件、文档、本工具的产物，各带原因），不要自己再增减；确实要审被跳过的，在画像 `review.include` 里加（见 `<skills>/workflow/references/profile.md`）。深度按用户的说法定，没说就用「标准」，写进报告「审查方式」：
   - **快审**（「快速看一下」「扫一眼」）：只查正确性、空值、安全、事务与幂等，不查性能、测试、风格；「优化建议（LOW）」写「无」。CRITICAL / HIGH 照样复核。
   - **标准**（默认）：检查清单全部维度，**风格类（清单「一致性 / 风格」一节）不查**；「优化建议（LOW）」只写有实际收益的（性能、可维护性上的具体问题），没有就写「无」。
   - **深审**（「仔细审」「全面审」，或资金 / 权限 / 对外接口的大改动合并前）：全部维度，包括风格；MEDIUM 也复核。
2. **建立理解**：先读实体、接口、DTO、调用链，理清数据流再下结论；不要凭文件名猜内容。
   - **可选：查项目约定（DocNexus）**：DocNexus 可用时（`resolve.mjs status` 的 `docnexus.ok`），先运行 `node <skills>/workflow/scripts/knowledge.mjs project-review --match <模块名 / 业务名词> --query "<一句话：改动涉及的模块与业务>"`，看以往审查沉淀的反复问题和开发约定（`--query` 在这些分类内按正文 recall；输出 `recall_by_category: false` 时改按 `docnexus-recall` 做不带分类的 recall），找相关的编码约定、历史决策与已知坑，作为审查依据并在报告中引用 `docnexus/library/<path>`。未检测到或查询失败就跳过，并在「未覆盖与待确认」中注明；审查过程中**不写入** DocNexus（写入见第 8 步）。
   - **同分支已有产物**：运行 `node <skills>/workflow/scripts/artifacts.mjs --branch <dev分支>`（单文件 / 未提交改动用当前分支，省略 `--branch`），看输出的 `latest`：
     - `latest.plan` 或 `latest.tech` 存在 → 读其中的验收标准、改动设计、接口 / 数据 / 配置变更，第 3 步审 diff 时做**需求对照**：方案里有、diff 里找不到的 → 漏实现（属于验收标准的按 HIGH，其余 MEDIUM）；diff 里有、方案里没提的接口 / 表结构 / 配置 / 依赖变更 → 列出请作者确认（不一定是问题）。只对照能在 diff 里核对的项，不推测业务语义。
     - `latest.delivery` 存在（dev 的交付说明）→ 其中「已确认的决定」并入需求对照的依据；「配置清单」「SQL 脚本」和 diff 对照，diff 里有而交付说明漏列的配置 key / DDL 记为 MEDIUM（上线时会被漏掉）。
     - `latest.review` 存在 → 这是**复审**：读上次报告的问题表，并用 `git log --oneline --since=<上次报告日期> <dev分支>` 看之后改了什么。本次报告对上次的每条问题标「已修复 / 仍存在 / 不再适用」（「已修复」要看到对应改动），本次新发现的标「新增」。
   - **涉及数据库**：diff 里有 SQL、Mapper、实体或 DDL 时，按 `<skills>/workflow/references/tables.md` 运行 `node <skills>/workflow/scripts/tables.mjs --diff <基线>...<dev>`（未提交改动用 `--base <基线>`）找出涉及的表；数据库已配置（`resolve.mjs status` 的 `database.ok`）时用 `query.mjs --schema --tables <表> --indexes` 只读拉取实际字段、索引与估算行数，作为第 4、6 步判断索引支撑、字段存在与类型、DDL 锁表与滚动发布兼容的依据。查不了库时注明「未与实际库核对」写进「未覆盖与待确认」，这类发现不升到 HIGH 以上，除非 diff 本身就能证明。
3. **分支对比**：基线默认取 `workflow/profile.json` 的 `main_branch`（未配置则 `main`）。规模和分批用第 1 步 `review-scope.mjs` 的输出：`summary.size` 是「全量精读」就一次读完；「分批精读」按 `batches` 的顺序（P0 → P1 → P2）读，P0 不能跳过；「过大」时停下请用户缩小范围。审不到的文件写进报告（读法见 `references/diff-strategy.md`）。**深审且改动属于「更大」、环境又能派子 agent 时，先问用户要不要分角度并行查找**（`references/diff-strategy.md`「分角度并行查找」），用户同意才走，第 4 步改由各子 agent 按角度过清单。只审本次改动引入的问题，同时检查改动是否破坏既有调用方。
4. **逐项过检查清单**：每个文件只看 `review-scope.mjs` 给它的 `sections`（清单小节号，按文件类型和改动内容定），一批文件用 `node <skills>/workflow/scripts/review-scope.mjs rules <文件…>`（带上和第 1 步一样的 `--diff` / `--base`）打印这些小节的原文和画像 `review.rules` 里匹配到的项目规则，按它检查；整个改动再过一次 `overall_sections`（9 影响面、13 测试）。深审读整份清单（`node <skills>/workflow/scripts/resolve.mjs template project-review checklist.md` 取 `path`；退出码 2 时停下并按 `hint` 处理），包括风格。对每个发现给出 文件、**问题所在的原代码片段**（从文件里照原样复制，第 6 步靠它定位行号）、问题描述、严重级别、修改建议。
5. **影响面分析**：改动是否影响其他调用方/模块。先运行 `node <skills>/code-graph/scripts/cg.mjs impact --diff <基线>...<dev>`（code-graph skill；未提交改动用 `--base <基线>`）：列出受影响的接口、MQ 消费者、定时任务、测试、表和配置 key，报告「影响面」按入口归纳并带文件:行号；退出码 2（没有索引等）时用 grep 或精读调用链确认。Spring 注入、AOP、MyBatis XML、MQ topic、配置 key 图谱看不到，照常 grep（见 `<skills>/workflow/references/codegraph.md`）。查不到调用方的符号不能当作安全，要明说"未确认"。
6. **复核**：交付前逐条复核 CRITICAL / HIGH（深审时 MEDIUM 也复核；其余 MEDIUM 至少做下面第 1 条）。审查结论会被用来决定能不能合并，一条误报会让人白改代码，也会让后面的真问题不被当回事。找出问题的人自己复核容易顺着原来的思路认同自己，所以**能交给独立的一方就交出去**：
   - **独立复核（首选）**：当前环境能派子 agent / 子任务时（例如 Claude Code 的 Agent 工具、Codex / Qwen Code 的子 agent），每条发现派一个，互不相关的可以同时派。只给它：一句话结论、位置（文件:行号）、你写的触发条件、对比分支（或「未提交改动」）。**不给你的推理过程**，也不告诉它你认为成立。要它自己读代码，按下面 1～4 条检查，回答「成立 / 可能成立 / 不成立」并引用代码作为依据。
   - **自行复核**：环境派不了子 agent 时自己做，先找它**不成立**的理由，找不到再确认成立。
   检查项（独立复核和自行复核都按这 4 条）：
   1. **定位**：把所有发现（包括 MEDIUM / LOW）写成 `workflow-run/tmp/review/findings.json`（数组，每条 `{ "file", "code"（原代码片段）, "line"（你估的行号，可选）, "title" }`），运行 `node <skills>/workflow/scripts/locate.mjs workflow-run/tmp/review/findings.json`（带上和第 1 步一样的 `--diff` / `--base`）。报告里的行号一律用它输出的 `start_line`～`end_line`，不用自己数的。`anchored: false` 的回去重读代码、照原样改片段再跑一次，还找不到就降为 MEDIUM 并标「⚠ 待确认」；`ambiguous` 时看 `candidates` 确认是哪一处；`in_change: false` 说明问题不在本次改动的行上，按第 4 条判断是不是本次引入的。
   2. 写出**触发条件**：什么输入 / 状态下会出错、错成什么样。写不出来 → 降为 MEDIUM 并标「⚠ 待确认」。
   3. 找有没有别处已经兜住：调用方校验、`@Validated` / 全局异常处理、数据库约束、框架默认行为、配置。涉及索引、字段、唯一约束、表大小的发现，以第 2 步拉到的实际表结构为准（复核列写「已与 <连接名> 核对」）。已兜住 → 删掉或降级，并在说明里写依据。
   4. 确认是本次改动引入的：改动前就存在的问题移到「未覆盖与待确认」，不计入合并结论。
   结果：「成立」在报告「复核」列标「✅」；「可能成立」标「⚠」；「不成立」从问题表里删掉（独立复核否掉的，在「未覆盖与待确认」里记一句「复核排除 N 条」）。复核方式（独立 / 自行）写进报告「审查方式」元信息。
7. **输出报告**（由 dev 自审调用时跳过第 7～9 步，问题表、影响面、未覆盖项交回 dev 统一交付，见 dev 的 F7）：按报告模板输出（`node <skills>/workflow/scripts/resolve.mjs template project-review report.md` 取 `path`；退出码 2 时停下并按 `hint` 处理），落盘规则见 Artifact Location。
8. **沉淀到 DocNexus（需用户授权）**：`resolve.mjs status` 的 `docnexus.ok` 为 true 时，交付报告后**每次都问**用户「要不要启动 DocNexus 流程，把本次审查沉淀到 DocNexus？」，并从本次发现里列出建议沉淀的内容：同类问题再次出现（知识库里已有类似沉淀，或本次多处出现）、新确立的编码约定、容易踩的坑；没有特别值得记的也照问，并说明这一点。未接入时不提问，报告的「DocNexus」元信息行写「未接入」。
   - 用户同意 → 按 DocNexus 入口 skill `docnexus` 的 capture 流程写入；正文只写知识，不写分支、路径；有 facts 时按 `<skills>/workflow/references/docnexus.md`「沉淀的来源」的格式写 provenance；分类用 `node <skills>/workflow/scripts/resolve.mjs category project-review` 的结果作为调用方显式分类封存（见 `<skills>/workflow/references/docnexus.md`「写入 DocNexus 的分类」）。只沉淀问题模式和约定，不沉淀某次审查的逐条清单，也不沉淀「⚠ 待确认」的发现；知识库已有同类沉淀时更新那一篇（带 `--base-version`），不要重复新建。写入成功后把报告的「DocNexus」元信息行改成 `docnexus/library/<path>`（多篇用「、」分隔），并回报给用户。
   - 用户不同意 → 元信息行保持「未沉淀」。
9. **记录运行反馈**（不问用户）：按 `<skills>/workflow/references/feedback.md` 运行 `node <skills>/workflow/scripts/feedback.mjs add --skill project-review --model <模型名> --mode review --depth <快审|标准|深审> --rounds <提问轮数> --corrections <用户纠正审查范围的次数> --findings <C>/<H>/<M>/<L>`，有跳过的步骤、不清楚或做不到的规则、用户的抱怨时再加 `--skipped` / `--unclear` / `--feedback`。只写过程，不写代码和业务名词；报错就提一句，不影响交付。

## 只报会出问题的

报告越短，真问题越不会被漏看。下面这些不报：
- 风格、命名、格式、注释措辞（快审和标准审查都不报；深审或用户要求时才看）；
- 编译器、linter、CI 已经会拦下的（未使用的变量、格式、import 顺序）；
- 个人偏好、没有违反项目约定（`workflow/profile.json` 的 `notes`、DocNexus 约定、审查清单）的写法差异；
- 写不出后果的「可以更好」：每条发现都要说清不改会怎样。

## Review Dimensions

- 正确性 / 逻辑 bug
- 字段完整性（实体拷贝是否漏字段、新旧对象赋值是否遗漏、DTO↔实体映射是否缺值）
- 空指针 / 空值安全
- 并发与线程安全
- 异常处理与资源释放（连接、流、锁、事务）
- 安全（注入 / XSS / 越权 / 敏感信息 / 硬编码密钥）
- 性能（N+1、循环内查询、大对象、无谓复制）
- 一致性 / 命名 / 风格（只在深审或用户要求时）
- 幂等与消息一致性（重复消费 / 回调、事务内发消息）
- 数据库变更安全（锁表、滚动发布兼容、索引支撑；以实际表结构为准，见第 2 步「涉及数据库」）
- 测试（改动有没有被测试覆盖、断言是否有效）
- 语言专项（Java / Go / TS / Python / SQL 各自的常见坑，按改动涉及的语言选读）
- 配置（见第 4 步取到的审查清单中的配置维度；项目使用的配置中心取自 `workflow/profile.json` 的 `config_center`——配置相关发现按配置清单输出）

## Severity Levels

- **CRITICAL**：崩溃 / 数据错误 / 资金影响 / 安全漏洞，必须改
- **HIGH**：明显 bug，特定场景可触发
- **MEDIUM**：潜在问题，边界未处理或语义存疑
- **LOW**：有实际收益的优化建议（性能、可维护性）；风格类只在深审时报

## Output Template

报告结构以第 7 步取到的报告模板为准：元信息（审查范围、对比分支、审查方式、参考产物、DocNexus）、结论摘要、与上次审查对比（复审时）、严重问题（带触发条件与复核列）、一般问题、优化建议、需求对照（有方案时）、配置清单（如有）、影响面、未覆盖与待确认。某一节没有内容写「无」，不要删标题。

> 灵活模式：单文件 / 小改动只在对话里回复时，可以直接列 findings，不必套完整模板；但每个结论必须指向真实文件+行号并引用代码，不得用"应该/大概"下结论，CRITICAL / HIGH 仍要复核。落盘的报告一律用模板。

## Artifact Location

审查报告按需求归档在 `workflow-run/docs/requirements/<需求名>/<项目名>/`，规则见 `<skills>/workflow/references/requirements.md`：

- 路径用 `node <skills>/workflow/scripts/requirement.mjs path review`（分支对比按 dev 分支加 `--branch <dev分支>`），写到输出的 `path`（文件名固定为 `review.md`）；已有报告时脚本先把它归档，输出的 `previous` 是上次报告，复审对照它。
- 退出码 2（这个分支还没绑定需求）：问用户这个需求叫什么，默认值用输出的 `suggested_name`，再 `requirement.mjs bind --name "<需求名>" [--branch <dev分支>]`；用户不给名字时 `bind` 按分支名生成。
- 报告同时完整输出到对话；落盘文件与对话内容一致
- 写完运行 `requirement.mjs sync <path>` 更新 `meta.json`；输出里 `archived` 非空（上一版已归档到 `workflow-run/tmp/old-artifacts/`）时告诉用户归档了哪些文件，请用户确认不再需要后自己删除；输出里 `commit` 非空（独立文档仓库模式）时按 `<skills>/workflow/references/requirements.md`「文档仓库的提交」处理。文档里引用其他产物（「参考产物」等）写 `requirement.mjs path` 输出的 `cite`
- 写完运行 `node <skills>/workflow/scripts/lint-doc.mjs <报告路径> --skill project-review --facts` 自检：「错误」（缺必填章节、缺元信息行、残留 `{{...}}`）先修正；「在 diff 和代码里都找不到」的名字逐个核实，写错了就改成真实的名字

## Verification

- 每个结论都要能定位到具体文件+行号，并引用真实代码片段；行号来自 `locate.mjs`。
- 读不到的内容如实说明，不要臆测。
- 涉及跨分支对比时，确保 diff 基于正确的 base 分支（默认 `main`）。
- CRITICAL / HIGH 都经过第 6 步复核（能派子 agent 时独立复核），写得出触发条件；复核不了的标「⚠ 待确认」，不计入「不建议合并」的结论。
- `review-scope.mjs` 的每个文件都有交代：`review` 里的都审过，没精读的逐个列在「未覆盖与待确认」；`skipped` 按原因汇总写进同一节（例如「跳过 12 个：生成文件 8、文档 3、敏感文件 1」，敏感文件单独点名提醒）。

## 终端命令

本 skill 给出的 `node …`、`git …` 命令在 bash、zsh、PowerShell 里写法一样，原样运行即可。需要自己写其他终端命令时，先看本机的系统和终端：`node <skills>/workflow/scripts/resolve.mjs env`（安装时记录，一次对话查一次就够；`resolve.mjs profile` / `status` 的输出里也带着 `env`）。按输出的 `os`、`shell`、`note` 写命令，不要再用 `uname`、`$PSVersionTable`、`ver` 之类去探测。
