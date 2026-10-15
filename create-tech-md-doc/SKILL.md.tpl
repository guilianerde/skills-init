---
name: create-tech-md-doc
description: "Generate a Markdown technical design doc (技术方案) from the diff between two git branches. Use when the user invokes /create-tech-md-doc <devBranch> <mainBranch>, optionally with --prd <pageId|url> to reference a Confluence product doc (PRD) and merge its business intent with the code diff, or when the user asks to generate a tech plan / technical design document / 技术方案 from a branch diff against master/main."
---

# Create Tech MD Doc

从两个 git 分支的 diff 自动生成技术方案 Markdown 文档（8 模块结构，填充其中 6 个）。

## Overview

**核心原理**：对比开发分支与主分支的代码 diff，提取新增/修改的 Controller、Service、实体、SQL、配置等，按技术方案模板（`template.md`，与本 SKILL.md 同目录）的 8 个模块组织成 Markdown，输出到项目文档目录。

**PRD 增强（可选，依赖 wiki 连接）**：若传入 `--prd <pageId|url>`，会先从 Confluence 拉取产品文档，把业务背景填进模块 1（需求背景）和模块 7（数据链路），并在模块 8 标注 PRD 与代码实现的「对齐缺口」。

## GATE — wiki 连接未配置时 PRD 增强不启动

本 skill 的 `--prd` 功能依赖 Confluence 连接。执行 `--prd` 前，先读同项目 `md-to-wiki` skill 目录下的 `wiki-config.json`（若找不到则找本 skill 目录旁的 `wiki-config.json`）：

- 文件缺失 / `enabled` 非 true / `wiki.base_url` 为空 → **`--prd` 功能不启动**：告知用户「wiki 连接未配置，PRD 增强已跳过」，回退纯-diff 流程。**文档生成主流程不受影响，不中止。**
- 配置通过 → 按下方 Step 0.5 拉取 PRD。

> 跨环境初始化时连接配置默认留空（enabled=false），因此 PRD 增强默认不生效；纯 diff 生成技术方案始终可用。

## When to Use

**触发条件（满足任一）：**
- 用户输入 `/create-tech-md-doc <dev分支> <主分支>`（精确命令）
- 用户输入 `/create-tech-md-doc <dev分支> <主分支> --prd <pageId|url>`（带 PRD 参考的精确命令）
- 用户要求"根据两个分支的 diff 生成技术方案 / tech plan / 技术文档"，并可选地提供一个 Confluence PRD 链接或 pageId 一并参考
- 用户给出两个分支名并希望产出 Markdown 技术方案

**不适用：**
- 只想看 diff 概览（用 `git diff --stat` 即可）
- 单分支、无对比基线
- 非 git 仓库

## Command Format

```
/create-tech-md-doc <devBranch> <mainBranch> [--prd <pageId|url>]
```

- `<devBranch>`：开发/特性分支（被对比方，通常是当前工作分支）
- `<mainBranch>`：项目主分支（对比基线，如 `master` / `main`）
- `--prd`（可选）：产品文档（PRD）参考。值为 Confluence pageId（纯数字）或 URL（含 `viewpage.action?pageId=`，用正则 `pageId=(\d+)` 自动解析）。传入后从 Confluence 拉取 PRD 填模块 1/7 并在模块 8 标注对齐缺口；不带 `--prd` 走纯-diff 流程。

两个分支参数都必填。`--prd` 可选。若用户只给一个分支，把另一个作为参数再问一次；不要猜测。

## Workflow

严格按顺序执行。每一步都标注了工具和判停条件。

### Step 0 — 校验前置条件

1. **确认在 git 仓库内**：`git rev-parse --is-inside-work-tree` 必须返回 `true`。否则停止并告诉用户。
2. **校验两个分支都存在**：`git rev-parse --verify <branch>`（或 `origin/<branch>`）。不存在的分支 → 列出 `git branch -a | grep -i <keyword>` 给用户挑，停止。

> **判停**：分支不存在 → 停。其余项不阻塞。

### Step 0.5 — 获取 PRD 参考文档（仅当传入 `--prd` 且 GATE 通过）

1. **解析 pageId**：纯数字直接用；URL 用正则 `[?&]pageId=(\d+)` 提取；提取失败 → 提示用户，回退纯-diff 流程（不中止）。
2. **拉取页面**：用环境的 wiki 能力（MCP 工具如 `mcp__wiki-mcp__get_page({pageId, expand: "body.storage,version"})`，或 REST `GET {base_url}/rest/api/content/{pageId}?expand=body.storage`，凭据从 `wiki-config.json` 读）。返回 storage HTML，取 `body.storage`。
3. **HTML → 可读文本**：剥离 Confluence storage 标签，保留标题层级、表格、列表、段落。
4. **抽取 PRD 关键要素** 存入 `prd_context`：`title`（需求标题）、`background`（业务背景摘要）、`features`（功能点列表 `{name, desc}`）、`tables`（提及的数据表名）、`pageUrl`（原文链接）。
5. **只从 PRD 文本抽事实，不臆造**。PRD 没写的字段留空。

> **判停**：`--prd` 解析不出 pageId / GATE 未通过 / 拉取失败 → 回退纯-diff（`prd_context = null`），元信息标注「PRD 增强已跳过」。绝不因 PRD 失败中止文档生成。

### Step 1 — 采集 diff（分层过滤，对抗巨大 diff）

> **项目画像**：主分支默认取 `workflow/profile.json` 的 `main_branch`；下表路径过滤以 Java/Spring 工程为默认，其他技术栈按项目实际目录调整（如 Go 的 `internal/handler`、前端的 `src/api`）。发布平台、配置中心、定时任务注解、是否需要数据评审同样取自 profile，未配置的部分在文档中写「待填写」，不要沿用其他项目的取值。

> **diff 基线必须用三点 `<main>...<dev>`**：比较的是 dev 相对两分支合并基点（merge-base）的改动。两点 `<main>..<dev>` 等价于直接比较两个分支末端，主干前进后会把主干新提交以「反向删除」混进文档。

按下列顺序执行（每层独立、可并行），**必须分层过滤**，否则上下文会爆：

| 层 | 命令（路径过滤） | 用途 | 喂给哪个模块 |
|---|---|---|---|
| 1. Controller | `git diff <main>...<dev> --name-only -- '**/controller/**'` | HTTP 接口入口 | 4.接口文档 |
| 2. Service/Impl | `-- '**/service/**'`（排除 `**/impl/*Test*`） | 业务逻辑 | 3.详细方案 |
| 3. Entity/DTO/VO | `-- '**/entity/**' '**/dto/**' '**/vo/**'` | 数据结构变更 | 6.中间件变更 |
| 4. SQL 脚本 | `-- '*.sql' '**/db/**' '**/migration/**'` | DDL | 6.中间件变更 |
| 5. 配置 | `-- '**/application*.yml' '*.properties' 'bootstrap*.yml'` | 中间件/开关 | 6.中间件变更 |
| 6. pom | `-- 'pom.xml' '**/pom.xml'` | 依赖变更 | 6.中间件变更 |
| 7. Job/定时任务 | `-- '**/job/**' '**/*Job.java'` | 定时任务 | 6.中间件变更 |
| 8. Kafka/MQ | grep `@KafkaListener`、`KafkaTemplate`、`Topic` 在 diff 内的命中 | 消息协议 | 4.接口文档 |

**排除项**：`src/test/**`、`**/generated/**`、`**/target/**`、`*.md`、`*.txt`（除非用户明确要求）。

**巨量 diff 兜底**：单层文件数 > 200 → 只取 `--stat` + 每文件 diff 前 80 行摘要，文档标注"⚠️ 已摘要化"。

**统计行**：`git diff <main>...<dev> --shortstat` 写进文档开头元信息。

### Step 2 — 提取结构化信息

**2a. 从 diff 抽取事实（必做，纯 git）**：
- **Controller**：路径 + 方法名 + 入参/返回类型 → 4.接口文档；DTO/VO 新增字段 → 4.接口文档字段变更示例
- **Service 方法**：签名 + 一句话职责（从方法名/注释推断，不臆造）→ 3.详细方案
- **Entity 新增字段**：字段名 + 类型 + `@TableField` → 6.中间件变更（DB）
- **SQL DDL**：原样保留 `CREATE/ALTER TABLE` → 6；表名 → 7
- **db_name 推断**（优先级）：① SQL `USE <db>`；② datasource url 库名；③ 表名前缀（标"待人工确认"）
- **Kafka**：topic + 方向 + payload 字段 → 4（kafka 子表）
- **配置变更**：新增 key + 值 → 6
- 抽取规则：**只读 diff 内可见事实**，看不到写"待补充"，不编造。

**2b. PRD 对齐校验（仅 `prd_context != null`）**：PRD 功能点 vs diff 实现做语义对齐 → 模块 8 产出「对齐缺口」与「实现超出 PRD」两张清单。匹配不确定的不算缺口，标"待人工核对"。

### Step 3 — 填充模板 8 个模块

读取 `template.md`（与本 SKILL.md 同目录），按 diff 实况填充：

| 模块 | 是否填 | 数据来源 |
|---|---|---|
| 1. 需求背景 | 有 PRD 时填；无 PRD 时留空（"待补充"占位） | `prd_context`；diff 无法推断 |
| 2. 影响范围 | ✅ | Step1 各层命中的模块/包名 |
| 3. 详细方案 | ✅ | Step2a Service；有 PRD 时补业务语义（标注来源 PRD） |
| 4. 接口文档 | ✅ | Step2a Controller + Kafka |
| 5. 涉及服务 | ✅ | git remote + 项目结构推断 |
| 6. 中间件变更 | ✅ | Step2a SQL + Entity + 配置 + pom + Job |
| 7. 数据链路 | 有 PRD 且提及表名时填；否则从 diff 推断 | `prd_context.tables`；Step2a 推断 |
| 8. 兼容问题&方案 | ✅ | diff 推断 + Step2b 对齐缺口 |

### Step 4 — 写文件

输出路径（项目统一产物目录，各环境一致）：
`docs/skills/create-tech-md-doc/tech-doc_<dev分支安全名>_<YYYYMMDD>.md`
- 目录不存在时先创建；分支名 `/` → `-`；日期用今天
- 同路径已存在 → 加 `_v2`、`_v3`，不要覆盖
- 写完后 Read 回读前 30 行确认格式，再给用户路径

## 文档元信息（写进生成文档的开头）

```markdown
> **自动生成** by `create-tech-md-doc` skill | 生成时间：<时间>
> 对比分支：`<dev>` ←→ `<main>`（主分支为基线）
> diff 概览：<files> files changed, <ins> insertions(+), <del> deletions(-)
> PRD 参考：<pageId 或 URL 或「无」>
> 填充模块：2/3/4/5/6/8 +（有 PRD 时）1/7
> ⚠️ 内容基于代码 diff 推断，业务语义/PRD 链接需人工校对后补充。
```

## Common Mistakes

| 错误 | 后果 | 正解 |
|---|---|---|
| 直接 `git diff <main>...<dev>` 不加路径过滤 | 巨大 diff 灌进上下文 | 分层 `--name-only` 先列文件 |
| 把测试代码算进接口文档 | 混入 `*Test.java` | 排除 `src/test/**` |
| 编造业务语义 | 文档失真 | diff 看不到写"待补充" |
| 覆盖已存在文档 | 丢失人工补充 | 加 `_v2/_v3` |
| wiki 未配置仍硬跑 `--prd` | 拉取失败/编造 PRD | GATE 判停，回退纯-diff |

## Red Flags — STOP

- diff 单层 > 500 文件且无法过滤 → 停，让用户缩小分支范围
- dev 分支不存在或已删除 → 停
- 不在 git 仓库 → 停
- 用户只给一个分支 → 问另一个，不要默认 `master`
- 只给 `--prd` 没给两个分支 → `--prd` 不能替代分支参数，问 dev/main
- `--prd` URL 解析不出 pageId → 提示重提供，**不要**猜 pageId

## 与其他 skill 的关系

- **md-to-wiki**：本 skill 生成技术方案 md 后，用 md-to-wiki 发布到 Confluence wiki（`/md-to-wiki <md> <pageId>`）。wiki 连接配置共用 md-to-wiki 的 `wiki-config.json`。
- **create-release-md-doc**：上线方案；可串联 `--tech <path>` 复用本 skill 产出的技术方案。

## 沉淀到 DocNexus（可选，需用户授权）

文档生成并输出摘要后，若项目根存在 `docnexus/project.json` 且 `./node_modules/.bin/docnexus` 可执行：

- 从本次技术方案中挑出值得长期记住的内容（关键决策及原因、新约定、配置 / 依赖变化、已知风险与坑），列成简短清单，**询问用户是否沉淀到 DocNexus**。
- 用户明确同意后，按 DocNexus 的 capture 流程（入口 skill `docnexus`）写入，并回报写入位置 `docnexus/library/<path>`；用户未回复或拒绝 → 不写入。
- 只沉淀从 diff / PRD 确认过的事实；标注「待补充」「待人工确认」的推断内容不沉淀。
- 未检测到 DocNexus → 跳过本节，不提示安装。
