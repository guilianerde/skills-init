---
name: dev
description: "Implement a feature or fix a bug in this project end to end: understand the requirement, study existing code, plan at the right size, implement in small verified steps, run tests, self-review the diff with code-review, and deliver a summary with config/SQL checklists. Use when the user asks to develop, implement, add, change or fix something in the codebase, or invokes /dev <需求> or /dev --bug <现象>. Trigger phrases: 帮我开发 / 实现这个需求 / 加个接口 / 改一下这个逻辑 / 修这个 bug / 排查并修复 / 线上报错了帮我修 / implement this feature / fix this bug. Not for pure code review (code-review), SQL lookups (database-query) or doc generation (create-tech-md-doc / create-release-md-doc)."
---

# Dev

把一个开发需求或 bug 从「理解」推进到「可交付」。本 skill 负责编排，复用同项目的其他 skill：

| 环节 | 复用 | 不可用时 |
|---|---|---|
| 需求背景 | `md-to-wiki` 的 wiki 连接（读 PRD） | 只用对话中的需求描述 |
| 项目约定 / 历史决策 | DocNexus（`docnexus-recall` skill） | 读 `CLAUDE.md` / `AGENTS.md` 与代码 |
| 数据核对 | `database-query`（只读） | 给出 SQL 让用户执行 |
| 自审 | `code-review` | 按其 `references/checklist.md` 手动过 |
| 交付文档 | `create-tech-md-doc` / `create-release-md-doc` | 只在对话中汇总 |

## Command Format

```
/dev <需求描述 | PRD pageId/url>          # 功能开发（默认）
/dev --bug <现象 | 报错 | 日志片段>        # 缺陷修复
```

没有斜杠命令时按用户意图判断模式：描述的是「要新增/改变的行为」→ 功能开发；描述的是「现在的行为不对」→ 缺陷修复。

## Step 0 — 前置检查（两种模式共用）

1. **项目画像**：读本 skill 目录下的 `profile.json`。字段含义：
   - `main_branch`：主分支名（如 `main` / `master`），diff 基线；
   - `build` / `test` / `lint`：构建、全量测试、静态检查命令；
   - `test_single`：只跑一个测试的命令，用 `{target}` 表示测试类或文件（如 `mvn -q test -Dtest={target}`）；
   - `notes`：其他项目约定（如「启动需要本地 Redis」），一条一句。
   - 字段为空 → 从仓库推断：`pom.xml`/`build.gradle`（Maven/Gradle）、`package.json` scripts、`go.mod`、`pyproject.toml`、`Makefile`、CI 配置，以及 `CLAUDE.md` / `AGENTS.md` 中的命令约定。
   - 把推断结果给用户确认后写回 `profile.json`（只写命令和分支名，不写任何凭据）。用户不确认就只在本次使用，不落盘。
2. **工作区状态**：`git status --short` 与当前分支。
   - 有与本需求无关的未提交改动 → 告知用户，不要混进本次改动，也不要替用户 stash / 丢弃。
   - 当前在主分支（`profile.main_branch`）上 → 建议先建特性分支，用户同意后再建。
3. **增强能力探测**（都不阻塞，探测失败就跳过并在交付时注明）：
   - wiki：`md-to-wiki/wiki-config.json` 中 `enabled=true` 且 `base_url` 非空，或环境有 wiki MCP 工具；
   - DocNexus：项目根存在 `docnexus/project.json` 且 `./node_modules/.bin/docnexus` 可执行；
   - 数据库：`database-query/config.json` 存在。

## 功能开发流程

### F1 — 理解需求

- 需求来源是 PRD pageId/URL 且 wiki 可用 → 按 `create-tech-md-doc` Step 0.5 的方式拉取并提炼；wiki 不可用 → 请用户贴出关键内容。
- DocNexus 可用 → 按 `docnexus-recall` 用需求里的业务名词 `search` / `recall`，找相关约定与历史决策，引用 `docnexus/library/<path>`。
- 输出 **需求要点 + 验收标准**（可验证的行为，而不是实现手段）。
- 存在歧义（边界、异常分支、兼容性、权限）→ **一次性**列出问题问用户，不要边做边问，也不要自行假设后继续。

### F2 — 现状调研

- 从入口（Controller / Handler / CLI / 页面）沿调用链读到持久层，理清数据流；不凭文件名猜内容。
- 找到同类功能的既有实现，作为风格与结构的参照（命名、分层、异常、日志、事务、DTO 转换方式）。
- 涉及表结构 → 先看 `database-query/references/schema.md`，需要时用 `database-query` 只读 `DESCRIBE` / 抽样核对。

### F3 — 方案（按规模分级）

| 规模 | 判定 | 做法 |
|---|---|---|
| **S** | ≤3 个文件，无接口签名 / 表结构 / 配置项变更 | 在对话中列改动步骤，直接开始 |
| **M** | 新增或修改接口、配置项、少量表字段 | 在对话中给出简要方案（用 `references/plan-template.md` 的精简版），**等用户确认后再写代码** |
| **L** | 新模块、跨服务、表结构较大变更、数据迁移 | 按 `references/plan-template.md` 写方案文档落盘（见 Artifact Location），用户确认后再写代码；完成后建议用 `create-tech-md-doc` 生成正式技术方案 |

规模拿不准时按大一级处理。

### F4 — 实现

- **小步推进**：每完成一个可编译的单元，就运行 `profile.build`（没有则用对应构建工具的编译命令）确认通过，再进入下一步。
- **贴合现有代码**：沿用参照实现的写法；不顺手重构、不改无关代码、不升级依赖。看到范围外的问题记进交付说明，不在本次修。
- **配置**：新增配置项记入配置清单（key、位置、用途、建议默认值、上线前需下发的环境），遵循 `code-review/references/checklist.md` 第 10 维度的项目约定。
- **数据库变更**：DDL / 数据修正写成 SQL 脚本放进项目约定的目录（没有约定则放进交付说明），**不在任何环境直接执行**。
- **敏感信息**：不硬编码密钥、密码、内网地址；日志不打印敏感字段。

### F5 — 验证

- 按验收标准补充或更新单元测试 / 集成测试，测试放在项目既有测试目录、沿用既有测试框架。
- 运行 `profile.test`（或只跑相关测试的 `profile.test_single`）。有 `profile.lint` 时一并运行。
- 如实报告结果：失败就给出失败输出并继续修；环境跑不了（缺依赖、缺中间件）就明确写「未验证」以及用户该如何验证。**不得声称未运行的测试已通过。**

### F6 — 自审

- 按 `code-review` skill 审本次改动：分支已有提交时用 `git diff <main_branch>...HEAD`，再加上 `git diff HEAD` 的未提交部分。
- CRITICAL / HIGH 必须修掉后重新跑 F5；MEDIUM / LOW 修掉或写进交付说明。
- 自审结论放进交付说明即可，不单独落盘审查报告（用户要求时再按 code-review 的产物规范落盘）。

### F7 — 交付

按下方「交付模板」输出，然后**询问**下一步，不要自行执行：

- 提交：给出建议的 commit message，用户同意后再 `git commit`；**不 push**，除非用户明确要求。
- 文档：M / L 规模建议 `create-tech-md-doc`；要上线时建议 `create-release-md-doc`。
- 沉淀：本次产生了值得长期记住的决策、约定或坑，且 DocNexus 可用 → 提议走 DocNexus 的 capture 流程；**必须用户授权后才写入**。

## 缺陷修复流程（`--bug`）

### B1 — 收集现象

整理：现象、期望行为、触发条件、影响范围、首次出现时间、相关日志 / 报错 / 数据。信息不足以复现时，列出缺的信息问用户。

### B2 — 复现

- 优先写一个**能稳定失败的测试**来复现；写不出测试时给出可执行的复现步骤（请求、参数、数据）。
- 涉及数据问题 → 用 `database-query` 只读查询核对现场数据，敏感字段脱敏。
- 复现不了 → 停下来说明尝试过什么，不要在没复现的情况下猜着改。

### B3 — 定位根因

- 沿调用链找到**第一个**出错的位置，用证据（代码行、日志、数据、git 历史 `git log -L` / `git blame`）说明为什么错。
- 区分根因与症状：只在出错表象处加判空 / try-catch 不算修复，除非能说明那里就是根因。
- 检查同一根因是否在其他调用方同样存在。

### B4 — 修复与验证

- 做能消除根因的**最小改动**；B2 的测试由红变绿，相关已有测试保持通过（运行方式同 F5）。
- 如果历史脏数据需要修正，写成 SQL 脚本交给用户，不直接执行。

### B5 — 自审与交付

同 F6、F7。交付说明里必须包含：**根因**、修复方式、为什么这样修、同类风险排查结果。

## Rules

- 不执行任何写库操作；不修改 `config.json` / `wiki-config.json` 等凭据文件。
- 不 `git commit` / `git push` / 改写历史 / 删除分支，除非用户在本次对话中明确要求。
- 不安装新依赖；确实需要时说明理由，等用户同意。
- 每个关于现有代码的结论都指向真实文件和行号；读不到的内容如实说明。
- 用户中途改变需求 → 回到 F1 更新验收标准，再继续。

## 交付模板

```
# 开发交付 — <需求或缺陷简述>

## 结果
<一两句话：做成了什么；有无未完成项>

## 改动
| 文件 | 改动说明 |
|---|---|

## 验证
- 构建：<命令> → <通过 / 失败 / 未运行（原因）>
- 测试：<命令> → <通过 n 个 / 失败 / 未运行（原因）>；新增测试：<列表>
- 未验证项：<需要用户在什么环境怎么验证>

## 根因（仅缺陷修复）
<证据链：现象 → 出错位置 → 原因>

## 配置清单
| key | 位置 | 用途 | 建议默认值 | 需下发环境 |
|---|---|---|---|---|

## SQL 脚本（未执行）
<文件路径或脚本内容；无则写「无」>

## 自审
<code-review 结论摘要；遗留的 MEDIUM / LOW>

## 范围外发现
<顺带看到但本次未处理的问题>

## 建议下一步
<commit message 建议 / 文档 / DocNexus 沉淀>
```

> 小改动可以压缩成「改动 + 验证 + 下一步」三段；但验证结果必须如实。

## Artifact Location

- 交付说明默认只在对话中输出。
- L 规模的方案文档（或用户要求落盘的 M 规模方案）：

  ```
  docs/skills/dev/plan-<需求短名>-<YYYYMMDD>.md
  ```

  `<需求短名>` 用小写字母、数字和 `-`；同路径已存在 → 加 `_v2`、`_v3`，不覆盖。项目无 `docs/skills/` 目录时先创建。
