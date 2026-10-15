# Changelog

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.6.1] - 2026-10-15

### 修复
- Windows 开启开发者模式（能建软链接）时安装 / 升级报 `ERR_FS_EISDIR: Path is a directory`：探测软链接能否创建后用 `fs.rmSync` 删除探测链接，Windows 把指向目录的软链接当成目录而删不掉。删除软链接统一改用先 `unlink`、遇到 EPERM / EISDIR 再 `rmdir`（只删链接，不碰目标），安装、重建链接、清理旧名、qwen 链接都改用它；下次运行时清掉上次异常退出留在 `.claude/skills` 等目录里的 `.skills-init-probe-*` 链接。CI 的 Windows 任务增加 Node 24，并补了软链接删除与探测的测试。

## [0.6.0] - 2026-10-15

### 变更
- dev 新增「F3 需求澄清」（借鉴 grill-me）：把需求拆成决策树（行为、边界、异常、兼容、权限、数据、范围），按轮提问，每轮把现在能问的问题一次问完、编号并给推荐答案和依据；代码 / 表结构 / PRD / DocNexus 能查到的事实自己查，只把业务决定交给用户；M / L 规模问到没有被默默假设的决定、用户确认理解一致后才出方案，S 规模无未定决定时跳过。细则在 `dev/references/clarify.md`；之后的步骤顺延为 F4 方案 … F8 交付。开发方案模板第 1 节、交付说明新增「已确认的决定」。缺陷修复的信息收集只问只有用户知道的事实。
- 按分类检索：`knowledge.mjs --query "<问题>" [--recall-limit n]` 在 `readFrom` 的每个分类内 `recall --category`（DocNexus 0.16.0 起），能找到标题摘要里没写、正文里提到的沉淀；已装版本不支持时输出 `recall_by_category: false` 并提示改用不带分类的 recall。dev、project-review、两个文档 skill 开工前改用 `--query`；`doctor` 检查已装 DocNexus 是否支持 `recall --category`。
- project-review 审查流程：
  - 大改动不再逐个文件扫一眼：新增 `references/diff-strategy.md`，按规模决定全量精读还是按风险分批（P0 资金 / 事务 / 权限 / SQL / 对外接口 / MQ / 配置优先），没精读的文件写进报告「未覆盖与待确认」；也写明了未提交改动怎么审。与文档类共用 `diff-collection-common.md` 的分层与排除规则。
  - 对照同分支的方案：审查前用 `artifacts.mjs` 找本分支的开发方案 / 技术方案，审 diff 时做需求对照——方案里有、diff 里没有的记为漏实现，diff 里有、方案里没提的接口 / 表结构 / 配置 / 依赖变更列出请作者确认。
  - 复审：本分支已有审查报告时，对上次的每条问题标「已修复 / 仍存在 / 不再适用」，新发现标「新增」。报告模板新增「与上次审查对比」「需求对照」两个可选节和「参考产物」元信息行。
  - 审查清单从 10 维度扩到 14 维度：幂等与消息一致性（重复消费 / 回调、事务内发消息）、数据库变更安全（锁表、滚动发布兼容、`NOT NULL` 回填、索引支撑）、测试（覆盖与断言有效性）、语言专项（Java / Go / TS / Python / SQL 的常见坑）。
  - 新增交付前的「复核」步骤：CRITICAL / HIGH 逐条回到代码确认片段与行号、写出触发条件、排查别处是否已兜住、确认是本次改动引入的；复核不了的降级并标「⚠ 待确认」，不计入「不建议合并」的结论。

### 新增
- `upgrade` 在已接入 DocNexus 的项目里顺带导入新版本新增的文档模板（如本版的审查报告模板）：只新增，不改动已有模板；导入失败只提示，不让升级失败。之前要手动 `seed-templates`，否则 skill 会停下提示缺模板。
- `seed-templates --diff`：只读打印团队改过的模板（customized / untracked）与新默认模板的差异，例如团队维护的审查清单拿不到本版新增的第 11–14 维度时，对照差异手动合并；不写 DocNexus。`doctor` / `upgrade` 的模板状态提示改为指向它。
- 审查报告模板 `project-review/references/report.md`（`resolve.mjs template project-review report.md`）：元信息三行（审查范围、对比分支、审查方式）、问题表带「触发条件」与「复核」列、「未覆盖与待确认」必填。落盘后跑 `lint-doc.mjs --skill project-review --facts` 自检，和文档类 skill 一样能被 DocNexus 团队模板覆盖。

## [0.5.0] - 2026-10-15

### 变更
- 触发评估（26 条 × 3 次）发现两处不稳定后调整 description：project-review 补充「对照两个类 / DTO↔VO 转换漏字段」，dev 补充「跨几个类的具体重构（如 Date → LocalDateTime）后跑测试」。调整后 78/78。
- `eval-triggers.mjs`：期望 `none` 的用例触发了用户环境里的其他 skill 也算对；调用失败（额度用尽 / 未登录）记为 error 并提示结果不可信，不再误计为「没触发」。
- workflow 的 SKILL.md 精简为路由、链路与能力探测（159 → 74 行），画像、模板来源、DocNexus 约定、status 输出格式移到 `workflow/references/`；其他 skill 直接引用对应文件，不再需要加载整篇 workflow SKILL.md。测试检查引用的 `<skills>/<skill>/references|scripts` 路径都存在。

### 新增
- 按分类参考知识库：`workflow/scripts/knowledge.mjs <skill> [--match 词] [--limit n]` 按 skill.json 的 `docnexus.readFrom` 列出相关分类下的 DocNexus 文档（标题、摘要、路径，不含正文），补上 search / recall 不能按分类过滤的缺口；分类名跟随项目画像的覆盖。dev、project-review、两个文档 skill 开工前先看同类沉淀，再做关键词 recall。
- 按分支串联产物：`workflow/scripts/artifacts.mjs [--branch b | --all]` 扫描 `docs/skills/` 下的开发方案、审查报告、技术方案、上线方案，按元信息行里的分支归组，给出每类最新一份、wiki 发布记录与下一步建议，不另存记录文件。上线方案没传 `--tech` 时自动引用同分支最新的技术方案；`/workflow status` 与 dev 交付时据此提示下一步。审查报告新增分支元信息行。
- wiki 发布记录：`upload.mjs put --record <md>` 上传成功后把 pageId / 版本 / URL 写进 Markdown 第一行注释（转换时丢弃，不出现在页面上）；`upload.mjs target <md>` 读出，`/md-to-wiki` 再次发布同一文档时可省略 pageId；`upload.mjs record` 供 MCP 通道补写。
- `lint-doc.mjs --facts [--diff base...head]`：核对正文行内代码里的类名、文件、接口、表名，在 diff 和开发分支代码里都找不到的记为警告（防编造）；两个文档 skill 自检时启用。
- `doctor` 检查已装 DocNexus 是否支持 `draft seal --category`，不支持时提示升级。
- project-review 支持沉淀（需用户授权）：反复出现的问题模式与新确立的约定以 `code-review` 分类写入，已有同类沉淀时更新而不是重复新建；dev 开工前会参考它。

## [0.4.0] - 2026-10-15

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

[Unreleased]: https://github.com/guilianerde/skills-init/compare/v0.6.1...HEAD
[0.6.1]: https://github.com/guilianerde/skills-init/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/guilianerde/skills-init/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/guilianerde/skills-init/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/guilianerde/skills-init/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/guilianerde/skills-init/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/guilianerde/skills-init/releases/tag/v0.2.0
