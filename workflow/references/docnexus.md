# DocNexus 读写约定

各 skill 写入与参考 DocNexus 时共用的规则。

## DocNexus 的运行位置

DocNexus 在业务项目根运行，使用 `.docnexus/node_modules/.bin/docnexus`；运行依赖、skills、草稿和索引都在 `.docnexus/`。初始化参数为 `init --output-dir workflow-run --agent none`，配置写入 `.docnexus/project.json`，知识输出在 `workflow-run/docnexus/`。

- 也可使用 `node <skills>/workflow/scripts/docnexus.mjs <参数>`，辅助脚本用 `node <skills>/workflow/scripts/docnexus.mjs --node .docnexus/skills/<…>.mjs <参数>`；所有路径都相对业务项目根。
- 使用 status 返回的 `workspace_path` / `library_path` / `internal_directory` 和 draft / document 返回的路径。不再做旧版的工作目录切换或前缀转换。知识读取和引用都写 `workflow-run/docnexus/library/<path>`。
- `resolve.mjs status` 给出 `root`、`internal`、`workspace` 与 `run`；`knowledge.mjs` 的 `path` 与 `file` 都是 CLI 返回的业务根相对路径；`resolve.mjs template` 给出模板实际位置。
- 不在 `workflow-run/` 内安装或初始化 DocNexus，不使用旧版根目录 `docnexus/` 的 CLI，也不回退到全局 CLI。缺失时通过 workflow-run 安装 / 升级修复。
- `workflow-run/` 是独立文档仓库时，知识输出可由多个服务共用；各服务仍在自己的业务根配置 `.docnexus/project.json`、运行本机 CLI。写入后 `requirement.mjs pending` 的 `knowledge_files`、`knowledge_commands` 给出知识仓库的待提交内容与命令，按既有授权提交，推送另行授权。

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

- 有 facts 时，每条 fact 的 `provenance` 写一条简单的来源，由你按这个格式写：`<产物种类> <产物路径>（<产物日期>）`，例如 `交付说明 workflow-run/docs/requirements/订单导出支持按渠道筛选/delivery.md（2026-10-15）`。没有 facts 就不写。
- 从知识库追溯回产物，靠的是产物里的「DocNexus：workflow-run/docnexus/library/<path>」元信息行（沉淀成功后写入）反查，`/workflow view` 会按需求列出沉淀到的知识文档，以及每篇来自哪份产物。不往 DocNexus 里多写内容。

## 按分类参考知识库

各 skill 开工前按分类看相关沉淀，再在这些分类内按问题检索：

```
node <skills>/workflow/scripts/knowledge.mjs <skill> [--match 词1,词2] [--limit 20] [--query "<一句话问题>" [--recall-limit 5]]
```

- 参考哪些分类由该 skill 的 `skill.json`（`docnexus.readFrom`，列出要参考哪些 skill 的沉淀）决定，分类名经 `resolve.mjs category` 解析，项目画像改名后自动跟上。
- 列表：每个分类下的文档（标题、摘要、`path`、更新时间，按更新时间倒序，不含正文）。`--match` 只按标题 / 摘要 / 标签 / 路径过滤，先用本次的模块名、业务名词，没结果再去掉 `--match` 看最近的几篇。
- `--query`：在每个分类内 `recall`，结果放在各分类的 `recall` 字段，能找到标题里没写、正文里提到的内容。问题写成一句话，带上模块名和业务名词，例如「订单列表按创建时间筛选 时区 分页」。
- 从列表和 recall 结果里挑与本次任务相关的读 `path`（普通 Markdown），引用时写 `workflow-run/docnexus/library/<path>`。需要跨分类找（例如别的团队的约定）时，仍可按 `docnexus-recall` 做不带分类的 `recall`。
- 退出码 2 表示必装组件 DocNexus 不可用；按 capabilities.md 修复后继续，不跳过知识库参考。查询或 recall 失败也不能当作无相关知识；只读，不写入。
