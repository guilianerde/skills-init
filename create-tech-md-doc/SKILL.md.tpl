---
name: create-tech-md-doc
description: "Generate a Markdown technical design doc (技术方案) from the diff between two git branches. Use when the user invokes /create-tech-md-doc <devBranch> <mainBranch> [--prd <pageId|url>], or asks to generate a tech plan / technical design document / 技术方案 / 技术文档 from a branch diff against master/main, optionally merging a Confluence PRD. Not for release/deployment plans (create-release-md-doc), for writing code (dev), or for reviewing code (project-review)."
---

# Create Tech MD Doc

对比开发分支与主分支的 diff，按 8 模块技术方案模板生成 Markdown（固定填充模块 2 / 3 / 4 / 5 / 6 / 8；有 PRD 时再填 1 / 7）。

## Command Format

```
/create-tech-md-doc <devBranch> <mainBranch> [--prd <pageId|url>]
```

- 两个分支都必填；用户只给一个时问另一个，不要默认 `master`。`--prd` 不能替代分支参数。
- `<mainBranch>` 用户没给但 `workflow/profile.json` 有 `main_branch` 时，可提出用它作为基线并请用户确认。
- `--prd`：Confluence PRD 的 pageId 或 URL，依赖 wiki 连接（见 Step 1）。

## Workflow

### Step 0 — 前置校验

1. `git rev-parse --is-inside-work-tree` 为 `true`，否则停。
2. 两个分支都能 `git rev-parse --verify`（或 `origin/<branch>`）；不存在 → 列出 `git branch -a | grep -i <关键词>` 的候选让用户挑，停。
3. 读 `workflow/profile.json`：发布平台、Region、配置中心、定时任务注解、是否需要数据评审都取自这里；未配置的写「待填写」，**不要沿用其他项目的取值**。
4. DocNexus 可用时运行 `node <skills>/workflow/scripts/knowledge.mjs create-tech-md-doc --match <模块名 / 业务名词> --query "<一句话：本次改动做了什么>"`（模块名取分支名或 diff 涉及的模块），看以往技术方案沉淀的决策与约定、相关开发沉淀；相关的在文档对应模块引用 `docnexus/library/<path>`（见 `<skills>/workflow/references/docnexus.md`「按分类参考知识库」）。未接入就跳过。

### Step 1 — PRD（仅传入 `--prd` 时）

按 `references/prd-fetch.md` 判断 wiki 是否可用并拉取 PRD（不可用 → 告知「wiki 连接未配置，PRD 增强已跳过」，继续纯 diff 流程），再按 `references/prd.md` 抽取本文档需要的字段并做对齐校验。PRD 任何环节失败都只回退，不中止。

### Step 2 — 分层采集 diff 并抽取事实

按 `references/diff-collection.md` 执行：用三点 `<main>...<dev>`，先 `--name-only` 分层列文件，再读具体 diff；只写 diff 中可见的事实，看不到写「待补充」。有 `prd_context` 时做 PRD 对齐校验（同见 `references/prd.md`）。

### Step 3 — 选模板并填充

- 模板：在项目根运行 `node <skills>/workflow/scripts/resolve.mjs template create-tech-md-doc template.md`（`<skills>` 是本 skill 所在的 skills 目录，如 `.agents/skills`），读输出的 `path`，并把 `source` 写进元数据行。退出码 2 表示已接入 DocNexus 但知识库缺这份模板：**停下这一步**，按输出的 `hint` 处理，不要回退到默认模板。规则说明见 `<skills>/workflow/references/templates.md`。
- 填充来源：

| 模块 | 填充 | 来源 |
|---|---|---|
| 1 需求背景 | 有 PRD 时 | `prd_context`；无 PRD 留「待补充」 |
| 2 影响范围 | ✅ | 各层命中的模块 / 包名；代码图谱可用时补上 `cg.mjs impact --diff <main>...<dev>` 的受影响入口与模块（见 `<skills>/code-graph/SKILL.md`） |
| 3 详细方案 | ✅ | Service 变更；有 PRD 时补业务语义并标注来源 |
| 4 接口文档 | ✅ | 接口与消息层 |
| 5 涉及服务 | ✅ | git remote + 项目结构 + `profile.deploy` |
| 6 中间件变更 | ✅ | SQL、实体、配置、构建文件、定时任务 |
| 7 数据链路 | 有 PRD 且提及表名，或 `profile.data_review` 为 true | `prd_context.tables` / diff 推断 |
| 8 兼容问题&方案 | ✅ | diff 推断 + PRD 对齐缺口 |

- 文档开头写元信息：

```markdown
> **自动生成** by `create-tech-md-doc` skill | 生成时间：<时间>
> 对比分支：`<dev>` ←→ `<main>`（主分支为基线）
> diff 概览：<files> files changed, <ins> insertions(+), <del> deletions(-)
> PRD 参考：<pageId 或 URL 或「无」/「PRD 增强已跳过」>
> 模板来源：<DocNexus / 项目文件 / skill 默认>
> 填充模块：2/3/4/5/6/8 +（有 PRD 时）1/7
> ⚠️ 内容基于代码 diff 推断，业务语义需人工校对后补充。
```

### Step 4 — 写文件

- 路径：`docs/skills/create-tech-md-doc/tech-doc_<dev分支安全名>_<YYYYMMDD>.md`（分支名 `/` → `-`；目录不存在先创建）。
- 同路径已存在 → 加 `_v2`、`_v3`，不覆盖。
- 写完运行 `node <skills>/workflow/scripts/lint-doc.mjs <文档路径> --skill create-tech-md-doc --facts` 自检（`--facts` 按元信息行的对比分支核对正文里的类名、文件、接口、表名）：有「错误」先修正再交付（缺必填章节、残留 `{{...}}` 占位符、缺元信息行）；「警告」按实际情况处理，其中「在 diff 和代码里都找不到」的名字逐个核实：确属编造就改成 diff 里的真实名字或写「待补充」，是外部系统 / 配置中心的名字就保留；「提示」里的待填写位置在交付摘要中告诉用户。
- 再把路径和摘要告诉用户。

### Step 5 — 后续（都需要用户同意）

- 发布到 wiki：`/md-to-wiki <文档路径> [pageId]`（发布过的文档有发布记录，可省略 pageId）。
- 模板回写：用户对生成的文档做了结构性调整、且项目已接入 DocNexus 时，按 `<skills>/workflow/references/templates.md`「模板随知识库更新」提议同步回模板。
- 要上线：`/create-release-md-doc <dev> <main> --tech <文档路径>` 复用本文档的事实。
- 沉淀到 DocNexus（DocNexus 可用时，判定见 `<skills>/workflow/SKILL.md`「增强能力探测」）：列出值得长期记住的决策、约定、配置 / 依赖变化、风险，**询问用户**；同意后按 DocNexus 入口 skill `docnexus` 的 capture 流程写入，分类用 `node <skills>/workflow/scripts/resolve.mjs category create-tech-md-doc` 的结果作为调用方显式分类封存（见 `<skills>/workflow/references/docnexus.md`「写入 DocNexus 的分类」），并回报 `docnexus/library/<path>`。只沉淀确认过的事实，不沉淀「待补充」「待人工确认」的推断。未检测到 DocNexus 就跳过，不提示安装。

## Red Flags — STOP

- 不在 git 仓库；dev 分支不存在
- 只给了一个分支，或只给了 `--prd`
- 单层 diff > 500 个文件且无法再过滤 → 请用户缩小范围
- 正在编造 diff 中看不到的业务语义
