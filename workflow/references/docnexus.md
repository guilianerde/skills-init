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

## 沉淀的来源

DocNexus 入库时存的是内容副本，不记原始文件路径。为了从知识库能追溯回产物（交付说明、审查报告等），各 skill 沉淀前在项目根运行：

```
node <skills>/workflow/scripts/requirement.mjs provenance <产物路径>
```

输出的 `provenance` 是统一格式的来源，包含产物种类、需求名、分支、日期和路径，例如：

```
交付说明 · 需求「订单导出支持按渠道筛选」· 分支 feature/order-export · 2026-10-15 · docs/skills/requirements/订单导出支持按渠道筛选/delivery.md
```

- 原样写进每条 fact 的 `provenance`（`metadata.facts[].provenance`），不要改写或缩短。
- 同时写进沉淀文档正文末尾固定的一节：

  ```
  ## 来源

  - <provenance 原文>
  ```

  facts 是可选的，正文这一节保证一定有来源记录。一篇沉淀综合了多份产物（例如交付说明加审查报告）时，每份各写一行。更新已有沉淀时保留原来的来源行，再追加本次的。
- 路径以后可能变（迁移、改名），所以需求名、种类和日期也一并写进去，靠它们在 `/workflow view` 里还能找回原文件。
- 旧布局的产物（`docs/skills/<skill>/`）也能用：取不到需求名时只写分支。
- 反向链接不变：沉淀成功后，产物的「DocNexus」元信息行写 `docnexus/library/<path>`。

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
