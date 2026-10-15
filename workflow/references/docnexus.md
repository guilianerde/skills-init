# DocNexus 读写约定

各 skill 写入与参考 DocNexus 时共用的规则。

## 写入 DocNexus 的分类

各 skill 产出的内容写入 DocNexus 时，分类由产出它的 skill 显式指定，不交给 DocNexus 的模型分类，同一类产出始终落在同一个分类下，便于按分类浏览和检索。写入前在项目根运行：

```
node <skills>/workflow/scripts/resolve.mjs category <skill>
```

- 输出 `category`、`reason` 和 `seal_args`。按 DocNexus 的 capture 流程写入时，把它作为**调用方显式分类**交给入口 skill `docnexus`：`metadata.json` 的 `category` / `category_reason` 写这两个值，`draft seal` 追加 `seal_args`（即 `--category <category> --category-reason <reason>`）。审阅时向用户展示这个分类；入库（`document add`）不再传分类参数。
- 分类来源：`workflow/profile.json` 的 `docnexus_categories.<skill>` 优先，其次该 skill 的 `skill.json`（`docnexus.category`）。退出码 1 且 `error` 为 `none` 表示该 skill 不声明分类，按 DocNexus 默认流程由模型分类。
- 只约束本次写入；之后用户要调整分类，用 `docnexus document classify` 显式改，不受这里限制。
- 模板固定用 `doc-template`（见 `references/templates.md`），不经过这个命令。

## 按分类参考知识库

DocNexus 的 `search` / `recall` 按关键词跨全库检索，不能按分类过滤。各 skill 开工前另外按分类看一眼相关沉淀：

```
node <skills>/workflow/scripts/knowledge.mjs <skill> [--match 词1,词2] [--limit 20]
```

- 参考哪些分类由该 skill 的 `skill.json`（`docnexus.readFrom`，列出要参考哪些 skill 的沉淀）决定，分类名经 `resolve.mjs category` 解析，项目画像改名后自动跟上。
- 输出每个分类下的文档列表（标题、摘要、`path`、更新时间，按更新时间倒序，不含正文）。从中挑与本次任务相关的读 `path`（普通 Markdown），引用时写 `docnexus/library/<path>`。`--match` 按标题 / 摘要 / 标签 / 路径过滤，先用本次的模块名、业务名词，没结果再去掉 `--match` 看最近的几篇。
- 与关键词 `recall` 互补：`recall` 找全库里语义相关的内容，这里保证同类历史沉淀不被漏掉。
- 退出码 2 表示未接入 DocNexus，跳过即可；只读，不写入。
