# 产物按需求归档（dev / project-review / 技术方案 / 上线方案共用）

一个需求的全部产物放在同一个目录，整条链路一眼看全，以后的可视化也直接读这里：

```
docs/skills/requirements/<需求名>/
├── meta.json          # 需求名、绑定的分支、各产物（种类、版本、日期、wiki 发布记录、DocNexus 沉淀）
├── plan.md            # 开发方案（dev，L 规模或用户要求时）
├── delivery.md        # 交付说明（dev）
├── review.md          # 审查报告（project-review）；复审 review_v2.md、review_v3.md
├── tech-doc.md        # 技术方案（create-tech-md-doc）
└── release-doc.md     # 上线方案（create-release-md-doc）
```

这个目录写在项目根的 `.ignore` 里，不参与代码搜索（找历史决策用 DocNexus）。读写一律按下面脚本给出的路径，不要靠搜索找这些文件，也不要自己拼路径。

## 需求名：流程开始或第一次落盘时问用户

```
node <skills>/workflow/scripts/requirement.mjs which
```

- `bound: true`：当前分支已绑定需求，直接用，不再问。
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

- 输出的 `path` 就是要写的文件。同种产物已存在时会给出下一个版本（`_v2`、`_v3`），不覆盖旧版，复审靠它对照上次的报告。
- 退出码 2：当前分支还没绑定需求，按上一节问用户需求名，`bind` 之后再运行一次。
- `wiki_record` 非空：上一版已经发布到 wiki。新版的**第一行原样写这条记录**，md-to-wiki 再发布时会更新同一个页面，不会新建页面。
- 写完运行 `requirement.mjs sync <path>`，更新 `meta.json`。md-to-wiki 发布后改了第一行的记录，或补写了 DocNexus 元信息行，也要再 sync 一次。

`artifacts.mjs`、`report.mjs`、`pr-desc.mjs` 同时识别需求目录和旧版的 `docs/skills/<skill>/` 布局。升级时安装器会把旧文件按「对比分支」搬进需求目录（用 `git mv`，保留历史），并把文档里引用的旧路径改成新路径（搬迁记录在 `meta.json` 的 `migrated_from`）；认不出分支的文件留在原处。
