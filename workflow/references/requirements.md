# 产物按需求归档（dev / project-review / 技术方案 / 上线方案共用）

一个需求的全部产物放在同一个目录，整条链路一眼看全，`/workflow view` 也直接读这里。本工具的产出都在项目根的 `skills-init/` 里（需求产物、DocNexus 工作区、项目模板、临时文件），不往项目的其他地方写。默认 `skills-init/` 随代码提交（下图）；团队也可以把独立的文档仓库克隆到 `skills-init/`，见最后一节。

```
skills-init/docs/requirements/<需求名>/
├── meta.json          # 需求名、绑定的分支、各产物（种类、版本、日期、wiki 发布记录、DocNexus 沉淀）
├── plan.md            # 开发方案（dev，L 规模或用户要求时）
├── delivery.md        # 交付说明（dev）
├── review.md          # 审查报告（project-review）；复审 review_v2.md、review_v3.md
├── tech-doc.md        # 技术方案（create-tech-md-doc）
└── release-doc.md     # 上线方案（create-release-md-doc）
```

这个目录写在项目根的 `.ignore` 里，不参与代码搜索（找历史决策用 DocNexus）。读写一律按下面脚本给出的路径，不要靠搜索找这些文件，也不要自己拼路径。两种放法下各 skill 的做法完全一样，区别都在脚本里。

## 需求名：流程开始或第一次落盘时问用户

```
node <skills>/workflow/scripts/requirement.mjs which
```

- `bound: true`：当前分支已绑定需求，直接用，不再问。
- 退出码 2 且 `need_project`：独立文档仓库模式还没配项目名，按最后一节处理。
- `bound: false`：**问用户这个需求叫什么**，一句话即可，例如「订单导出支持按渠道筛选」。把 `suggested_name`（由分支名生成）作为默认值给出；`recent` 里有相关的需求时，也让用户可以选择继续那一个（例如修 bug 的新分支属于原来的需求）。然后：
  - 用户给了名字或选了已有的需求：`requirement.mjs bind --name "<需求名>"`；
  - 用户说不用起名、随便：`requirement.mjs bind`，按分支名生成。

  什么时候问：
  - dev：确定规模为 M / L、要落盘时（S 规模快速通道不落盘，不问）；
  - 从 `/workflow` 完整链路开始时；
  - 其他 skill：第一次落盘时。

  已经问过、绑定过的分支，后面的 skill 直接沿用。

一个需求可以绑定多个分支（`bind` 在其他分支上用同一个名字即可）。

## 落盘

```
node <skills>/workflow/scripts/requirement.mjs path <plan|delivery|review|tech|release>
```

- 输出的 `path` 就是要写的文件（相对项目根）。文档里引用产物（「参考产物」、上线方案引用技术方案等）写输出的 `cite`：默认模式下和 `path` 相同；文档仓库模式下是「文档仓库名:仓库内路径」，各服务、各人的克隆里都一样。同种产物已存在时会给出下一个版本（`_v2`、`_v3`），不覆盖旧版，复审靠它对照上次的报告。
- 退出码 2：当前分支还没绑定需求，按上一节问用户需求名，`bind` 之后再运行一次。
- `wiki_record` 非空：上一版已经发布到 wiki。新版的**第一行原样写这条记录**，md-to-wiki 再发布时会更新同一个页面，不会新建页面。
- 写完运行 `requirement.mjs sync <path>`，更新 `meta.json`。md-to-wiki 发布后改了第一行的记录，或补写了 DocNexus 元信息行，也要再 sync 一次。
- sync 输出里 `commit` 非空：按下一节「文档仓库的提交」处理。

## 独立文档仓库（克隆到 skills-init/）

团队想让代码仓库保持干净、或者一个需求横跨多个服务时，把团队文档仓库克隆到项目根的 `skills-init/`（在安装之前，或 `skills-init/` 还不存在时）：

```
git clone <团队文档仓库地址> skills-init
```

`skills-init/` 自己是 git 仓库就是这个模式，不用别的配置；安装 / 升级时代码仓库的 `.gitignore` 会加上 `/skills-init/`。

- 布局：`skills-init/docs/requirements/<需求名>/<项目名>/plan.md`、`delivery.md`……一个需求横跨多个服务时，各服务在同一个需求目录下各占一个子目录。绑定需求时 `which` 会列出 `other_projects`（其他服务已有、已拉到本地的需求），用同一个名字 `bind` 就加入了那个需求。
- DocNexus 也在这个仓库里（`skills-init/docnexus/`），各服务共用一个知识库。
- `project`：这个项目在文档仓库里的名字，写在 `workflow/profile.json` 的 `artifacts.project`（随代码提交，团队共用），**只需配置一次**。没配时脚本退出码 2（`need_project`）并给出 `suggested_project`（git 远端仓库名）：问用户一次，然后运行 `requirement.mjs config --project <项目名>`，之后一直沿用。
- 查看或修改配置：`requirement.mjs config [--project <项目名>] [--commit-prompt on|off] [--local]`。
- `/workflow view` 在这个模式下显示文档仓库里所有项目的需求，一个需求下按项目区分产物。

## 文档仓库的提交

文档仓库模式下，产物写在另一个 git 仓库里，不会随代码提交。sync 输出里 `commit` 非空时：

1. 把 `commit.files`（未提交的产物）和 `commit.suggested_message` 给用户看，问要不要提交。
2. 用户确认后，按 `commit.commands` 在文档仓库里提交；推送另外问用户，用户同意后再 `git -C skills-init push`。
3. 用户不想现在提交就跳过，不再追问；之后随时可以运行 `requirement.mjs pending` 看还有哪些没提交。

不想被提示的人可以关掉：`requirement.mjs config --commit-prompt off --local`。这个设置写在 `workflow/profile.local.json`（个人设置，不提交，只影响自己）；去掉 `--local` 则写进 `profile.json`，对整个团队生效。关掉后 sync 不再输出 `commit`，产物照常写到文档仓库，由自己决定什么时候提交。
