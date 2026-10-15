---
name: create-release-md-doc
description: "Generate a Markdown release/deployment plan (上线方案) from the diff between two git branches. Use when the user invokes /create-release-md-doc <devBranch> <mainBranch> [--prd <pageId|url>] [--tech <path>], or asks for a release plan / deployment plan / 上线方案 / 上线文档 / 发布方案 from a branch diff against master/main. --tech reuses an already-generated tech design doc; --prd merges a Confluence PRD for gray-release and verification scenarios. Not for technical design docs (create-tech-md-doc) or code changes (dev)."
---

# Create Release MD Doc

对比开发分支与主分支的 diff，按 6 模块上线方案模板生成 Markdown（固定填充模块一 / 二 / 四 / 五 / 六；有 PRD 时再填三）。技术方案回答「怎么开发」，上线方案回答「怎么上线」。

## Command Format

```
/create-release-md-doc <devBranch> <mainBranch> [--prd <pageId|url>] [--tech <path>]
```

- 两个分支都必填；用户只给一个时问另一个，不要默认 `master`。`--prd` / `--tech` 不能替代分支参数。
- `<mainBranch>` 用户没给但 `workflow/profile.json` 有 `main_branch` 时，可提出用它作为基线并请用户确认。
- `--tech <path>`：已生成的技术方案 md，复用其接口表 / 服务表 / DDL / 表名。
- `--prd`：Confluence PRD 的 pageId 或 URL，依赖 wiki 连接（见 Step 1）。

## Workflow

### Step 0 — 前置校验

1. `git rev-parse --is-inside-work-tree` 为 `true`，否则停。
2. 两个分支都能 `git rev-parse --verify`（或 `origin/<branch>`）；不存在 → 列出候选让用户挑，停。
3. 读 `workflow/profile.json`：发布平台、Region、配置中心、定时任务注解、是否需要数据评审都取自这里；未配置的写「待填写」，**不要沿用其他项目的取值**。

### Step 1 — PRD（仅传入 `--prd` 时）

wiki GATE：读 `md-to-wiki/wiki-config.json`，`enabled` 非 `true` 或 `wiki.base_url` 为空，且环境没有 wiki MCP 工具 → 告知「wiki 连接未配置，PRD 增强已跳过」，继续无 PRD 流程。GATE 通过 → 按 `references/prd.md` 拉取并抽取 `prd_context`。PRD 任何环节失败都只回退，不中止。

### Step 2 — 采集 diff 并抽取事实

按 `references/diff-collection.md` 执行：传入 `--tech` 时先解析技术方案复用其事实；其余层用三点 `<main>...<dev>` 分层采集。只写 diff 中可见的事实，看不到写「待补充」。有 `prd_context` 时做 PRD 对齐校验。

### Step 3 — 选模板并填充

- 模板：按 `workflow` skill「模板来源」取 `create-release-md-doc` 的 `template.md`。已接入 DocNexus 时**只用** `docnexus/library/templates/create-release-md-doc/template.md`，库里没有就停下并按该节提示导入，不回退到默认模板；未接入时依次取 `docs/skills/templates/create-release-md-doc/template.md`、本 skill 目录的 `template.md`。
- 填充来源：

| 模块 | 填充 | 来源 |
|---|---|---|
| 一 上线服务 | ✅ | git remote + 项目结构 + 改动范围 + `profile.deploy` |
| 二 中间件上线 | ✅ | DDL、实体、配置、构建文件、db_name；2.3 仅 `profile.data_review` 为 true 时输出 |
| 三 灰度方案 | 有 PRD 时 | `prd_context.grayRelease`；否则留「待人工补充」 |
| 四 上线后技术验证 | ✅ | 接口层 / `tech_context`；有 PRD 时追加业务场景 |
| 五 监控方案 | ✅ | 变更类名 / 方法名 + 定时任务 + topic |
| 六 回滚 / 止损 | ✅ | DDL / 配置 / 服务回滚推断；有 PRD 时追加对齐缺口 |

- 灰度、回滚策略属于推断内容，必须标「待人工确认」，不要写成已确定的方案。
- 文档开头写元信息：

```markdown
> **自动生成** by `create-release-md-doc` skill | 生成时间：<时间>
> 对比分支：`<dev>` ←→ `<main>`（主分支为基线）
> diff 概览：<files> files changed, <ins> insertions(+), <del> deletions(-)
> PRD 参考：<pageId 或 URL 或「无」/「PRD 增强已跳过」>
> 模板来源：<DocNexus / 项目文件 / skill 默认>
> 技术方案引用：<path 或「无」>
> 填充模块：1/2/4/5/6 +（有 PRD 时）3
> ⚠️ 灰度 / 回滚策略基于 diff 推断，需人工校对后补充。
```

### Step 4 — 写文件

- 路径：`docs/skills/create-release-md-doc/release-doc_<dev分支安全名>_<YYYYMMDD>.md`（分支名 `/` → `-`；目录不存在先创建）。
- 同路径已存在 → 加 `_v2`、`_v3`，不覆盖。
- 写完回读前 30 行确认格式，再把路径和摘要告诉用户。

### Step 5 — 后续（都需要用户同意）

- 发布到 wiki：`/md-to-wiki <文档路径> <pageId>`。
- 模板回写：用户对生成的文档做了结构性调整、且项目已接入 DocNexus 时，按 `workflow` skill「模板随知识库更新」提议同步回模板。
- 沉淀到 DocNexus（项目根有 `docnexus/project.json` 且 `./node_modules/.bin/docnexus` 可执行时）：列出值得长期记住的决策、配置 / 依赖变化、风险与坑，**询问用户**；同意后按 DocNexus 入口 skill `docnexus` 的 capture 流程写入并回报 `docnexus/library/<path>`。只沉淀确认过的事实，不沉淀「待补充」「待人工确认」的推断。未检测到 DocNexus 就跳过，不提示安装。

## Red Flags — STOP

- 不在 git 仓库；dev 分支不存在
- 只给了一个分支，或只给了 `--prd` / `--tech`
- 单层 diff > 500 个文件且无法再过滤 → 请用户缩小范围
- 正在编造灰度 / 回滚策略而没有标「待人工确认」
