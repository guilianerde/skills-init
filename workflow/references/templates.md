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

`resolve.mjs templates` 列出所有登记模板的来源；登记表在各 skill 的 `skill.json`（`templates` 字段）。`--with-docnexus` 接入时会自动导入默认模板，之后可运行 `skills-init seed-templates` 补导入（已存在的不覆盖）。

- **模板随知识库更新**：用户在生成的文档里做了结构性调整（新增 / 删除 / 重排章节、改表格列、改必填项），且项目已接入 DocNexus 时，交付后列出这些调整，**询问**是否同步回模板；同意后按 DocNexus 的 capture 流程更新同一路径（先 `document get --include document,metadata,timeline` 取 `record_version`，以 `--base-version <record_version> --category doc-template` 封存，用户确认后 `document add --draft <id> --replace`），DocNexus 会在 timeline 中记录每次变更。只改结构，不把某次需求的具体内容写进模板。用户也可以直接编辑库里的模板文件，再用 `docnexus document sync --id <id>` 采纳。
- 模板里的 `{{...}}` 是给 agent 看的填写提示，不是模板引擎语法；不要写成单独一行的 `{{fact:...}}`（那是 DocNexus 的事实引用语法）。
