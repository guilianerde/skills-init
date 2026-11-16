---
description: "使用 dev 技能执行完整开发或缺陷修复流程"
argument-hint: "[需求、PRD 或 --bug <现象>]"
---

<!-- workflow-run: WorkBuddy dev command -->

用户明确调用了 `/dev`。先读取项目根目录下的 `.codebuddy/skills/dev/SKILL.md`，再按其中的流程处理下面的完整参数（包括 `--bug`）。未提供任务且未明确要求续接时，先询问要处理的需求或缺陷。

$ARGUMENTS
