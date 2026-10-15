# Changelog

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 修复
- dev 直接读 `project-review/references/checklist.md`：接入 DocNexus 后会用到默认清单而不是团队维护的版本。改为通过 `resolve.mjs template` 取；project-review 自身的配置维度说明同步修正。

### 新增
- 写入 DocNexus 时由 skill 显式指定分类（对应 DocNexus 新增的 `draft seal --category`）：skill.json 新增 `docnexus: { category, reason }`（`dev` → `dev-notes`，`create-tech-md-doc` → `tech-design`，`create-release-md-doc` → `release-plan`），`resolve.mjs category <skill>` 输出分类与 `seal_args`，项目可用 `profile.json` 的 `docnexus_categories` 覆盖；`resolve.mjs status` 列出各 skill 的分类。`seed-templates` 导入与更新模板时以 `--category doc-template` 封存，更新时分类固定为 `doc-template`。同时写 `metadata.category`，不支持 `--category` 的旧版 DocNexus（会忽略该参数）照常入库。
- skill.json 新增 `requires` / `optional` / `shared`；安装器支持 `--skills <列表>` 按需安装并自动带上依赖，`upgrade` 只升级装过的 skill，模板导入与状态只针对已安装的 skill；`resolve.mjs status` 输出已安装的 skill。
- 测试检查跨 skill 的文件引用必须在 `requires` / `optional` 中声明。
- `upload.mjs get [--text]`：读取 wiki 页面正文；其他 skill 拉 PRD 统一调用它，不再直接读 `md-to-wiki/wiki-config.json`。
- 共享参考文件 `shared/`（`diff-collection-common.md`、`prd-fetch.md`）：仓库只维护一份，安装时拷进声明它的 skill；两个文档 skill 的 `references/` 只保留各自特有的映射与规则。
- `workflow/scripts/lint-doc.mjs`：对照当前生效的模板检查生成的文档（必填章节、残留占位符、元信息行、待填写位置），文档类 skill 与 dev 的 L 规模方案交付前运行。
- `resolve.mjs infer-profile`：按固定规则从构建文件、Makefile、依赖与配置文件、git 推断项目画像草稿，每个字段附依据。
- `query.mjs --schema [--tables] [--write]`：导出表结构为 Markdown，写入 schema.md 的 begin/end 标记之间（标记外的补充说明保留）。
- `md-to-wiki/scripts/upload.mjs`：REST 上传通道脚本，`info` 读取页面供确认，`put --expect-version` 校验良构与版本后上传并核对版本 +1；支持 Basic（Cloud）与 Bearer（Server / DC）。
- 安装器拆分为 `bin/lib/` 下的模块。
- 安装器黑盒测试迁到 `tests/test-install.mjs`（三个平台共用一份），bash / PowerShell 测试精简为封装脚本冒烟测试。
- DocNexus 模板版本跟踪：导入记录（版本 + sha256）保存在安装清单；`doctor` / `upgrade` 区分「默认模板有新版且库中未改动」与「团队改过」；`seed-templates --update` 只更新前者。

## [0.3.0] - 2026-10-15

### 新增
- 子命令：`upgrade`（按安装清单里的环境与模式非交互升级）、`doctor`（版本、手改 / 缺失文件、软链接、项目画像、DocNexus 模板、数据库连通性、`.gitignore` 自检）、`uninstall`、`seed-templates`。
- 安装清单 `.skills-init.json`：记录模板文件 sha256，手改过的文件升级时不静默覆盖（另存 `.new`），模板中已删除的文件自动清理，`--uninstall` 按清单卸载并备份用户配置。
- 每个 skill 目录的 `skill.json` 作为元数据唯一来源（用户文件、文档模板、改名记录），安装器、`seed-templates`、`resolve.mjs` 都从它读取。
- `workflow/scripts/resolve.mjs`：模板来源、项目画像、能力探测的判定脚本，各 skill 统一调用。
- `database-query/scripts/query.mjs`：会话层只读、写语句与多语句拦截、自动 LIMIT、超时、敏感列脱敏；写操作需 `--write`。
- 文档模板可由 DocNexus 管理：`--with-docnexus` 自动导入，`seed-templates` 补导入；接入后文档类 skill 只用知识库里的模板。

### 变更
- node 测试在 macOS / Ubuntu / Windows 三个平台都运行。

## [0.2.0] - 2026-10-15

### 新增
- database-query 支持多个命名连接，默认只读并在数据库会话层强制。
- md-to-wiki 改为无依赖的 Node 转换脚本（Confluence Storage XHTML，内置良构校验）。
- 首次发布到 npm：`npx @rowansenne/skills-init`。

### 变更
- 安装器改为单一 Node 实现，`init-skills.sh` / `init-skills.ps1` 只是薄封装。
- `code-review` 改名为 `project-review`，升级时自动清理旧名。

[Unreleased]: https://github.com/guilianerde/skills-init/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/guilianerde/skills-init/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/guilianerde/skills-init/releases/tag/v0.2.0
