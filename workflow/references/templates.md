# 模板来源（文档类 skill 共用）

技术方案、上线方案、开发方案、审查清单的模板由脚本判定，各 skill 不自行查找：

```
node <skills>/workflow/scripts/resolve.mjs template <skill> <文件名>
```

`<skills>` 是本 skill 所在的 skills 目录（如 `.agents/skills`），在项目根执行。输出 JSON：`path` 是要读的模板，`source` 是 `docnexus` / `project` / `default`，写进产出的「模板来源」。判定规则（实现在脚本里，这里只是说明）：

- **已接入 DocNexus**：只用 `docnexus/library/templates/<skill>/<文件名>`（分类 `doc-template`，普通 Markdown，手工改动立即生效）。不使用 skill 默认模板，也不使用 `docs/skills/templates/`——知识库是唯一来源，避免几份模板各自演化。
  - 缺模板时退出码 2，输出 `expected`（应在的位置）、`import_from`（可导入的来源）和 `hint`。**停下这一步**，告诉用户缺哪份模板，给两个选择：在项目根运行 `skills-init seed-templates`（或重跑安装加 `--seed-templates`）；或者由你在用户确认后按 DocNexus 的 capture 流程把 `import_from` 写入 `expected`，以显式分类封存（`draft seal ... --category doc-template`，metadata.category 也写 `doc-template`）。导入后再继续。
  - 输出里 `stale_project_file` 非空：提醒用户 `docs/skills/templates/` 下的这份已不再生效，建议导入后删除。
- **未接入 DocNexus**：先取项目文件 `docs/skills/templates/<skill>/<文件名>`，没有就用 skill 默认模板。
- **技术方案、上线方案没有默认模板**（`create-tech-md-doc`、`create-release-md-doc` 的 `template.md`）：各团队发到 wiki 的格式不同，skills 不再自带一份固定格式。还没创建时退出码 2，输出 `on_demand: true`、`expected`（创建后保存的位置：接入 DocNexus 时是知识库，否则是项目文件）和 `hint`，按下面「创建模板」处理。老项目升级时，安装器会把原来在用的默认版本保存到项目模板目录，不受影响。

`resolve.mjs templates` 列出所有登记模板的来源；登记表在各 skill 的 `skill.json`（`templates` 字段）。`--with-docnexus` 接入时会自动导入默认模板，之后可运行 `skills-init seed-templates` 补导入（已存在的不覆盖）。

## 创建模板

技术方案、上线方案第一次生成时没有模板，由用户给一份**团队现有的同类文档**作样例来创建。用户也可以随时主动要求「创建 / 重新生成技术方案（上线方案）模板」，流程相同。

1. **要样例**：停下来告诉用户还没有这份模板，请用户给一份团队现有的同类文档：本地 Markdown 路径，或 wiki 页面的 pageId / URL。
   - wiki 页面：运行 `node <skills>/md-to-wiki/scripts/upload.mjs get <pageId> --text`，取输出的 `text` 作样例（需要 wiki 已配置，见 `<skills>/workflow/SKILL.md`「增强能力探测」；没配置就请用户导出成 Markdown 或直接贴出内容）。
   - 用户手头没有样例：请用户列出要哪些章节、每节写什么，按同样的格式整理成模板。不要自己编一份「通用模板」。
2. **抽骨架**：把样例存到临时文件（如 `tmp/skills/template-sample.md`），运行 `node <skills>/workflow/scripts/make-template.mjs <样例文件>`。它保留标题层级和表格列，正文换成 `{{...}}` 填写提示，丢掉标题前的元信息块（元信息由生成文档的 skill 自己写）。
3. **完善**：在骨架上改：
   - 把每节的 `{{...}}` 改成具体的填写说明（这一节写什么、从哪类事实来，例如「受影响的接口、模块，带文件路径」），不要把样例里的具体业务内容留在模板里；
   - 必填章节在标题末尾加 ` *`，可选章节在标题里加「（如有）」：`lint-doc.mjs` 靠这两个标记检查生成的文档；
   - 对照这份 skill 会采集的事实（`references/diff-collection.md`），diff 能提供、但样例里没有对应章节的（例如配置、SQL、定时任务、回滚），列给用户问要不要加章节，不要擅自加。
4. **确认后保存**：把完整模板给用户看，用户确认后写到 `resolve.mjs` 输出的 `expected`：
   - 未接入 DocNexus：直接写文件 `docs/skills/templates/<skill>/template.md`，建议随代码提交，团队共用；
   - 已接入 DocNexus：按 DocNexus 的 capture 流程写入 `expected`（写入需要用户授权），以显式分类 `--category doc-template` 封存，metadata.category 也写 `doc-template`。
5. 保存后重新运行 `resolve.mjs template <skill> template.md` 确认能取到，再继续原来的生成步骤。

- **模板随知识库更新**：用户在生成的文档里做了结构性调整（新增 / 删除 / 重排章节、改表格列、改必填项），且项目已接入 DocNexus 时，交付后列出这些调整，**询问**是否同步回模板；同意后按 DocNexus 的 capture 流程更新同一路径（先 `document get --include document,metadata,timeline` 取 `record_version`，以 `--base-version <record_version> --category doc-template` 封存，用户确认后 `document add --draft <id> --replace`），DocNexus 会在 timeline 中记录每次变更。只改结构，不把某次需求的具体内容写进模板。用户也可以直接编辑库里的模板文件，再用 `<docnexus.bin> document sync --id <id>` 采纳（`<docnexus.bin>` 取 `resolve.mjs status` 的输出）。
- 模板里的 `{{...}}` 是给 agent 看的填写提示，不是模板引擎语法；不要写成单独一行的 `{{fact:...}}`（那是 DocNexus 的事实引用语法）。
