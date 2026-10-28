# 产物按需求归档（dev / project-review / 技术方案 / 上线方案共用）

本约定只适用于工作流的正式需求产物。普通聊天生成的报告、分析、方案、草稿、导出等辅助文件默认放在项目根的 `workflow-run/other/`（可按主题建子目录，需要时创建），即使当前分支已绑定需求，也不调用 `bind / path / sync` 或 `run.mjs`，不写需求 `meta.json`，不进入需求统计和文档视图。单独执行 project-review、技术方案或上线方案等工作流仍按本约定归档。源码、测试、配置和已有文件的维护、工作流指定的临时目录与知识库沿用各自路径；用户明确指定输出路径时以用户为准，不自动搬移已有文件。

一个需求的全部产物放在同一个目录，整条链路一眼看全，`/workflow view` 也直接读这里。本工具的产出都在项目根的 `workflow-run/` 里（需求产物、DocNexus 工作区、项目模板、临时文件），不往项目的其他地方写。默认 `workflow-run/` 随代码提交；团队也可以让 `workflow-run/` 成为独立的文档仓库，见最后一节。两种用法的目录结构完全一样（下图），切换时文件不用挪。

```
workflow-run/docs/requirements/<需求名>/<项目名>/
├── meta.json          # 运行记录 runs（阶段、步骤完成标记、等待决定、上下文、完成时间）及 需求名、绑定的分支、各产物（种类、版本、日期、wiki 发布记录、DocNexus 沉淀）
├── requirement.md     # 需求文档（F3 / B3 收尾；目标、范围、AC 验收与澄清决定）
├── plan.md            # 方案（dev，非快速通道都写；S / M 简版；缺陷修复追加修复方案节）
├── delivery.md        # 交付说明（dev，完整流程审查后用户选择交付才生成；S 快速通道不落盘）
├── review.md          # 审查报告（独立 project-review 或 dev 完整流程的自查；S 快速通道不落盘）；复审也写这个文件，上一版归档（见「落盘」）
├── tech-doc.md        # 技术方案（create-tech-md-doc）
└── release-doc.md     # 上线方案（create-release-md-doc）
```

一个需求横跨多个服务时，各服务在同一个需求目录下各占一个 `<项目名>/`。项目名是 `workflow/profile.json` 的 `artifacts.project`：随代码提交时不用配置，脚本取 git 远端仓库名，第一次 `bind` 时写进 `profile.json` 固定下来；独立文档仓库时要先配置（见最后一节）。

这个目录写在项目根的 `.ignore` 里，不参与代码搜索（找历史决策用 DocNexus）。读写一律按下面脚本给出的路径，不要靠搜索找这些文件，也不要自己拼路径。两种用法下各 skill 的做法完全一样，区别都在脚本里。

## 需求名：流程开始时问用户

dev 先按 Step 0 确定本次工作分支，再查询绑定和确认需求名。之后如果新建或切换分支，重新运行 `which`，不沿用旧分支的绑定结果或自动读到的名字；只有用户明确确认继续同一需求时，才把该名字用于新分支。

```
node <skills>/workflow/scripts/requirement.mjs which
```

- `bound: true`：当前分支已绑定需求，直接用，不再问。
- 退出码 2 且 `need_project`：独立文档仓库模式还没配项目名，按最后一节处理。
- `bound: false`：**问用户这个需求叫什么**，一句话即可，例如「订单导出支持按渠道筛选」。把 `suggested_name`（由分支名生成）作为默认值给出；`recent` 里有相关的需求时，也让用户可以选择继续那一个（例如修 bug 的新分支属于原来的需求）。先只确认名字，第一次需要落盘时再 `bind`：
  - 落盘时用户给了名字或选了已有的需求：`requirement.mjs bind --name "<需求名>"`；
  - 用户说不用起名、随便：`requirement.mjs bind`，按分支名生成；
  - 用户给不出名字、也说不清这次要做什么：**不开始流程**（dev 停在 F1 之前）。

  什么时候问 / 绑定：
  - dev：Step 0 就问（从 `/workflow` 进来时沿用已确认的名字，不再问）；完整流程第一次落盘前 `bind`（S 快速通道只问不 bind）；
  - 从 `/workflow` 完整链路开始时：只问名字、不 bind，把名字交给接下来的 skill；
  - 其他 skill：第一次落盘时问并 bind；对话里已经给过名字就直接用，不再问。

  已经问过、绑定过的分支，后面的 skill 直接沿用；只问过、还没 bind 的，沿用对话里给出的名字。

一个需求可以绑定多个分支（`bind` 在其他分支上用同一个名字即可）。

完整开发 / 修复的首个文档为 F3 / B3 收尾的 requirement.md，绑定和 start 在此时发生；plan.md 随后记录实现设计与需求版本。需求、方案各自版本化，已有历史文档不自动改写。S 快速通道始终不绑定、不落盘；退出快速通道先补需求文档再补方案。

## 运行状态

完整流程在本文件的 `runs` 中按运行 id 保存进度，关联分支；同一需求可有多次运行。`status: completed` 和 `completed_at` 是本次运行已完成的明确标记，步骤也单独记录 completed。保存／恢复和各 skill 的记录时机见 `runs.md`；快速通道不创建记录。`sync` 只重建产物索引，保留 runs 和其他扩展字段；重新 bind 也不会清空历史。元信息采用原子写入与短时写锁，状态更新另有 revision 检查。

## 落盘

正式产物先写 `workflow-run/tmp/` 草稿，统一按 [execution.md](execution.md) 用 `artifact.mjs finalize --id <运行id> --expect-revision <revision> --kind <requirement|plan|delivery|review|tech|release> --draft <草稿>` 收尾。命令校验当前步骤、分支与知识模板，归档旧版、发布文件、更新索引／版本并登记运行证据；requirement 在 F3 / B3，plan 在 F4 / B4，方案记录依据的需求版本；review 还须 packet 与结构化 result，delivery 须本轮有效交付选择。不要直接覆盖正式文件后只 sync。

- 输出 path（相对项目根）、cite（跨文档引用）、previous（上一版归档）、version 和 run。文件名固定，目录只留最新版；文档仓库模式的 cite 为「文档仓库名:仓库内路径」。
- 旧版归档在 `workflow-run/tmp/old-artifacts/<需求>/<项目>/<种类>_v<N>.md`，不提交；告诉用户归档了什么，不替用户删除。相同命令重试不重复升级版本或状态。
- 原文第一行的 md-to-wiki 页面记录自动保留，新版仍发布同一页；不能在普通文档收尾中替换页面归属。
- 文件发布与元信息不能跨文件一次原子提交。待完成收尾保存在同一 meta.json；中断先 `artifact.mjs resume --id <id>`，不能继续 sync / save 越过待办。代码或正文冲突时停止，取消和恢复规则见 execution.md。
- `requirement.mjs path <种类>` 仍保留为底层旧接口（会预先复制归档），不作为新流程的写入入口。查询已有产物用 artifacts / list，正式写入与 cite 用 finalize 输出。
- wiki 发布或知识沉淀更新文档元信息后显式 `requirement.mjs sync <path>`。sync 重建索引并保留 runs；需求绑定只由 bind 修改，不根据文档头隐式新增。
- 文档／索引不一致、元信息损坏或引用缺失进入只读诊断；文件存在不代表运行完成。确认正文后显式 sync，损坏的 meta 先人工核对修复。已有旧运行缺少新证据时回到对应阶段重新收尾／验证，不自动补用户确认。
- 独立文档仓库在允许提示提交的阶段运行 `requirement.mjs pending`，沿用下节规则；dev 内部审查延后到 F8。

## 独立文档仓库

团队想让代码仓库保持干净、或者一个需求横跨多个服务时，用户在项目根运行（由用户执行，克隆可能要他们自己认证）：

```
npx @rowansenne/workflow-run docs-repo <团队文档仓库地址> [--project <项目名>]
```

`workflow-run/` 里还没有内容时它直接克隆；已经有产物、DocNexus 时原地 `git init` 接上远端（目录结构相同，文件不用挪；和远端同路径冲突时退回原状并列出冲突的文件）。然后代码仓库的 `.gitignore` 加 `/workflow-run/`，并配置好项目名。`workflow-run/` 自己是 git 仓库就是这个模式，不用别的配置。

- 布局和随代码提交时一样。绑定需求时 `which` 会列出 `other_projects`（其他服务已有、已拉到本地的需求），用同一个名字 `bind` 就加入了那个需求。
- DocNexus 也在这个仓库里（`workflow-run/docnexus/`），各服务共用一个知识库。
- `project`：这个项目在文档仓库里的名字，写在 `workflow/profile.json` 的 `artifacts.project`（随代码提交，团队共用），**只需配置一次**；随代码提交时已经自动写过的就直接沿用。没配时脚本退出码 2（`need_project`）并给出 `suggested_project`（git 远端仓库名）：问用户一次，然后运行 `requirement.mjs config --project <项目名>`，之后一直沿用。
- 查看或修改配置：`requirement.mjs config [--project <项目名>] [--commit-prompt on|off] [--local]`。
- `/workflow view` 在这个模式下显示文档仓库里所有项目的需求，一个需求下按项目区分产物。

## 文档仓库的提交

文档仓库模式下，产物写在另一个 git 仓库里，不会随代码提交。finalize 后运行 pending（或旧 sync 返回 commit 非空）时：

**dev F7 审查例外**：审查环节（独立子 agent 或当前会话自查）拿到 `commit` 信息后不询问、不执行文档提交，先交审查报告、等待用户选择修复或交付。选择交付进入 F8 后（完整流程；S 快速通道不落盘，没有待提交产物），再运行 `requirement.mjs pending` 获取当前待提交内容，按下面步骤询问；修复与复审期间继续延后，不改动 `commit_prompt` 配置。

1. 把 pending 的 `files`（旧 sync 为 commit.files）和 `suggested_message` 给用户看，问要不要提交。
2. 用户确认后，按 pending 的 `commands`（旧 sync 为 commit.commands） 在文档仓库里提交；推送另外问用户，用户同意后再 `git -C workflow-run push`。
3. 用户不想现在提交就跳过，不再追问；之后随时可以运行 `requirement.mjs pending` 看还有哪些没提交。

不想被提示的人可以关掉：`requirement.mjs config --commit-prompt off --local`。这个设置写在 `workflow/profile.local.json`（个人设置，不提交，只影响自己）；去掉 `--local` 则写进 `profile.json`，对整个团队生效。关掉后 sync 不再输出 `commit`，产物照常写到文档仓库，由自己决定什么时候提交。
