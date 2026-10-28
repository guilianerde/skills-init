---
name: project-review
description: "Review source code (any language; Java/Spring, Go, TypeScript, Python, etc.) for bugs, correctness, missing fields, null-safety, concurrency, exception handling, resource leaks and security issues (style only when asked). Use when the user asks to review code, review a branch/PR/MR against another branch (e.g. compare `main`), check a class/method/entity for missing fields or bugs, compare two classes to see whether a converter/mapper (DTO ↔ VO ↔ Entity, BeanUtils/MapStruct) drops or mismaps fields, verify changes before merge, or wants a structured code audit with an actionable findings report. Trigger phrases: 帮我审代码 / 审这个分支 / 这个类这段代码有没有问题 / 还缺哪些字段 / 是不是漏字段了 / 对照一下两个类 / 转换方法漏没漏字段 / review this branch / compare with main / code review / 影响面分析. Reports findings only and does not change code unless asked. Not for implementing or fixing (dev), reviewing the wording of a document, or generating tech/release docs."
---

# Code Review

审代码并输出有证据的发现；用户未要求修复时不改业务代码。进入每步前读取所指 reference 的对应小节，不预先加载全部方法说明。
配置相关结论需要远程值且已安装 nacos-config 时，按 `<skills>/nacos-config/SKILL.md` 按需只读核对并注明环境与配置来源；不可用时标明「未核对远程配置」，不能据本地默认值推断实际开关状态。

## 门禁

- 开工运行 `node <skills>/workflow/scripts/resolve.mjs status`，按 `<skills>/workflow/references/capabilities.md` 复用本轮能力快照；DocNexus 必装，不可用先修复。
- 审查范围以 `review-scope.mjs` 输出为准；只报本次引入的问题，范围外发现单列，不把没覆盖写成没问题。
- 每条结论引用真实代码与文件行号，行号由 `locate.mjs` 定位；CRITICAL / HIGH 必须复核，有条件时交独立 agent。
- dev 完整流程调用：执行第 1～7 步，零发现也落盘；只返回报告草稿与结构化证据，由主 agent finalize，不修代码、不生成 delivery.md、不提交、不另开 review 运行，跳过第 8～9 步。
- dev 内部报告写「未询问（由 dev 交付统一处理）」，缺本轮 delivery.md 是正常时序；主 agent 交报告后等用户选修复或交付。S 快速通道仅当前会话审查。
- 深审大改动的分角度并行查找须用户同意；写入知识库与其他对外动作仍须授权。

## 运行状态

独立正式报告开工前读 [reporting.md 的运行状态](references/reporting.md)：绑定目标需求与分支，用 `run.mjs show` 恢复，必要时 `run.mjs start --kind review` 创建运行，R1～R7 对应第 1～7 步。
每步完成、等待或受阻时 save；报告落盘、自检并交用户后，R7 标 completed，再 complete 保存已完成和完成时间。
灵活模式不建运行；dev 内部由主 agent 更新 F7 / B5。状态协议见 `<skills>/workflow/references/runs.md`。

## Workflow

下文 workflow 脚本用 `node <skills>/workflow/scripts/<脚本>` 在项目根执行，终端写法沿用能力快照 env。

1. **确定审查范围与深度**：先读 [review-method.md 的第 1 步](references/review-method.md)。运行 `review-scope.mjs --diff <基线>...<dev>`，工作区用 `--base <基线>`；保留 exclude。默认标准深度，范围与深度写入报告。

2. **建立理解**：读 [review-method.md 的第 2 步](references/review-method.md)。运行 `knowledge.mjs project-review --match <模块> --query "<改动>"`，结合代码、已有产物与实际表结构，形成审查依据和需求对照。

3. **分支对比**：读 [diff-strategy.md](references/diff-strategy.md) 与 review-method.md 第 3 步；按 scope 的 batches 从 P0 到 P2 精读，保留每批发现与未覆盖文件。过大无法过滤时请用户缩小范围。

4. **逐项过检查清单**：读 [review-method.md 的第 4 步](references/review-method.md)。运行 `review-scope.mjs rules <文件…>`，带相同 base / diff / exclude；按匹配小节和 overall_sections 检查，形成附原代码片段的发现。

5. **影响面分析**：读 [review-method.md 的第 5 步](references/review-method.md)。按本轮 CodeGraph 通道分析入口、调用方、测试、表和配置；结果进入报告影响面，找不到调用方明确写未确认。

6. **复核**：必须先读 [verification.md](references/verification.md)。运行 `locate.mjs workflow-run/tmp/review/findings.json`，带相同范围；验证触发条件、防护与引入时间，排除误报，保留成立或待确认的证据。

7. **输出报告**：先读 [reporting.md 的第 7 步与 Artifact Location](references/reporting.md)。用 `resolve.mjs template project-review report.md` 取模板；正式报告按 execution.md 用 `artifact.mjs finalize --kind review` 收尾为 review.md 后完整交给用户，灵活模式在对话给 findings。

8. **沉淀到 DocNexus**：独立审查交报告后读 [reporting.md 的第 8 步](references/reporting.md)。有值得记录的才询问授权，分类用 `resolve.mjs category project-review`；沉淀结果写报告元信息并 sync。dev 内部不执行。

9. **记录运行反馈**：读 [reporting.md 的第 9 步](references/reporting.md)，用 `feedback.mjs add --skill project-review` 记录过程；不写业务内容，失败不阻塞交付。dev 内部交主 agent 统一记录。

## 只报会出问题的

每条发现写清“不改会怎样”。快审 / 标准不报风格，深审或用户要求时才查；不报个人偏好、无实际后果的建议或编译器 / linter 已拦下的问题。详细审查维度见 review-method.md，清单由 rules 命令给出。

## Severity Levels

- CRITICAL：崩溃、数据错误、资金影响或安全漏洞；HIGH：有明确触发条件的 bug。
- MEDIUM：边界或语义存疑；LOW：有实际收益的优化，风格只在深审报。
- CRITICAL / HIGH 未修不能建议合并；dev 明确接受风险可带问题交付，结论仍保留不建议合并，不等于允许上线。
- 复核不了的标「⚠ 待确认」，不计入阻止合并的结论；深审还须复核 MEDIUM。具体判定读 verification.md。

## Output Template

正式报告使用知识库模板，空节写「无」不删标题，复审逐项对照上次报告；细则见 reporting.md。
单文件 / 小改动可用灵活模式只在对话列 findings，但证据与严重问题复核不省；dev 完整流程不能用此模式免落盘。

## Artifact Location

正式报告按 `<skills>/workflow/references/requirements.md`，在目标工作分支用 `review-handoff.mjs --id <id>` 生成交接材料，报告草稿与结构化结果交 `artifact.mjs finalize --kind review` 收尾；事实用 `lint-doc.mjs <草稿> --skill project-review --facts`，错误修正后交付。具体执行读 reporting.md。
普通聊天的分析与草稿默认在 `workflow-run/other/`，不 bind、不建运行、不写需求 meta.json；用户明确路径优先。

## Verification

报告前按 verification.md 核对：真实位置与触发条件、正确基线、复核结果、scope 中每个文件的覆盖情况；读不到、没审到的如实写入「未覆盖与待确认」。
