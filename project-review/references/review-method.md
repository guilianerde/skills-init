# 范围、背景与逐项审查

进入第 1～5 步时读取对应小节；分批与深审并行策略继续读 diff-strategy.md。

## 第 1 步 — 确定审查范围与深度

范围是单文件 / 单方法、分支对比（如 `branch` vs `main`），还是未提交改动（见 `diff-strategy.md`「未提交改动」）。分支对比和未提交改动都先运行 `node <skills>/workflow/scripts/review-scope.mjs --diff <基线>...<dev>`（未提交改动用 `--base <基线>`，含未跟踪的新文件；dev 自审时加 dev 传来的 `--exclude`），**审哪些文件以它的 `review` 为准**：`skipped` 是按规则跳过的（删除、二进制、敏感文件、依赖目录、生成文件、文档、本工具的产物，各带原因），不要自己再增减；确实要审被跳过的，在画像 `review.include` 里加（见 `<skills>/workflow/references/profile.md`）。深度按用户的说法定，没说就用「标准」，写进报告「审查方式」：
   - **快审**（「快速看一下」「扫一眼」）：只查正确性、空值、安全、事务与幂等，不查性能、测试、风格；「优化建议（LOW）」写「无」。CRITICAL / HIGH 照样复核。
   - **标准**（默认）：检查清单全部维度，**风格类（清单「一致性 / 风格」一节）不查**；「优化建议（LOW）」只写有实际收益的（性能、可维护性上的具体问题），没有就写「无」。
   - **深审**（「仔细审」「全面审」，或资金 / 权限 / 对外接口的大改动合并前）：全部维度，包括风格；MEDIUM 也复核。

## 第 2 步 — 建立理解

先读实体、接口、DTO、调用链，理清数据流再下结论；不要凭文件名猜内容。
   - **查项目约定（DocNexus）**：先运行 `node <skills>/workflow/scripts/knowledge.mjs project-review --match <模块名 / 业务名词> --query "<一句话：改动涉及的模块与业务>"`，看以往审查沉淀的反复问题和开发约定（`--query` 在这些分类内按正文 recall），找相关的编码约定、历史决策与已知坑，作为审查依据并在报告中引用 `workflow-run/docnexus/library/<path>`。审查过程中**不写入** DocNexus（写入见第 8 步）。
   - **同分支已有产物**：运行 `node <skills>/workflow/scripts/artifacts.mjs --branch <dev分支>`（单文件 / 未提交改动用当前分支，省略 `--branch`），看输出的 `latest`：
     - `latest.plan` 或 `latest.tech` 存在 → 读其中的验收标准、改动设计、接口 / 数据 / 配置变更，第 3 步审 diff 时做**需求对照**：方案里有、diff 里找不到的 → 漏实现（属于验收标准的按 HIGH，其余 MEDIUM）；diff 里有、方案里没提的接口 / 表结构 / 配置 / 依赖变更 → 列出请作者确认（不一定是问题）。只对照能在 diff 里核对的项，不推测业务语义。
     - `latest.delivery` 存在（dev 的交付说明）→ 其中「已确认的决定」并入需求对照的依据；「配置清单」「SQL 脚本」和 diff 对照，diff 里有而交付说明漏列的配置 key / DDL 记为 MEDIUM（上线时会被漏掉）。
     - `latest.review` 存在 → 这是**复审**：读上次报告的问题表，并用 `git log --oneline --since=<上次报告日期> <dev分支>` 看之后改了什么。本次报告对上次的每条问题标「已修复 / 仍存在 / 不再适用」（「已修复」要看到对应改动），本次新发现的标「新增」。
   - **涉及数据库**：diff 里有 SQL、Mapper、实体或 DDL 时，按 `<skills>/workflow/references/tables.md` 运行 `node <skills>/workflow/scripts/tables.mjs --diff <基线>...<dev>`（未提交改动用 `--base <基线>`）找出涉及的表；按本轮数据库通道用 `query.mjs --schema --tables <表> --indexes` 只读拉取实际字段、索引与估算行数，作为第 4、6 步判断索引支撑、字段存在与类型、DDL 锁表与滚动发布兼容的依据。查不了库时注明「未与实际库核对」写进「未覆盖与待确认」，这类发现不升到 HIGH 以上，除非 diff 本身就能证明。

## 第 3 步 — 分支对比

基线默认取 `workflow/profile.json` 的 `main_branch`（未配置则 `main`）。规模和分批用第 1 步 `review-scope.mjs` 的输出：`summary.size` 是「全量精读」就一次读完；「分批精读」按 `batches` 的顺序（P0 → P1 → P2）读，P0 不能跳过；「过大」时停下请用户缩小范围。审不到的文件写进报告（读法见 `diff-strategy.md`）。**深审且改动属于「更大」、环境又能派子 agent 时，先问用户要不要分角度并行查找**（`diff-strategy.md`「分角度并行查找」），用户同意才走，第 4 步改由各子 agent 按角度过清单。只审本次改动引入的问题，同时检查改动是否破坏既有调用方。

## 第 4 步 — 逐项过检查清单

每个文件只看 `review-scope.mjs` 给它的 `sections`（清单小节号，按文件类型和改动内容定），一批文件用 `node <skills>/workflow/scripts/review-scope.mjs rules <文件…>`（带上和第 1 步一样的 `--diff` / `--base`）打印这些小节的原文和画像 `review.rules` 里匹配到的项目规则，按它检查；整个改动再过一次 `overall_sections`（9 影响面、13 测试）。深审读整份清单（`node <skills>/workflow/scripts/resolve.mjs template project-review checklist.md` 取 `path`），包括风格。对每个发现给出 文件、**问题所在的原代码片段**（从文件里照原样复制，第 6 步靠它定位行号）、问题描述、严重级别、修改建议。

## 第 5 步 — 影响面分析

改动是否影响其他调用方/模块。按本轮 CodeGraph 通道分析（script 模式运行 `node <skills>/code-graph/scripts/cg.mjs impact --diff <基线>...<dev>`；未提交改动用 `--base <基线>`）：列出受影响的接口、MQ 消费者、定时任务、测试、表和配置 key，报告「影响面」按入口归纳并带文件:行号。Spring 注入、AOP、MyBatis XML、MQ topic、配置 key 图谱看不到，照常 grep（见 `<skills>/workflow/references/codegraph.md`）。查不到调用方的符号不能当作安全，要明说"未确认"。

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
