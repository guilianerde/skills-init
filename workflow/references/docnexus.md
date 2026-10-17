# DocNexus 读写约定

各 skill 写入与参考 DocNexus 时共用的规则。

## DocNexus 在团队文档仓库里

DocNexus 默认装在本项目的 `docnexus/`。团队把产物和知识库放进同一个文档仓库时（`workflow/profile.json` 的 `docnexus.root`，例如 `../team-docs`，安装时用 `skills-init --with-docnexus --docnexus-root ../team-docs`），工作区在 `<docnexus.root>/docnexus/`，`resolve.mjs status` 的 `docnexus.root` 不是 `.`：

- DocNexus 以 `docnexus.root` 为项目根。docnexus 系列 skill（`docnexus`、`docnexus-recall` 等）里写的「在项目根运行 `./docnexus/node_modules/.bin/docnexus …`」「`node docnexus/skills/…`」，都先切到那个目录再运行：`cd <docnexus.root> && ./docnexus/node_modules/.bin/docnexus …`（`status` 的 `run_in` 就是这个前缀）。草稿、`docnexus/library/<path>` 等路径也相对那个目录，读写文件时加上它，例如 `../team-docs/docnexus/library/<path>`。
- 本工作流的脚本已处理位置：`knowledge.mjs` 在那里运行，输出的 `file` 是从本项目读正文的路径；`resolve.mjs template` 给出的模板路径、`expected` 都已带上位置。
- 引用知识文档仍写 `docnexus/library/<path>`（产物里的「DocNexus：」行也一样）。产物和知识库在同一个仓库里，这个路径相对的就是那个仓库。
- 知识库由共用这个仓库的各服务一起使用：按分类参考和 recall 都会看到其他服务的沉淀，引用前确认和本次任务相关。
- 写入（capture）完成后，知识库的改动在文档仓库里：运行 `requirement.mjs pending`，`knowledge_files` 是知识库里没提交的文件，`knowledge_commands` 是提交命令（把提交信息换成这次沉淀了什么）。和产物一样，给用户看、用户确认后再提交，推送另外问（见 `references/requirements.md`「文档仓库的提交」）。

## 写入 DocNexus 的分类

各 skill 产出的内容写入 DocNexus 时，分类由产出它的 skill 显式指定，不交给 DocNexus 的模型分类，同一类产出始终落在同一个分类下，便于按分类浏览和检索。写入前在项目根运行：

```
node <skills>/workflow/scripts/resolve.mjs category <skill>
```

- 输出 `category`、`reason` 和 `seal_args`。按 DocNexus 的 capture 流程写入时，把它作为**调用方显式分类**交给入口 skill `docnexus`：`metadata.json` 的 `category` / `category_reason` 写这两个值，`draft seal` 追加 `seal_args`（即 `--category <category> --category-reason <reason>`）。审阅时向用户展示这个分类；入库（`document add`）不再传分类参数。
- 分类来源：`workflow/profile.json` 的 `docnexus_categories.<skill>` 优先，其次该 skill 的 `skill.json`（`docnexus.category`）。退出码 1 且 `error` 为 `none` 表示该 skill 不声明分类，按 DocNexus 默认流程由模型分类。
- 只约束本次写入；之后用户要调整分类，用 `docnexus document classify` 显式改，不受这里限制。
- 模板固定用 `doc-template`（见 `references/templates.md`），不经过这个命令。

## 沉淀的来源

DocNexus 按它自己的设计使用：沉淀文档的正文只写知识（约定、决定、坑、根因），不写分支名、产物路径这类工作流信息，免得进入 recall 的检索索引造成干扰，也免得知识文档和工作流的目录结构绑在一起。

- 有 facts 时，每条 fact 的 `provenance` 写一条简单的来源，由你按这个格式写：`<产物种类> <产物路径>（<产物日期>）`，例如 `交付说明 docs/skills/requirements/订单导出支持按渠道筛选/delivery.md（2026-10-15）`。没有 facts 就不写。
- 从知识库追溯回产物，靠的是产物里的「DocNexus：docnexus/library/<path>」元信息行（沉淀成功后写入）反查，`/workflow view` 会按需求列出沉淀到的知识文档，以及每篇来自哪份产物。不往 DocNexus 里多写内容。

## 按分类参考知识库

各 skill 开工前按分类看相关沉淀，再在这些分类内按问题检索：

```
node <skills>/workflow/scripts/knowledge.mjs <skill> [--match 词1,词2] [--limit 20] [--query "<一句话问题>" [--recall-limit 5]]
```

- 参考哪些分类由该 skill 的 `skill.json`（`docnexus.readFrom`，列出要参考哪些 skill 的沉淀）决定，分类名经 `resolve.mjs category` 解析，项目画像改名后自动跟上。
- 列表：每个分类下的文档（标题、摘要、`path`、更新时间，按更新时间倒序，不含正文）。`--match` 只按标题 / 摘要 / 标签 / 路径过滤，先用本次的模块名、业务名词，没结果再去掉 `--match` 看最近的几篇。
- `--query`：在每个分类内 `recall`（DocNexus 0.16.0 起支持 `recall --category`），结果放在各分类的 `recall` 字段，能找到标题里没写、正文里提到的内容。问题写成一句话，带上模块名和业务名词，例如「订单列表按创建时间筛选 时区 分页」。
  - 输出 `recall_by_category: false`（已装的 DocNexus 不支持按分类 recall）→ 按入口 skill `docnexus-recall` 做不带分类的 `recall`，再按列表里的分类 / 路径挑结果。
- 从列表和 recall 结果里挑与本次任务相关的读 `path`（普通 Markdown），引用时写 `docnexus/library/<path>`。需要跨分类找（例如别的团队的约定）时，仍可按 `docnexus-recall` 做不带分类的 `recall`。
- 退出码 2 表示未接入 DocNexus，跳过即可；只读，不写入。
