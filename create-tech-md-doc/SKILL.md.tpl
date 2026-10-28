---
name: create-tech-md-doc
description: "Generate a Markdown technical design doc (技术方案) from the diff between two git branches. Use when the user invokes /create-tech-md-doc <devBranch> <mainBranch> [--prd <pageId|url>], or asks to generate a tech plan / technical design document / 技术方案 / 技术文档 from a branch diff against master/main, optionally merging a Confluence PRD. The doc follows the project's own template; when none exists yet, or the user asks to create / regenerate it (创建技术方案模板 / 按这份文档生成模板 / 换个模板), build it from a sample doc the user provides. Not for release/deployment plans (create-release-md-doc), for writing code (dev), or for reviewing code (project-review)."
---

# Create Tech MD Doc

**开工能力**：先运行 `node <skills>/workflow/scripts/resolve.mjs status`，按 `<skills>/workflow/references/capabilities.md` 选择本轮能力与模板；同一项目链路复用已有快照，失败统一按该规则处理。

对比开发分支与主分支的 diff，按项目自己的技术方案模板生成 Markdown。模板不随 skills 提供：第一次使用时请用户给一份团队现有的技术方案作样例来创建（见 Step 3）。

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
2. 两个分支都能 `git rev-parse --verify`（或 `origin/<branch>`）；不存在 → 列出 `git branch -a -i --list "*<关键词>*"` 的候选让用户挑，停。
3. 读 `workflow/profile.json`：发布平台、Region、配置中心、定时任务注解、是否需要数据评审都取自这里；未配置的写「待填写」，**不要沿用其他项目的取值**。
4. 运行 `node <skills>/workflow/scripts/knowledge.mjs create-tech-md-doc --match <模块名 / 业务名词> --query "<一句话：本次改动做了什么>"`（模块名取分支名或 diff 涉及的模块），看以往技术方案沉淀的决策与约定、相关开发沉淀；相关的在文档对应章节引用 `workflow-run/docnexus/library/<path>`（见 `<skills>/workflow/references/docnexus.md`「按分类参考知识库」）。

**完整流程状态**：Step 0 通过后确定需求名、绑定目标 dev 分支，按 `<skills>/workflow/references/runs.md` 用 kind `tech` 创建／恢复运行；带上 `--branch <dev分支>`，T0～T4 对应 Step 0～4。已完成步骤、PRD 跳过原因、模板等待／阻塞和证据都写 checkpoint；缺模板停下时不能丢失进度。Step 4 文档写完、自检和交付摘要完成后，将 T4 标 completed，再 complete 保存“已完成”与完成时间；Step 5 的可选下一步另行处理，不把 dev 的已完成记录覆盖成文档运行。

### Step 1 — PRD（仅传入 `--prd` 时）

按本轮 wiki 通道与 `references/prd-fetch.md` 拉取 PRD，再按 `references/prd.md` 抽取本文档需要的字段并做对齐校验。PRD 任何环节失败都只回退，不中止。

### Step 2 — 分层采集 diff 并抽取事实

按 `references/diff-collection.md` 执行：用三点 `<main>...<dev>`，先 `--name-only` 分层列文件，再读具体 diff；只写 diff 中可见的事实，看不到写「待补充」。有 `prd_context` 时做 PRD 对齐校验（同见 `references/prd.md`）。

### Step 3 — 选模板并填充

- 模板：在项目根运行 `node <skills>/workflow/scripts/resolve.mjs template create-tech-md-doc template.md`（`<skills>` 是本 skill 所在的 skills 目录，如 `.agents/skills`），读输出的 `path`，并把 `source` 写进元数据行。模板缺失统一按 `workflow/references/templates.md` 创建或导入。
  - 用户要修改、重新生成或换一份技术方案模板时，按 `<skills>/workflow/references/templates.md`「修改模板」用 `template.mjs` 处理（模板别名 `tech`；按样例重做用 `draft tech --from <样例>`），保存写入 DocNexus 知识库。
- 填充：模板的章节和编号因团队而异，**按章节含义**放事实，不按编号。下表是事实的来源，放进模板里含义对应的章节；模板里没有对应章节的事实不擅自加章节，在交付摘要里列出「模板中没有位置的事实」；模板有、但 diff 和 PRD 都给不出内容的章节写「待补充」。

| 事实 | 来源 |
|---|---|
| 需求背景 | 优先引用同分支 `latest.requirement` 的目标、范围与澄清结论；外部 PRD 用 `prd_context` 并标来源；都没有写「待补充」 |
| 影响范围 | 各层命中的模块 / 包名；代码图谱可用时补上 `cg.mjs impact --diff <main>...<dev>` 的受影响入口与模块（见 `<skills>/code-graph/SKILL.md`） |
| 详细方案 | Service 变更；有 PRD 时补业务语义并标注来源 |
| 接口 / 消息协议 / 字段变更 | 接口与消息层、DTO / VO |
| 涉及服务 | git remote + 项目结构 + `profile.deploy` |
| 中间件变更（DB / 配置 / 依赖 / 定时任务） | SQL、实体、配置、构建文件、定时任务；代码图谱可用时对照 `impact` 的 `sql` / `config_keys` |
| 数据链路 / 数据评审 | 有 PRD 且提及表名，或 `profile.data_review` 为 true 时；`prd_context.tables` / diff 推断 |
| 兼容问题与方案、PRD 对齐缺口 | diff 推断 + PRD 对齐缺口（见 `references/prd.md`） |

- 文档开头写元信息：

```markdown
> **自动生成** by `create-tech-md-doc` skill | 生成时间：<时间>
> 对比分支：`<dev>` ←→ `<main>`（主分支为基线）
> diff 概览：<files> files changed, <ins> insertions(+), <del> deletions(-)
> PRD 参考：<pageId 或 URL 或「无」/「PRD 增强已跳过」>
> 模板来源：<DocNexus / 项目文件>
> 待补充章节：<diff 和 PRD 都给不出内容的章节，没有写「无」>
> ⚠️ 内容基于代码 diff 推断，业务语义需人工校对后补充。
```

### Step 4 — 写文件

- 正式收尾：Step 4 进入 T4，先写 `workflow-run/tmp/tech-doc.md` 草稿，再用 `node <skills>/workflow/scripts/artifact.mjs finalize --id <运行id> --expect-revision <revision> --kind tech --draft <草稿> --branch <dev分支>` 自检、归档旧版、发布并更新索引／运行证据；使用返回的 path / cite，规则见 `<skills>/workflow/references/execution.md`。
- 收尾输出 previous 非空时告诉用户上一版的归档位置，不能替用户删除；中断先 `artifact.mjs resume --id <运行id>`。独立文档仓库的提交提示用 `requirement.mjs pending`，按 requirements.md 处理；后续 wiki／沉淀元信息仍可显式 sync。
- 收尾前对草稿运行 `node <skills>/workflow/scripts/lint-doc.mjs <草稿> --skill create-tech-md-doc --facts` 自检（`--facts` 按元信息行的对比分支核对正文里的类名、文件、接口、表名）：有「错误」先修正再交付（缺必填章节、残留 `{{...}}` 占位符、缺元信息行）；「警告」按实际情况处理，其中「在 diff 和代码里都找不到」的名字逐个核实：确属编造就改成 diff 里的真实名字或写「待补充」，是外部系统 / 配置中心的名字就保留；「提示」里的待填写位置在交付摘要中告诉用户。
- 再把路径和摘要告诉用户。

### Step 5 — 后续（都需要用户同意）

- 发布到 wiki：`/md-to-wiki <文档路径> [pageId]`（发布过的文档有发布记录，可省略 pageId）。
- 模板回写：用户对生成的文档做了结构性调整（新增 / 删除 / 重排章节、改表格列）时，问要不要同步回模板：按 `<skills>/workflow/references/templates.md`「模板随知识库更新」提议同步回模板。
- 要上线：`/create-release-md-doc <dev> <main> --tech <文档路径>` 复用本文档的事实。
- 沉淀到 DocNexus：列出值得长期记住的决策、约定、配置 / 依赖变化、风险，**有值得记的才询问用户**，没有就跳过；同意后按 DocNexus 入口 skill `docnexus` 的 capture 流程写入，分类用 `node <skills>/workflow/scripts/resolve.mjs category create-tech-md-doc` 的结果作为调用方显式分类封存（见 `<skills>/workflow/references/docnexus.md`「写入 DocNexus 的分类」），并回报 `workflow-run/docnexus/library/<path>`。只沉淀确认过的事实，不沉淀「待补充」「待人工确认」的推断。

## Red Flags — STOP

- 不在 git 仓库；dev 分支不存在
- 只给了一个分支，或只给了 `--prd`
- 单层 diff > 500 个文件且无法再过滤 → 请用户缩小范围
- 正在编造 diff 中看不到的业务语义

## 终端命令

本 skill 给出的 `node …`、`git …` 命令在 bash、zsh、PowerShell 里写法一样，原样运行即可。需要自己写其他终端命令时，先看本机的系统和终端：`node <skills>/workflow/scripts/resolve.mjs env`（安装时记录，一次对话查一次就够；`resolve.mjs profile` / `status` 的输出里也带着 `env`）。按输出的 `os`、`shell`、`note` 写命令，不要再用 `uname`、`$PSVersionTable`、`ver` 之类去探测。
