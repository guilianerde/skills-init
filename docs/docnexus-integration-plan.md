# DocNexus format 7 接入方案

日期：2026-10-21。以本机 `/Users/rowansen/Documents/project/docNeuxs` 的 `@rowansenne/docnexus` 0.23.0 源码为准。本次为破坏性更新，不兼容旧布局，不迁移旧知识。

## 安装和目录

在业务项目根执行：

```bash
npm install --prefix ./.docnexus --save-exact @rowansenne/docnexus
./.docnexus/node_modules/.bin/docnexus init --output-dir workflow-run --agent none
```

- `.docnexus/`：npm 清单、运行依赖、format 7 项目配置、skills、schema、草稿和索引。
- `workflow-run/docnexus/`：CONCEPTS.md、concepts、library、records 和 impacts。
- `workflow-run/docs/requirements/`、`workflow-run/tmp/`：工作流产物与临时文件。

`.docnexus/project.json` 的 `output_dir` 固定为 `workflow-run`。DocNexus 的项目根即业务项目根，所有 CLI 返回路径直接使用。npm 包默认从注册表安装，本地与离线验证通过 `DOCNEXUS_PKG` 指定来源，不在发布配置里写入本机绝对路径。

## 旧版清理

每次 init / upgrade 在写入新版 skills 和运行 npm 之前执行清理：

1. 删除含旧 `project.json`、npm、skills、drafts、schemas、store 等内部文件的 `workflow-run/docnexus/`；旧知识一并删除。
2. 删除 `workflow-run/.docnexus/` 和旧重复安装备份 `workflow-run/tmp/duplicate-docnexus/`。
3. 删除识别出的根目录旧 `docnexus/` 安装和指向旧 skills 的链接；清除不兼容的 `.docnexus/` 项目状态，npm 安装保留供更新。
4. 清除旧的嵌套 Agent skill 与接入说明；刷新业务项目根的 Agent 说明与入口。

不归档、不合并、不尝试兼容旧版本。链接只删除链接本身，不删除外部目标。普通同名业务目录、需求文档和其他临时文件保留。清理失败停止安装。

新版知识输出不含旧内部文件，重装、升级不会删除新版知识。docnexus-layout.mjs 提供安装器与运行脚本共用的位置和配置判定，避免两边各维护一套规则。

## Agent 接入

官方 skills 直接从 `.docnexus/skills/` 链接给 Agent。新版官方 skill 已支持读取 `status` 的输出路径，取消此前的工作目录换算和上游 skill 适配副本方案。

- Codex / 豆包：`.agents/skills/`，说明写入 AGENTS.md。
- Claude：`.claude/skills/`，说明写入 CLAUDE.md。
- Qwen：`.qwen/skills/`，说明写入 QWEN.md。
- WorkBuddy：`.codebuddy/skills/`，说明写入 AGENTS.md。

说明中区分 `.docnexus/` 内部状态与 `workflow-run/docnexus/` 知识。CLI 可直接使用 `./.docnexus/node_modules/.bin/docnexus`；跨平台包装脚本仍保留并在业务项目根运行。

## 配套功能

- 模板导入：使用 CLI 返回的 `.docnexus/drafts/...` 路径，知识存入 `workflow-run/docnexus/library/templates/...`。
- 知识检索：直接使用返回的业务项目相对路径，按分类 recall 不再保留旧版降级。
- doctor：检测旧布局，检查 format 7 / output_dir、Agent 链接与说明、模板完整性；只读报告。
- 独立文档仓库：只共享 `workflow-run/` 中的知识输出；各业务项目保存自己的 `.docnexus/project.json` 和运行环境。
- uninstall：解除 `.docnexus/skills/` 的 Agent 链接和说明，保留运行环境与知识输出，不新增整库删除选项。

## 验证

回归覆盖旧布局强制删除、新布局重装保留、其他工作流产物保留、软链接不越界、init / output-dir 参数、Qwen 接入、模板导入与更新、知识路径、doctor、卸载。

使用当前 DocNexus 源码的隔离副本进行真实安装、初始化和默认模板导入；源项目只读，不修改其代码或安装状态。接入后的 status、知识分类查询、重复安装和卸载应继续指向同一套配置与知识目录。
