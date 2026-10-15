# Changelog

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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
