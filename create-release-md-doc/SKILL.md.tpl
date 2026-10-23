---
name: create-release-md-doc
description: "Generate a Markdown release/deployment plan (上线方案) from the diff between two git branches. Use when the user invokes /create-release-md-doc <devBranch> <mainBranch> [--prd <pageId|url>] [--tech <path>], or asks for a release plan / deployment plan / 上线方案 / 上线文档 / 发布方案 from a branch diff against master/main. --tech reuses an already-generated tech design doc; --prd merges a Confluence PRD for gray-release and verification scenarios. The doc follows the project's own template; when none exists yet, or the user asks to create / regenerate it (创建上线方案模板 / 按这份文档生成模板 / 换个模板), build it from a sample doc the user provides. Not for technical design docs (create-tech-md-doc) or code changes (dev)."
---

# Create Release MD Doc

对比开发分支与主分支的 diff，按项目自己的上线方案模板生成 Markdown。模板不随 skills 提供：第一次使用时请用户给一份团队现有的上线方案作样例来创建（见 Step 3）。技术方案回答「怎么开发」，上线方案回答「怎么上线」。

## Command Format

```
/create-release-md-doc <devBranch> <mainBranch> [--prd <pageId|url>] [--tech <path>]
```

- 两个分支都必填；用户只给一个时问另一个，不要默认 `master`。`--prd` / `--tech` 不能替代分支参数。
- `<mainBranch>` 用户没给但 `workflow/profile.json` 有 `main_branch` 时，可提出用它作为基线并请用户确认。
- `--tech <path>`：已生成的技术方案 md，复用其接口表 / 服务表 / DDL / 表名。没传时运行 `node <skills>/workflow/scripts/artifacts.mjs --branch <devBranch>`，`latest.tech` 非空就自动引用这份（元数据行写「<path>（按分支自动关联）」，并在交付时告诉用户；用户说不用就按无技术方案处理）。同一份输出里 `latest.delivery`（dev 的交付说明）非空时也读它：「配置清单」「SQL 脚本（未执行）」「未验证项」分别并入配置下发、上线 SQL 与上线后验证，和 diff 不一致时以 diff 为准并在交付时指出；元数据行「交付说明引用」写它的路径。
- `--prd`：Confluence PRD 的 pageId 或 URL，依赖 wiki 连接（见 Step 1）。

## Workflow

### Step 0 — 前置校验

1. `git rev-parse --is-inside-work-tree` 为 `true`，否则停。
2. 两个分支都能 `git rev-parse --verify`（或 `origin/<branch>`）；不存在 → 列出候选让用户挑，停。
3. 读 `workflow/profile.json`：发布平台、Region、配置中心、定时任务注解、是否需要数据评审都取自这里；未配置的写「待填写」，**不要沿用其他项目的取值**。
4. DocNexus 可用时运行 `node <skills>/workflow/scripts/knowledge.mjs create-release-md-doc --match <模块名 / 业务名词> --query "<一句话：本次上线改了什么>"`（模块名取分支名或 diff 涉及的模块），看以往上线方案沉淀的风险、回滚要点与技术方案沉淀；相关的在文档对应章节引用 `workflow-run/docnexus/library/<path>`（见 `<skills>/workflow/references/docnexus.md`「按分类参考知识库」）。未接入就跳过。

**完整流程状态**：Step 0 通过后确定需求名、绑定目标 dev 分支，按 `<skills>/workflow/references/runs.md` 用 kind `release` 创建／恢复运行；带上 `--branch <dev分支>`，L0～L4 对应 Step 0～4。已完成步骤、PRD 跳过原因、模板等待／阻塞和证据都写 checkpoint；缺模板停下时不能丢失进度。Step 4 文档写完、自检和交付摘要完成后，将 L4 标 completed，再 complete 保存“已完成”与完成时间；Step 5 的可选下一步另行处理，不把 dev 的已完成记录覆盖成文档运行。

### Step 1 — PRD（仅传入 `--prd` 时）

按 `references/prd-fetch.md` 判断 wiki 是否可用并拉取 PRD（不可用 → 告知「wiki 连接未配置，PRD 增强已跳过」，继续无 PRD 流程），再按 `references/prd.md` 抽取本文档需要的字段并做对齐校验。PRD 任何环节失败都只回退，不中止。

### Step 2 — 采集 diff 并抽取事实

按 `references/diff-collection.md` 执行：有技术方案（`--tech` 或自动关联）时先解析它复用其事实；其余层用三点 `<main>...<dev>` 分层采集。只写 diff 中可见的事实，看不到写「待补充」。有 `prd_context` 时做 PRD 对齐校验。

### Step 3 — 选模板并填充

- 模板：在项目根运行 `node <skills>/workflow/scripts/resolve.mjs template create-release-md-doc template.md`（`<skills>` 是本 skill 所在的 skills 目录，如 `.agents/skills`），读输出的 `path`，并把 `source` 写进元数据行。上线方案模板**不随 skills 提供**，由各团队按自己 wiki 上的格式创建：
  - 退出码 2 且 `on_demand: true` → 还没有创建模板：**停下这一步**，按 `<skills>/workflow/references/templates.md`「创建模板」请用户给一份团队现有的上线方案作样例，生成模板、用户确认后保存到输出的 `expected`，再继续。不要自己编一份通用模板凑数。
  - 退出码 2 且 `need_docnexus: true` → 未接入 DocNexus：上线方案模板只保存在 DocNexus 里，**停下这一步**告诉用户先重跑 workflow-run 并加 `--with-docnexus` 接入，再按「创建模板」创建。不要另存到别处。
  - 退出码 2 的其他情况 → 按输出的 `hint` 处理。
  - 用户要修改、重新生成或换一份上线方案模板时，按 `<skills>/workflow/references/templates.md`「修改模板」用 `template.mjs` 处理（模板别名 `release`；按样例重做用 `draft release --from <样例>`），保存写入 DocNexus 知识库。
- 填充：模板的章节和编号因团队而异，**按章节含义**放事实，不按编号。下表是事实的来源，放进模板里含义对应的章节；模板里没有对应章节的事实不擅自加章节，在交付摘要里列出「模板中没有位置的事实」；模板有、但 diff 和 PRD 都给不出内容的章节写「待补充」。

| 事实 | 来源 |
|---|---|
| 上线服务 / 改动范围 | git remote + 项目结构 + 改动范围 + `profile.deploy` |
| 中间件上线（DDL / 配置 / 依赖） | DDL、实体、配置、构建文件；数据评审类章节仅 `profile.data_review` 为 true 时输出 |
| 灰度方案 | 有 PRD 时取 `prd_context.grayRelease`；否则写「待人工补充」 |
| 上线后验证 | 接口层 / `tech_context`；有 PRD 时追加业务场景；代码图谱可用时用 `cg.mjs impact --diff <main>...<dev>` 的 `entry_points` 补全要回归的接口 / 消费者 / 定时任务，`sql` / `config_keys` 对照中间件上线（见 `<skills>/code-graph/SKILL.md`） |
| 监控 | 变更类名 / 方法名 + 定时任务 + topic |
| 回滚 / 止损 | DDL / 配置 / 服务回滚推断；有 PRD 时追加对齐缺口 |

- 灰度、回滚策略属于推断内容，必须标「待人工确认」，不要写成已确定的方案。
- 文档开头写元信息：

```markdown
> **自动生成** by `create-release-md-doc` skill | 生成时间：<时间>
> 对比分支：`<dev>` ←→ `<main>`（主分支为基线）
> diff 概览：<files> files changed, <ins> insertions(+), <del> deletions(-)
> PRD 参考：<pageId 或 URL 或「无」/「PRD 增强已跳过」>
> 模板来源：<DocNexus / 项目文件>
> 技术方案引用：<path 或「无」>
> 交付说明引用：<path 或「无」>
> 待补充章节：<diff、PRD、技术方案都给不出内容的章节，没有写「无」>
> ⚠️ 灰度 / 回滚策略基于 diff 推断，需人工校对后补充。
```

### Step 4 — 写文件

- 路径：运行 `node <skills>/workflow/scripts/requirement.mjs path release --branch <dev分支>`，写到输出的 `path`（`workflow-run/docs/requirements/<需求名>/<项目名>/release-doc.md`，文件名固定；已有旧版时直接写新版，上一版由脚本归档到输出的 `previous`）。规则见 `<skills>/workflow/references/requirements.md`。
  - 退出码 2（这个分支还没绑定需求）：问用户这个需求叫什么，默认值用输出的 `suggested_name`，再 `requirement.mjs bind --name "<需求名>" --branch <dev分支>`；用户不给名字时 `bind` 按分支名生成。
  - `wiki_record` 非空：上一版已发布到 wiki，新版第一行原样写这条记录，重新发布时更新同一页面。
- 写完运行 `requirement.mjs sync <path>` 更新 `meta.json`；输出里 `archived` 非空（上一版已归档到 `workflow-run/tmp/old-artifacts/`）时告诉用户归档了哪些文件，请用户确认不再需要后自己删除；输出里 `commit` 非空（独立文档仓库模式）时按 `<skills>/workflow/references/requirements.md`「文档仓库的提交」处理。文档里引用其他产物（「参考产物」等）写 `requirement.mjs path` 输出的 `cite`。
- 写完运行 `node <skills>/workflow/scripts/lint-doc.mjs <文档路径> --skill create-release-md-doc --facts` 自检（`--facts` 按元信息行的对比分支核对正文里的类名、文件、接口、表名）：有「错误」先修正再交付（缺必填章节、残留 `{{...}}` 占位符、缺元信息行）；「警告」按实际情况处理，其中「在 diff 和代码里都找不到」的名字逐个核实：确属编造就改成 diff 里的真实名字或写「待补充」，是外部系统 / 配置中心的名字就保留；「提示」里的待填写位置在交付摘要中告诉用户。
- 再把路径和摘要告诉用户。

### Step 5 — 后续（都需要用户同意）

- 发布到 wiki：`/md-to-wiki <文档路径> [pageId]`（发布过的文档有发布记录，可省略 pageId）。
- 模板回写：用户对生成的文档做了结构性调整（新增 / 删除 / 重排章节、改表格列）时，问要不要同步回模板：未接入 DocNexus 时按「修改模板」用 `template.mjs draft / check / save release` 改（用户确认后保存）；已接入时按 `<skills>/workflow/references/templates.md`「模板随知识库更新」提议同步回模板。
- 沉淀到 DocNexus（DocNexus 可用时，判定见 `<skills>/workflow/SKILL.md`「增强能力探测」）：列出值得长期记住的决策、配置 / 依赖变化、风险与坑，**有值得记的才询问用户**，没有就跳过；同意后按 DocNexus 入口 skill `docnexus` 的 capture 流程写入，分类用 `node <skills>/workflow/scripts/resolve.mjs category create-release-md-doc` 的结果作为调用方显式分类封存（见 `<skills>/workflow/references/docnexus.md`「写入 DocNexus 的分类」），并回报 `workflow-run/docnexus/library/<path>`。只沉淀确认过的事实，不沉淀「待补充」「待人工确认」的推断。未检测到 DocNexus 就跳过，不提示安装。

## Red Flags — STOP

- 不在 git 仓库；dev 分支不存在
- 只给了一个分支，或只给了 `--prd` / `--tech`
- 单层 diff > 500 个文件且无法再过滤 → 请用户缩小范围
- 正在编造灰度 / 回滚策略而没有标「待人工确认」

## 终端命令

本 skill 给出的 `node …`、`git …` 命令在 bash、zsh、PowerShell 里写法一样，原样运行即可。需要自己写其他终端命令时，先看本机的系统和终端：`node <skills>/workflow/scripts/resolve.mjs env`（安装时记录，一次对话查一次就够；`resolve.mjs profile` / `status` 的输出里也带着 `env`）。按输出的 `os`、`shell`、`note` 写命令，不要再用 `uname`、`$PSVersionTable`、`ver` 之类去探测。
