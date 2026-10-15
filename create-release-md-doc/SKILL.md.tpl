---
name: create-release-md-doc
description: "Generate a Markdown release/deployment plan (上线方案) from the diff between two git branches. Use when the user invokes /create-release-md-doc <devBranch> <mainBranch>, optionally with --prd <pageId|url> to reference a Confluence PRD (fills gray-release/verification scenarios from business intent), and/or --tech <path> to reference an already-generated tech-design doc (reuse its interface list / DDL / table names to avoid re-running the diff). Also triggers when the user asks to generate a release plan / deployment plan / 上线方案 / 上线文档 / 发布方案 from a branch diff against master/main."
---

# Create Release MD Doc

从两个 git 分支的 diff 自动生成上线方案 Markdown 文档（6 模块结构）。

## Overview

**核心原理**：对比开发分支与主分支的代码 diff，提取受影响的服务、DDL、配置、接口、Job 等，按上线方案模板（`template.md`，与本 SKILL.md 同目录）的 6 个模块组织成 Markdown，输出到项目文档目录。

**与技术方案 skill 的关系**：技术方案（`create-tech-md-doc`）回答「怎么开发」，上线方案回答「怎么上线」。两者可独立使用，也可串联：先 `/create-tech-md-doc` 生成技术方案，再 `/create-release-md-doc --tech <path>` 复用其结构化事实，避免重复 diff。

**PRD 增强（可选，依赖 wiki 连接，`--prd`）**：拉取 Confluence PRD，把业务背景填进模块三（灰度方案）和模块四（验证场景）。
**技术方案引用（可选，`--tech`）**：传入已生成的技术方案 md 路径，解析提取其接口表/服务表/DDL/表名直接复用，跳过对应层 diff 采集。

## GATE — wiki 连接未配置时 PRD 增强不启动

本 skill 的 `--prd` 功能依赖 Confluence 连接。执行 `--prd` 前，先读同项目 `md-to-wiki` skill 目录下的 `wiki-config.json`（若找不到则找本 skill 目录旁的 `wiki-config.json`）：

- 文件缺失 / `enabled` 非 true / `wiki.base_url` 为空 → **`--prd` 功能不启动**：告知用户「wiki 连接未配置，PRD 增强已跳过」，回退无 PRD 流程。**文档生成主流程不受影响，不中止。**
- 配置通过 → 按下方 Step 2 拉取 PRD。

> 跨环境初始化时连接配置默认留空（enabled=false），因此 PRD 增强默认不生效；纯 diff 生成上线方案始终可用。

## When to Use

**触发条件（满足任一）：**
- 用户输入 `/create-release-md-doc <dev分支> <主分支>`（精确命令）
- 用户输入 `/create-release-md-doc <dev分支> <主分支> --prd <pageId|url>`（带 PRD 参考）
- 用户输入 `/create-release-md-doc <dev分支> <主分支> --tech <path>`（引用技术方案）
- 用户要求"根据两个分支的 diff 生成上线方案 / 发布方案 / 上线文档 / release plan"，并可选提供 PRD 或技术方案路径

**不适用：**
- 只想看 diff 概览（用 `git diff --stat` 即可）
- 单分支、无对比基线
- 非 git 仓库

## Command Format

```
/create-release-md-doc <devBranch> <mainBranch> [--prd <pageId|url>] [--tech <path>]
```

- `<devBranch>`：开发/特性分支（被对比方）
- `<mainBranch>`：项目主分支（对比基线，如 `master` / `main`）
- `--prd`（可选）：PRD 参考，Confluence pageId 或 URL（`pageId=(\d+)` 自动解析）。从 Confluence 拉取，填模块三（灰度）与模块四（验证场景）
- `--tech <path>`（可选）：已生成的技术方案 md 路径，复用其结构化事实（接口表/服务表/DDL/表名）

两个分支参数必填。`--prd` / `--tech` 可选。若用户只给一个分支，把另一个作为参数再问一次；不要猜测。

## Workflow

严格按顺序执行。

### Step 0 — 校验前置条件

1. **确认在 git 仓库内**：`git rev-parse --is-inside-work-tree` 为 true，否则停。
2. **校验分支存在**：`git rev-parse --verify <branch>`（或 `origin/<branch>`）；不存在 → 列出候选分支让用户挑，停。

> **判停**：分支不存在 → 停。其余项不阻塞。

### Step 1 — 采集 diff（分层过滤）

> **项目画像**：主分支默认取 `workflow/profile.json` 的 `main_branch`；下表路径过滤以 Java/Spring 工程为默认，其他技术栈按项目实际目录调整（如 Go 的 `internal/handler`、前端的 `src/api`）。发布平台、配置中心、定时任务注解、是否需要数据评审同样取自 profile，未配置的部分在文档中写「待填写」，不要沿用其他项目的取值。

> **diff 基线必须用三点 `<main>...<dev>`**：比较的是 dev 相对两分支合并基点（merge-base）的改动。两点 `<main>..<dev>` 等价于直接比较两个分支末端，主干前进后会把主干新提交以「反向删除」混进文档。

| 层 | 命令（路径过滤） | 用途 | 喂给哪个模块 |
|---|---|---|---|
| 1. Controller | `git diff <main>...<dev> --name-only -- '**/controller/**'` | 接口验证 | 四.接口验证 |
| 2. Service/Impl | `-- '**/service/**'` | 业务影响 | 一.改动范围 |
| 3. SQL | `-- '*.sql' '**/db/**' '**/migration/**'` | DDL | 二.中间件 |
| 4. 配置 | `-- '**/application*.yml' '*.properties' 'bootstrap*.yml'` | 配置中心 / 开关 | 二.中间件 |
| 5. pom | `-- 'pom.xml' '**/pom.xml'` | 依赖 | 二.中间件 |
| 6. Job | `-- '**/job/**' '**/*Job.java'` | 定时任务 | 五.监控 |

**排除项**：`src/test/**`、`**/generated/**`、`**/target/**`、`*.md`、`*.txt`。
**巨量 diff 兜底**：单层 > 200 文件 → `--stat` + 每文件前 80 行摘要，标注"⚠️ 已摘要化"。
**统计行**：`git diff <main>...<dev> --shortstat` 写进元信息。

> 若传入了 `--tech <path>`：先解析技术方案 md，提取模块 4 接口表 / 模块 5 服务表 / 模块 6 DDL / 模块 7 表名 → `tech_context`；对应层直接复用 `tech_context`，跳过该层 diff 采集。

### Step 2 — 获取 PRD（仅当传入 `--prd` 且 GATE 通过）

1. **解析 pageId**：纯数字直接用；URL 正则 `[?&]pageId=(\d+)`；失败 → 提示，回退无 PRD 流程（不中止）。
2. **拉取页面**：环境的 wiki 能力（MCP `mcp__wiki-mcp__get_page({pageId, expand: "body.storage,version"})` 或 REST `GET {base_url}/rest/api/content/{pageId}?expand=body.storage`，凭据从 `wiki-config.json` 读）。取 `body.storage`。
3. **HTML → 可读文本**：剥离 storage 标签，保留标题/表格/列表/段落。
4. **抽取 `prd_context`**：`title`、`background`、`features`、`tables`、`grayRelease`（灰度/开关描述）、`verifyScenarios`（验证场景）、`pageUrl`。只抽事实，不臆造。

> **判停**：`--prd` 解析不出 pageId / GATE 未通过 / 拉取失败 → 回退无 PRD 流程，元信息标注「PRD 增强已跳过」。绝不因 PRD 失败中止。

### Step 3 — 提取结构化信息

**3a. 从 diff 抽取事实（必做，纯 git）**：DDL 原样保留；Entity 新增字段（字段+类型+@TableField）；配置新增（key+用途+值）；Kafka topic（如有）；接口路径+方法（Controller diff）；db_name 推断（SQL `USE` → datasource url → 表名前缀，不确定标"待人工确认"）；受影响模块/包名汇总（改动范围）。只读 diff 内可见事实，看不到写"待补充"。

**3b. PRD 对齐校验（仅 `prd_context != null`）**：PRD 功能点 vs diff 实现语义对齐 → 模块六追加「对齐缺口 / 实现超出 PRD」清单。

### Step 4 — 填充模板 6 个模块

读取 `template.md`（与本 SKILL.md 同目录），按实况填充：

| 模块 | 是否填 | 数据来源 |
|---|---|---|
| 一. 上线服务 | ✅ | git remote + 项目结构 + 改动范围 |
| 二. 中间件上线 | ✅ | DDL + Entity + 配置 + pom + db_name |
| 三. 灰度方案 | 有 PRD 时从 PRD 填；否则留"待人工补充" | `prd_context.grayRelease` |
| 四. 上线后技术验证 | ✅ | Controller diff / `tech_context` 接口表；PRD 时追加业务场景 |
| 五. 监控方案 | ✅ | diff 类名/方法名 + Job + topic |
| 六. 回滚/止损 | ✅ | DDL/配置/服务回滚推断；PRD 时追加对齐缺口 |

### Step 5 — 写文件

输出路径（项目统一产物目录，各环境一致）：
`docs/skills/create-release-md-doc/release-doc_<dev分支安全名>_<YYYYMMDD>.md`
- 目录不存在时先创建；分支名 `/` → `-`；日期用今天；同路径已存在 → `_v2`/`_v3`
- 写完后 Read 回读前 30 行确认格式，再给用户路径

## 文档元信息（写进生成文档的开头）

```markdown
> **自动生成** by `create-release-md-doc` skill | 生成时间：<时间>
> 对比分支：`<dev>` ←→ `<main>`（主分支为基线）
> diff 概览：<files> files changed, <ins> insertions(+), <del> deletions(-)
> PRD 参考：<pageId 或 URL 或「无」>
> 技术方案引用：<path 或「无」>
> 填充模块：1/2/4/5/6 +（有 PRD 时）3
> ⚠️ 灰度/回滚策略基于 diff 推断，需人工校对后补充。
```

## Common Mistakes

| 错误 | 后果 | 正解 |
|---|---|---|
| 不加路径过滤直接 diff | 巨大 diff 灌进上下文 | 分层 `--name-only` |
| 把测试代码算进影响范围 | 上线方案失真 | 排除 `src/test/**` |
| wiki 未配置硬跑 `--prd` | 拉取失败/编造 PRD | GATE 判停，回退无 PRD |
| 覆盖已存在文档 | 丢失人工补充 | `_v2/_v3` |
| 编造灰度/回滚策略 | 上线风险 | diff 推断 + 标注"待人工确认" |

## Red Flags — STOP

- dev 分支不存在或已删除 → 停
- 不在 git 仓库 → 停
- 用户只给一个分支 → 问另一个，不要默认 `master`
- 只给 `--prd`/`--tech` 没给两个分支 → 选项不能替代分支参数，问 dev/main
- `--prd` URL 解析不出 pageId → 提示重提供，**不要**猜 pageId

## 与其他 skill 的关系

- **create-tech-md-doc**：技术方案生成。本 skill 可用 `--tech <path>` 复用其结构化事实。
- **md-to-wiki**：本 skill 生成上线方案 md 后，用 md-to-wiki 发布到 Confluence wiki。wiki 连接配置共用 md-to-wiki 的 `wiki-config.json`。

## 沉淀到 DocNexus（可选，需用户授权）

文档生成并输出摘要后，若项目根存在 `docnexus/project.json` 且 `./node_modules/.bin/docnexus` 可执行：

- 从本次上线方案中挑出值得长期记住的内容（关键决策及原因、新约定、配置 / 依赖变化、已知风险与坑），列成简短清单，**询问用户是否沉淀到 DocNexus**。
- 用户明确同意后，按 DocNexus 的 capture 流程（入口 skill `docnexus`）写入，并回报写入位置 `docnexus/library/<path>`；用户未回复或拒绝 → 不写入。
- 只沉淀从 diff / PRD 确认过的事实；标注「待补充」「待人工确认」的推断内容不沉淀。
- 未检测到 DocNexus → 跳过本节，不提示安装。
