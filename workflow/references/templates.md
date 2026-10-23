# 模板来源（文档类 skill 共用）

技术方案、上线方案、方案、审查清单的模板由脚本判定，各 skill 不自行查找：

```
node <skills>/workflow/scripts/resolve.mjs template <skill> <文件名>
```

`<skills>` 是本 skill 所在的 skills 目录（如 `.agents/skills`），在项目根执行。输出 JSON：`path` 是要读的模板，`source` 是 `docnexus` / `default`，写进产出的「模板来源」。

**skills 自带的默认模板只读**：不要直接编辑 skills 目录里的模板文件（升级时会被覆盖），也不要在 `workflow-run/templates/` 放项目模板（已不再生效）。要改模板只有一条路：写进 DocNexus 知识库，团队通过知识库共享同一份。

判定规则（实现在脚本里，这里只是说明）：

- **已接入 DocNexus**：只用 `workflow-run/docnexus/library/templates/<skill>/<文件名>`（分类 `doc-template`，普通 Markdown，手工改动立即生效）。不使用 skill 默认模板，也不使用 `workflow-run/templates/`——知识库是唯一来源，避免几份模板各自演化。
  - 缺模板时退出码 2，输出 `expected`（应在的位置）、`import_from`（可导入的来源）和 `hint`。**停下这一步**，告诉用户缺哪份模板，给两个选择：在项目根运行 `npx @rowansenne/workflow-run seed-templates`（或重跑安装加 `--seed-templates`）；或者由你在用户确认后按 DocNexus 的 capture 流程把 `import_from` 写入 `expected`，以显式分类封存（`draft seal ... --category doc-template`，metadata.category 也写 `doc-template`）。导入后再继续。
- **未接入 DocNexus**：只用 skill 默认模板，不能修改或新建模板。
- 输出里 `stale_project_file` 非空：`workflow-run/templates/` 下的这份已不再生效，提醒用户导入 DocNexus 后删除（未接入时先接入）。
- **技术方案、上线方案没有默认模板**（`create-tech-md-doc`、`create-release-md-doc` 的 `template.md`）：各团队发到 wiki 的格式不同，skills 不自带固定格式，第一次使用时按样例创建到知识库。
  - 已接入 DocNexus、还没创建：退出码 2，输出 `on_demand: true`、`expected`（知识库里的位置）和 `hint`，按下面「创建模板」处理。
  - 未接入 DocNexus：退出码 2，输出 `need_docnexus: true` 和 `hint`。**停下这一步**，告诉用户这两类文档的模板只保存在 DocNexus 里，要先重跑 npx @rowansenne/workflow-run 并加 `--with-docnexus` 接入，再创建模板。不要自己编一份模板凑数。

`resolve.mjs templates` 列出所有登记模板的来源；登记表在各 skill 的 `skill.json`（`templates` 字段）。`--with-docnexus` 接入时会自动导入默认模板，之后可运行 `npx @rowansenne/workflow-run seed-templates` 补导入（已存在的不覆盖）。

## 修改模板（/workflow template）

用户要改某份模板（「技术方案模板加一节回滚」「上线方案去掉灰度那节」「审查报告的严重问题表加一列」），或要新建、按样例重做模板时，用 `template.mjs` 一路走完，不要直接编辑生效中的模板文件。未接入 DocNexus 时 `draft` / `save` 退出码 2、输出 `need_docnexus: true`：告诉用户默认模板不能改，要先接入 DocNexus（重跑 npx @rowansenne/workflow-run 并加 `--with-docnexus`），不要另找地方保存。`<模板>` 写别名 `tech` / `release` / `plan` / `delivery` / `review` / `checklist`，或 `<skill>/<文件名>`；没说哪份时先 `template.mjs list` 列出来问。

1. **起草稿**：`node <skills>/workflow/scripts/template.mjs draft <模板>`，把当前生效的模板复制到 `workflow-run/tmp/template-draft/<skill>/<文件名>`（输出的 `draft`）。草稿已存在会沿用（上次没改完）；要从当前模板重来加 `--force`。
   - 退出码 2、`need_sample: true`：还没有这份模板，按下面「创建模板」第 1 步向用户要样例，再运行 `draft <模板> --from <样例文件>`（从 stdin 读用 `--from -`）。用户要「按这份文档重做模板」时同样用 `--from`。
2. **按用户的要求改草稿**：只改草稿文件，遵守「创建模板」第 3 步的写法（必填 ` *`、可选「（如有）」、`{{...}}` 写填写说明、不留具体业务内容、不写标题前的元信息块）。用户只说了方向（如「加个回滚」）时，按团队已有章节的写法补全，拿不准的必填 / 可选问用户。
3. **校验**：`node <skills>/workflow/scripts/template.mjs check <模板>`。`errors` 非空先修草稿再跑；然后把结果讲给用户：
   - `changes`：新增 / 删除的章节、必填与可选标记的变化、顺序是否变了；
   - `impact`：最近几份已生成的文档按新模板会多出哪些错误（例如新的必填章节它们没有）。只影响以后生成和 lint，已有文档不会被改；
   - `warnings`：例如没有任何必填章节；
   - 附上草稿全文（或改动的部分）。
4. **用户确认后保存**：`node <skills>/workflow/scripts/template.mjs save <模板>`。它不直接写知识库，退出码 2：按输出的 `hint` 走 capture 流程把草稿写入知识库（写入要用户授权），完成后运行 `resolve.mjs template <skill> <文件名>` 确认 `path` 指向知识库里的那份，再删除草稿。改的是带默认版本的模板（plan / delivery / review / checklist）时，知识库里的版本取代默认版本，以后升级 skills 也不会覆盖它。
5. 用户想撤销：DocNexus 里的模板按 timeline 恢复旧版本。

## 创建模板

需要已接入 DocNexus。技术方案、上线方案第一次生成时没有模板，由用户给一份**团队现有的同类文档**作样例来创建。用户也可以随时主动要求「创建 / 重新生成技术方案（上线方案）模板」，流程相同。

1. **要样例**：停下来告诉用户还没有这份模板，请用户给一份团队现有的同类文档：本地 Markdown 路径，或 wiki 页面的 pageId / URL。
   - wiki 页面：运行 `node <skills>/md-to-wiki/scripts/upload.mjs get <pageId> --text`，取输出的 `text` 作样例（需要 wiki 已配置，见 `<skills>/workflow/SKILL.md`「增强能力探测」；没配置就请用户导出成 Markdown 或直接贴出内容）。
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
