---
name: project-review
description: "Review source code (any language; Java/Spring, Go, TypeScript, Python, etc.) for bugs, correctness, missing fields, null-safety, concurrency, exception handling, resource leaks, security and style issues. Use when the user asks to review code, review a branch/PR/MR against another branch (e.g. compare `main`), check a class/method/entity for missing fields or bugs, verify changes before merge, or wants a structured code audit with an actionable findings report. Trigger phrases: 帮我审代码 / 审这个分支 / 这个类这段代码有没有问题 / 还缺哪些字段 / review this branch / compare with main / code review / 影响面分析. Reports findings only and does not change code unless asked. Not for implementing or fixing (dev), reviewing the wording of a document, or generating tech/release docs."
---

# Code Review

## Workflow

1. **确定审查范围**：单文件/单方法，还是分支对比（如 `branch` vs `main`）。
2. **建立理解**：先读实体、接口、DTO、调用链，理清数据流再下结论；不要凭文件名猜内容。
   - **可选：查项目约定（DocNexus）**：项目根存在 `docnexus/project.json` 且 `./node_modules/.bin/docnexus` 可执行时，先按 `docnexus-recall` 用改动涉及的模块名 / 业务名词 `search` / `recall`，找相关的编码约定、历史决策与已知坑，作为审查依据并在报告中引用 `docnexus/library/<path>`。未检测到或查询失败就跳过，并在「影响面 / 遗漏说明」中注明；审查过程中**不写入** DocNexus。
3. **分支对比**：基线默认取 `workflow/profile.json` 的 `main_branch`（未配置则 `main`）。先 `git diff main...<branch> --stat` 定位改动文件，再 `git diff main...<branch>` 精读每个改动。只审本次改动引入的问题，同时检查改动是否破坏既有调用方。
4. **逐项过检查清单**（在项目根运行 `node <skills>/workflow/scripts/resolve.mjs template project-review checklist.md`，读输出的 `path`；退出码 2 时停下并按 `hint` 处理）：对每个发现给出 文件+行号、问题描述、严重级别、修改建议。
5. **影响面分析**：改动是否影响其他调用方/模块，用 grep 或精读调用链确认；查不到调用方的符号不能当作安全，要明说"未确认"。
6. **输出结构化报告**（见下方输出模板）。

## Review Dimensions

- 正确性 / 逻辑 bug
- 字段完整性（实体拷贝是否漏字段、新旧对象赋值是否遗漏、DTO↔实体映射是否缺值）
- 空指针 / 空值安全
- 并发与线程安全
- 异常处理与资源释放（连接、流、锁、事务）
- 安全（注入 / XSS / 越权 / 敏感信息 / 硬编码密钥）
- 性能（N+1、循环内查询、大对象、无谓复制）
- 一致性 / 命名 / 风格
- 配置（见 `references/checklist.md` 第 10 维度；项目使用的配置中心取自 `workflow/profile.json` 的 `config_center`——配置相关发现按配置清单输出）

## Severity Levels

- **CRITICAL**：崩溃 / 数据错误 / 资金影响 / 安全漏洞，必须改
- **HIGH**：明显 bug，特定场景可触发
- **MEDIUM**：潜在问题，边界未处理或语义存疑
- **LOW**：风格、可读性、优化建议

## Output Template

```
# 代码审查报告 — <范围>

## 结论摘要
<1-2 句总评：总体质量、几个关键风险、建议是否可合并>

## 严重问题（CRITICAL / HIGH）
| # | 级别 | 位置 | 问题 | 建议 |
|...|

## 一般问题（MEDIUM）
...

## 优化建议（LOW）
...

## 影响面 / 遗漏说明
<改动对调用方的影响、未覆盖的检查、未确认的符号>
```

> 灵活模式：对单文件/小改动可合并为直接列 findings，不必套完整模板；但每个结论必须指向真实文件+行号并引用代码，不得用"应该/大概"下结论。

## Artifact Location

审查报告默认保存到项目统一产物目录（各环境一致）：

```
docs/skills/project-review/review-<范围安全名>-<YYYYMMDD>.md
```

- `<范围安全名>`：分支对比用 `<dev分支>`（`/` → `-`），单文件用类名/文件名（`/` → `-`）
- 同路径已存在 → 加 `_v2`、`_v3`，不要覆盖
- 报告同时完整输出到对话；落盘文件与对话内容一致
- 项目无 `docs/skills/` 目录时先创建

## Verification

- 每个结论都要能定位到具体文件+行号，并引用真实代码片段。
- 读不到的内容如实说明，不要臆测。
- 涉及跨分支对比时，确保 diff 基于正确的 base 分支（默认 `main`）。
