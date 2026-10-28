# 模板来源（文档类 skill 共用）

技术方案、上线方案、方案、审查清单的模板由脚本判定，各 skill 不自行查找：

```
node <skills>/workflow/scripts/resolve.mjs template <skill> <文件名>
```

`<skills>` 是本 Skill 所在的 skills 目录（如 `.agents/skills`）。开工快照的 `templates` 已包含解析结果；使用前按需用上述命令刷新。成功时读 `path`，`source` 固定为 `docnexus`。

DocNexus 是必装组件，知识库 `workflow-run/docnexus/library/templates/<skill>/<文件名>` 是唯一模板来源。包内模板仅用于首次导入，不作为运行时后备；`workflow-run/templates/` 里的旧项目模板不生效。必装组件不可用统一按 capabilities.md 修复。

缺少本次所需模板时停在该步骤，统一按输出处理：

- 有内置导入来源：运行 `npx @rowansenne/workflow-run seed-templates` 导入（已有的不覆盖），或经用户确认按 capture 流程把 `import_from` 写入 `expected`。
- `on_demand: true`：技术方案、上线方案没有内置模板，按下文「创建模板」请用户提供团队样例，不编造通用模板。
- 模板写入按 `doc-template` 分类封存。完成后刷新能力快照再继续；已有运行保存等待事项，不丢失进度。
- `stale_project_file` 非空：提示这是已不生效的旧文件，确认已导入知识库后再删除。

`resolve.mjs templates` 列出所有登记模板；登记表在各 Skill 的 `skill.json`。安装和升级自动补入内置模板。

## 修改模板（/workflow template）

用户要改某份模板（「技术方案模板加一节回滚」「上线方案去掉灰度那节」「审查报告的严重问题表加一列」），或要新建、按样例重做模板时，用 `template.mjs` 一路走完，不要直接编辑生效中的模板文件。`<模板>` 写别名 `requirement` / `tech` / `release` / `plan` / `delivery` / `review` / `checklist`，或 `<skill>/<文件名>`；没说哪份时先 `template.mjs list` 列出来问。

1. **起草稿**：`node <skills>/workflow/scripts/template.mjs draft <模板>`，把当前生效的模板复制到 `workflow-run/tmp/template-draft/<skill>/<文件名>`（输出的 `draft`）。草稿已存在会沿用（上次没改完）；要从当前模板重来加 `--force`。
   - 退出码 2、`need_sample: true`：还没有这份模板，按下面「创建模板」第 1 步向用户要样例，再运行 `draft <模板> --from <样例文件>`（从 stdin 读用 `--from -`）。用户要「按这份文档重做模板」时同样用 `--from`。
2. **按用户的要求改草稿**：只改草稿文件，遵守「创建模板」第 3 步的写法（必填 ` *`、可选「（如有）」、`{{...}}` 写填写说明、不留具体业务内容、不写标题前的元信息块）。用户只说了方向（如「加个回滚」）时，按团队已有章节的写法补全，拿不准的必填 / 可选问用户。
3. **校验**：`node <skills>/workflow/scripts/template.mjs check <模板>`。`errors` 非空先修草稿再跑；然后把结果讲给用户：
   - `changes`：新增 / 删除的章节、必填与可选标记的变化、顺序是否变了；
   - `impact`：最近几份已生成的文档按新模板会多出哪些错误（例如新的必填章节它们没有）。只影响以后生成和 lint，已有文档不会被改；
   - `warnings`：例如没有任何必填章节；
   - 附上草稿全文（或改动的部分）。
4. **用户确认后保存**：`node <skills>/workflow/scripts/template.mjs save <模板>`。它不直接写知识库，退出码 2：按输出的 `hint` 走 capture 流程把草稿写入知识库（写入要用户授权），完成后运行 `resolve.mjs template <skill> <文件名>` 确认 `path` 指向知识库里的那份，再删除草稿。改的是带默认版本的模板（requirement / plan / delivery / review / checklist）时，知识库里的版本取代默认版本，以后升级 skills 也不会覆盖它。
5. 用户想撤销：DocNexus 里的模板按 timeline 恢复旧版本。

## 创建模板

需要已接入 DocNexus。技术方案、上线方案第一次生成时没有模板，由用户给一份**团队现有的同类文档**作样例来创建。用户也可以随时主动要求「创建 / 重新生成技术方案（上线方案）模板」，流程相同。

1. **要样例**：停下来告诉用户还没有这份模板，请用户给一份团队现有的同类文档：本地 Markdown 路径，或 wiki 页面的 pageId / URL。
   - wiki 页面：运行 `node <skills>/md-to-wiki/scripts/upload.mjs get <pageId> --text`，取输出的 `text` 作样例（需要 wiki 已配置，沿用开工 wiki 通道；无通道时请用户导出成 Markdown 或直接贴出内容）。
   - 用户手头没有样例：请用户列出要哪些章节、每节写什么，按同样的格式整理成模板。不要自己编一份「通用模板」。
2. **抽骨架**：把样例存到临时文件（如 `workflow-run/tmp/template-sample.md`），运行 `node <skills>/workflow/scripts/template.mjs draft <模板> --from <样例文件>`（内部用 `make-template.mjs` 抽骨架，结果写进草稿，之后按「修改模板」第 2–4 步完善、校验、保存）。它保留标题层级和表格列，正文换成 `{{...}}` 填写提示，丢掉标题前的元信息块（元信息由生成文档的 skill 自己写）。
3. **完善**：在骨架上改：
   - 把每节的 `{{...}}` 改成具体的填写说明（这一节写什么、从哪类事实来，例如「受影响的接口、模块，带文件路径」），不要把样例里的具体业务内容留在模板里；
   - 必填章节在标题末尾加 ` *`，可选章节在标题里加「（如有）」：`lint-doc.mjs` 靠这两个标记检查生成的文档；
   - 对照这份 skill 会采集的事实（`references/diff-collection.md`），diff 能提供、但样例里没有对应章节的（例如配置、SQL、定时任务、回滚），列给用户问要不要加章节，不要擅自加。
4. **确认后保存**：`template.mjs check` 通过后把完整模板给用户看，用户确认后运行 `template.mjs save <模板>`（同「修改模板」第 4 步），按输出的 `hint` 走 capture 流程写入知识库（写入需要用户授权），以显式分类 `--category doc-template` 封存，metadata.category 也写 `doc-template`。
5. 保存后确认生效（`save` 输出 `effective: true`，或 DocNexus 写入后重新运行 `resolve.mjs template <skill> template.md`），再继续原来的生成步骤。

- **模板随知识库更新**：用户在生成的文档里做了结构性调整（新增 / 删除 / 重排章节、改表格列、改必填项）时，交付后列出这些调整，**询问**是否同步回模板；同意后按 DocNexus 的 capture 流程更新同一路径（先 `document get --include document,metadata,timeline` 取 `record_version`，以 `--base-version <record_version> --category doc-template` 封存，用户确认后 `document add --draft <id> --replace`），DocNexus 会在 timeline 中记录每次变更。只改结构，不把某次需求的具体内容写进模板。用户也可以说「改模板」走上面的「修改模板」，或直接编辑库里的模板文件，再用 `<docnexus.bin> document sync --id <id>` 采纳（`<docnexus.bin>` 取 `resolve.mjs status` 的输出）。
- 模板里的 `{{...}}` 是给 agent 看的填写提示，不是模板引擎语法；不要写成单独一行的 `{{fact:...}}`（那是 DocNexus 的事实引用语法）。
