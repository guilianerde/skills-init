---
name: project-review
description: "Review source code (any language; Java/Spring, Go, TypeScript, Python, etc.) for bugs, correctness, missing fields, null-safety, concurrency, exception handling, resource leaks, security and style issues. Use when the user asks to review code, review a branch/PR/MR against another branch (e.g. compare `main`), check a class/method/entity for missing fields or bugs, compare two classes to see whether a converter/mapper (DTO ↔ VO ↔ Entity, BeanUtils/MapStruct) drops or mismaps fields, verify changes before merge, or wants a structured code audit with an actionable findings report. Trigger phrases: 帮我审代码 / 审这个分支 / 这个类这段代码有没有问题 / 还缺哪些字段 / 是不是漏字段了 / 对照一下两个类 / 转换方法漏没漏字段 / review this branch / compare with main / code review / 影响面分析. Reports findings only and does not change code unless asked. Not for implementing or fixing (dev), reviewing the wording of a document, or generating tech/release docs."
---

# Code Review

## Workflow

1. **确定审查范围**：单文件 / 单方法、分支对比（如 `branch` vs `main`），还是未提交改动（`git diff HEAD`，见 `references/diff-strategy.md`「未提交改动」）。
2. **建立理解**：先读实体、接口、DTO、调用链，理清数据流再下结论；不要凭文件名猜内容。
   - **可选：查项目约定（DocNexus）**：项目根存在 `docnexus/project.json` 且 `./node_modules/.bin/docnexus` 可执行时，先运行 `node <skills>/workflow/scripts/knowledge.mjs project-review --match <模块名 / 业务名词>`，看以往审查沉淀的反复问题和开发约定；再按 `docnexus-recall` 用改动涉及的模块名 / 业务名词 `search` / `recall`，找相关的编码约定、历史决策与已知坑，作为审查依据并在报告中引用 `docnexus/library/<path>`。未检测到或查询失败就跳过，并在「未覆盖与待确认」中注明；审查过程中**不写入** DocNexus（写入见第 8 步）。
3. **分支对比**：基线默认取 `workflow/profile.json` 的 `main_branch`（未配置则 `main`）。按 `references/diff-strategy.md` 先量规模：小改动全量精读；改动多时按风险分级（P0 资金 / 事务 / 权限 / SQL / 对外接口 / MQ / 配置优先）分批精读，审不到的写进报告。只审本次改动引入的问题，同时检查改动是否破坏既有调用方。
4. **逐项过检查清单**（在项目根运行 `node <skills>/workflow/scripts/resolve.mjs template project-review checklist.md`，读输出的 `path`；退出码 2 时停下并按 `hint` 处理）：对每个发现给出 文件+行号、问题描述、严重级别、修改建议。
5. **影响面分析**：改动是否影响其他调用方/模块，用 grep 或精读调用链确认；查不到调用方的符号不能当作安全，要明说"未确认"。
6. **复核**：交付前逐条复核 CRITICAL / HIGH（MEDIUM 至少做第 1 条）。审查结论会被用来决定能不能合并，一条误报会让人白改代码，也会让后面的真问题不被当回事：
   1. 回到被审的代码（分支对比用 `git show <dev>:<文件>`，未提交改动读工作区）确认引用的片段和行号真实存在。
   2. 写出**触发条件**：什么输入 / 状态下会出错、错成什么样。写不出来 → 降为 MEDIUM 并标「⚠ 待确认」。
   3. 找有没有别处已经兜住：调用方校验、`@Validated` / 全局异常处理、数据库约束、框架默认行为、配置。已兜住 → 删掉或降级，并在说明里写依据。
   4. 确认是本次改动引入的：改动前就存在的问题移到「未覆盖与待确认」，不计入合并结论。
   复核通过的在报告「复核」列标「✅」，否则标「⚠」。
7. **输出报告**：按报告模板输出（`node <skills>/workflow/scripts/resolve.mjs template project-review report.md` 取 `path`；退出码 2 时停下并按 `hint` 处理），落盘规则见 Artifact Location。
8. **沉淀（可选，需用户授权）**：DocNexus 可用，且本次发现里有值得长期记住的——同类问题再次出现（知识库里已有类似沉淀，或本次多处出现）、新确立的编码约定、容易踩的坑——交付报告后列成简短清单，**询问用户**是否沉淀。同意后按 DocNexus 入口 skill `docnexus` 的 capture 流程写入，分类用 `node <skills>/workflow/scripts/resolve.mjs category project-review` 的结果作为调用方显式分类封存（见 `<skills>/workflow/references/docnexus.md`「写入 DocNexus 的分类」），并回报 `docnexus/library/<path>`。只沉淀问题模式和约定，不沉淀某次审查的逐条清单；知识库已有同类沉淀时更新那一篇（带 `--base-version`），不要重复新建。

## Review Dimensions

- 正确性 / 逻辑 bug
- 字段完整性（实体拷贝是否漏字段、新旧对象赋值是否遗漏、DTO↔实体映射是否缺值）
- 空指针 / 空值安全
- 并发与线程安全
- 异常处理与资源释放（连接、流、锁、事务）
- 安全（注入 / XSS / 越权 / 敏感信息 / 硬编码密钥）
- 性能（N+1、循环内查询、大对象、无谓复制）
- 一致性 / 命名 / 风格
- 配置（见第 4 步取到的审查清单中的配置维度；项目使用的配置中心取自 `workflow/profile.json` 的 `config_center`——配置相关发现按配置清单输出）

## Severity Levels

- **CRITICAL**：崩溃 / 数据错误 / 资金影响 / 安全漏洞，必须改
- **HIGH**：明显 bug，特定场景可触发
- **MEDIUM**：潜在问题，边界未处理或语义存疑
- **LOW**：风格、可读性、优化建议

## Output Template

报告结构以第 7 步取到的报告模板为准：元信息三行（审查范围、对比分支、审查方式）、结论摘要、严重问题（带触发条件与复核列）、一般问题、优化建议、配置清单（如有）、影响面、未覆盖与待确认。某一节没有内容写「无」，不要删标题。

> 灵活模式：单文件 / 小改动只在对话里回复时，可以直接列 findings，不必套完整模板；但每个结论必须指向真实文件+行号并引用代码，不得用"应该/大概"下结论，CRITICAL / HIGH 仍要复核。落盘的报告一律用模板。

## Artifact Location

审查报告默认保存到项目统一产物目录（各环境一致）：

```
docs/skills/project-review/review-<范围安全名>-<YYYYMMDD>.md
```

- `<范围安全名>`：分支对比用 `<dev分支>`（`/` → `-`），单文件用类名/文件名（`/` → `-`）
- 同路径已存在 → 加 `_v2`、`_v3`，不要覆盖
- 报告同时完整输出到对话；落盘文件与对话内容一致
- 项目无 `docs/skills/` 目录时先创建
- 写完运行 `node <skills>/workflow/scripts/lint-doc.mjs <报告路径> --skill project-review --facts` 自检：「错误」（缺必填章节、缺元信息行、残留 `{{...}}`）先修正；「在 diff 和代码里都找不到」的名字逐个核实，写错了就改成真实的名字

## Verification

- 每个结论都要能定位到具体文件+行号，并引用真实代码片段。
- 读不到的内容如实说明，不要臆测。
- 涉及跨分支对比时，确保 diff 基于正确的 base 分支（默认 `main`）。
- CRITICAL / HIGH 都经过第 6 步复核，写得出触发条件；复核不了的标「⚠ 待确认」，不计入「不建议合并」的结论。
- 分批审查时，没精读的文件列在「未覆盖与待确认」里，不能让读者以为全部审过。
