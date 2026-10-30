# 团队共享、产物与模板

[返回首页](../README.md) · [安装与升级](installation.md) · [工作流与命令](workflows.md) · [外部能力集成](integrations.md) · [维护、测试与发布](development.md)

## 哪些文件提交、哪些忽略

安装 / 升级时安装器只往项目的 `.gitignore` 追加缺失的规则（已有内容不动），`doctor` 会检查凭据规则还在不在。团队成员照下面两张表即可。

**提交**（团队共享）：

| 路径 | 说明 |
| --- | --- |
| `.agents/skills/` | skills 单一来源，含安装清单 `.workflow-run.json` |
| `.claude/skills/`、`.qwen/skills/`、`.codebuddy/skills/` | 指向 `.agents/skills/` 的相对软链接（Windows 上 clone 需 `git config core.symlinks true`） |
| `.agents/skills/workflow/profile.json` | 项目画像（无凭据），产物目录用的项目名也在这里 |
| `.agents/skills/database-query/references/schema.md` | 表结构速查，补齐后提交 |
| `workflow-run/docs/requirements/` | 需求产物；独立文档仓库模式下提交到文档仓库 |
| `workflow-run/other/` | 普通聊天生成的报告、方案、草稿、导出等辅助文件（按需创建，可按主题分目录）；不进入需求索引、运行状态、需求统计与文档视图，按需提交 |
| `workflow-run/feedback/` | 运行反馈，每人一个文件；独立文档仓库模式下提交到文档仓库 |
| `.docnexus/project.json`、npm 清单与锁文件 | DocNexus 项目配置与运行依赖版本，随代码提交 |
| `workflow-run/docnexus/` | DocNexus 知识输出与定制的文档模板。独立文档仓库模式下提交到文档仓库 |
| `.ignore` | 让代码搜索跳过需求目录（不影响 git） |
| `.gitignore`、`CLAUDE.md` / `AGENTS.md` / `QWEN.md` | 安装器追加的忽略规则、文件落盘约定、DocNexus 说明段落 |

**忽略**（每人每机器一份，或可重新生成）：

| `.gitignore` 规则 | 忽略的内容 | 何时追加 |
| --- | --- | --- |
| `**/database-query/config.json` | 数据库连接（含密码） | 总是 |
| `**/nacos-config/config.json` | 可选 Nacos 本机连接配置，密码 / token 仅引用环境变量 | 总是 |
| `**/nacos-config/node_modules/` | Nacos skill 的本机 YAML 解析依赖 | 总是 |
| `**/wiki-config.json` | wiki 地址与 token | 总是 |
| `**/workflow/profile.local.json` | 个人设置：本机系统与终端、提交提示开关 | 总是 |
| `/workflow-run/tmp/` | 临时产物：查询导出、wiki 临时 XHTML、旧版产物归档、升级 / 卸载备份、`view` 页面 | `workflow-run/` 不是独立 git 仓库时 |
| `/workflow-run/` | 整个文档仓库（它自己提交）；同时在文档仓库的 `.git/info/exclude` 加 `/tmp/` | 独立文档仓库模式（`docs-repo`） |
| `.codegraph/` | CodeGraph 本地索引（SQLite） | `--with-codegraph` |

查某个文件为什么被忽略、看当前所有被忽略的文件：

```bash
git check-ignore -v .agents/skills/database-query/config.json
```

```bash
git status --short --ignored
```

## 凭据安全


* **数据库**：连接配置从已有 `.codex/database-query/config.json` 自动迁移，或按提示填写。

  生成后 `**/database-query/config.json` 追加到 `.gitignore`，**请勿提交**。

* **wiki**：连接配置**默认留空**（`enabled: false`）。启用时填写各环境

  `md-to-wiki/wiki-config.json` 的 `base_url` / `api_token`；`**/wiki-config.json` 同样加入

  `.gitignore`，**请勿提交**。

* 技能内置安全规则：database-query 只读查询优先、写操作必须用户确认、敏感字段脱敏、

  不在对话中输出密码。

* **Nacos**：优先读取用户选定的 application / bootstrap；可选本机 `nacos-config/config.json` 使用 `password_env` / `token_env` 引用凭据并由 gitignore 忽略。配置获取只读，不输出密码或 token，不缓存远程原文，也不自动改写数据库连接。生效环境与 Data ID 不明确时先确认。

## 产物输出规范（统一落位）

普通聊天生成的报告、分析、方案、草稿、导出等辅助文件默认写到 `workflow-run/other/`（按需创建，可按主题建子目录），不绑定需求、不登记运行状态，也不进入需求统计与文档视图。安装与 `upgrade` 会向所选环境的 `CLAUDE.md` / `AGENTS.md` / `QWEN.md` 写入这条项目级指令，无需接入 DocNexus；卸载只清理自己的指令段，保留手写内容与产物。源码、测试、配置和已有文件的维护、工作流指定的临时目录与知识库沿用原路径；用户明确指定输出路径时以用户为准。不会自动搬移已有文件。

一个需求的文档产物放在**同一个需求目录**里，方案（开发 / 缺陷修复）、交付说明、审查报告、技术方案、上线方案一起看：

```
workflow-run/docs/requirements/<需求名>/<项目名>/
├── meta.json        # runs 保存分支运行状态、逐步完成标记与完成时间；另含 需求名、绑定的分支、各产物（版本、日期、wiki 发布记录、DocNexus 沉淀），给以后的可视化用
├── clarification.md # 业务场景清单（F2 / B3，多轮核对产品答复）
├── requirement.md   # 需求文档（F3 / B3 收尾：目标、范围、AC 验收与澄清决定）
├── plan.md          # 方案（dev，非快速通道都写；S / M 简版；缺陷修复追加修复方案节）
├── delivery.md      # 交付说明（dev，完整流程审查后用户选择交付才写；S 快速通道不落盘）
├── review.md        # 审查报告（独立审查或 dev 完整流程自查；S 快速通道不落盘）；复审也写这个文件，上一版归档到 workflow-run/tmp/old-artifacts/
├── tech-doc.md      # 技术方案
└── release-doc.md   # 上线方案
```

* **随代码提交和独立文档仓库两种用法的结构完全一样**，切换时文件不用挪。一个需求横跨多个服务时，各服务在同一个需求目录下各占一个 `<项目名>/`。项目名写在 `workflow/profile.json` 的 `artifacts.project`：随代码提交时不用配置，取 git 远端仓库名（没有远端用目录名），第一次落盘时自动写进去；独立文档仓库时由 `docs-repo` 配置。
* 旧版本随代码提交时没有 `<项目名>/` 这一层；`upgrade` 会把这些需求目录里的文件迁到 `<需求>/<项目名>/`（被 git 跟踪的用 `git mv`，保留历史），结尾列出迁移了哪些需求，改动由你提交。目标里已有同名文件的需求不动，并提示手动处理；`doctor` 也会提示还没迁移的需求。
* **需求名由你定**：dev 在 Step 0 先确定工作分支，再查询绑定并确认需求名，给不出名字或说不清这次要做什么时不会进入开发流程（默认值按分支名生成；也可以选已有的需求，例如修 bug 的新分支挂到原需求下）。从 `/workflow` 完整链路开始时同样先问（只问名字，第一次落盘时才 `bind`）；S 快速通道也问，但不绑定、不落盘。确定后，同一分支上的各 skill 都写到这个目录，不再问。一个需求可以绑定多个分支。
* 正式文档先写 tmp 草稿，再用 `artifact.mjs finalize` 自检、归档旧版、发布并更新索引与运行证据，输出 path / cite；文件名固定、目录只留最新版。中断后用 resume 恢复，重复命令不会重复升版本；旧版在 tmp/old-artifacts/，不替用户删除，wiki 页面记录自动沿用。底层 requirement path / sync 仍保留，新的正式流程统一走 finalize。
* 需求目录写在项目根的 `.ignore` 里，ripgrep 和 agent 的代码搜索会跳过它，产物多了不会污染搜索结果（找历史决策用 DocNexus）。git 不受影响，建议随代码提交。

完整 dev 的关键阶段由程序校验：M / L 方案确认绑定具体版本，测试证据和审查报告绑定包含未提交改动的代码快照，交付选择绑定本轮报告。相关代码、基线或报告变化后需重新验证／审查和选择。独立审查交接由脚本从需求事实、范围与验证结果生成；需要产品核对清单时，在首版清单前创建运行、等待反馈时保存状态；快速通道仍不创建运行。协议见 [execution.md](../workflow/references/execution.md)。

**独立文档仓库（可选）**：不想让产物进代码仓库、或一个需求横跨多个服务时，装好 skills 后在项目根运行一条命令：

```bash
npx @rowansenne/workflow-run docs-repo <团队文档仓库地址> [--project <项目名>]
```

它会：
- `workflow-run/` 里没有内容（或只有 `tmp/`）时，把文档仓库克隆到这里（`tmp/` 先挪开再放回）；
- 已有随项目提交的产物、DocNexus 时，原地 `git init` 并接上远端，文件不用挪（旧结构的产物先迁到 `<需求>/<项目名>/`）。远端是空仓库时，本地内容就是文档仓库的第一批内容；远端已有内容时检出远端，本地文件和远端同路径冲突（多半是两边都有 DocNexus 知识库）就退回原状并列出冲突的文件，不合并；代码仓库还跟踪着 `workflow-run/` 时提示 `git rm -r --cached workflow-run`；
- 然后代码仓库的 `.gitignore` 加 `/workflow-run/`，文档仓库的 `.git/info/exclude` 加 `/tmp/`；把项目名写进 `workflow/profile.json`（默认沿用已配置的，其次 git 远端仓库名；`profile.json` 随代码提交，记得提交它）；文档仓库里有 DocNexus 时接上本项目的链接和段落，本机还没装它的依赖时提示运行 `upgrade --with-docnexus`。不带地址运行显示当前状态；只改项目名：`docs-repo --project <项目名>`。

`workflow-run/` 自己是 git 仓库就是这个模式：目录结构不变，各服务在同一个需求目录下各占一个子目录，DocNexus 知识库也在这个仓库里各服务共用。项目名写在 `workflow/profile.json` 的 `artifacts.project`，只配一次（`docs-repo` 会配好；没配时 skill 会问你一次）。文档里引用产物写成「文档仓库名:路径」，各服务、各人的克隆里都一样。

* 写完产物后 skill 会列出文档仓库里没提交的文件和建议的提交信息，你确认后才提交，推送另外问。不想被提示：`requirement.mjs config --commit-prompt off --local`（写在个人的 `workflow/profile.local.json`，已加入 `.gitignore`，不影响团队）。
* 其他服务的需求要先在 `workflow-run/` 里拉下来（`git -C workflow-run pull`），绑定时才看得到。
* `/workflow view` 在这个模式下显示文档仓库里所有项目的需求。

**浏览**：`/workflow view` 或 `npx @rowansenne/workflow-run view --open` 生成一个本地页面（`workflow-run/tmp/view/index.html`）。左边是需求列表，可按名称或分支搜索；右边是这个需求的各阶段、审查记录（每轮的级别数量、复核、与上次对比的修复情况）、交付记录，以及各份文档的渲染正文。页面是生成那一刻的快照，产物有更新时重新生成。

其他产物：

| 技能 | 产物 | 位置 |
| --- | --- | --- |
| database-query | 查询结果 | 默认对话输出；导出时 `workflow-run/tmp/database-query/result-<时间戳>.csv` |
| md-to-wiki | 转换临时 XHTML | `workflow-run/tmp/md-to-wiki/_wiki_upload_<时间戳>.html`（上传后可删） |

规则：

* 本工具的产出都在 `workflow-run/`：`docs/requirements/`（需求产物）、`docnexus/`（DocNexus 工作区，含定制的文档模板）是**持久产物**，随代码提交或在独立文档仓库里提交，团队共享。
* `workflow-run/tmp/` 是**临时产物**目录，安装时自动把 `/workflow-run/tmp/` 加入 `.gitignore`，不入库。

## 自定义模板

文档类 skill 的模板来源取决于项目是否接入了 DocNexus，生成的文档开头会注明「模板来源」：

* **已接入 DocNexus：只用知识库里的模板** `workflow-run/docnexus/library/templates/<skill>/<文件名>`（分类 `doc-template`）。不再使用 skill 自带的默认模板。库里缺模板时 skill 会停下来，提示你导入后再继续，不会悄悄回退到默认模板。
* **DocNexus 不可用**：修复必装组件后继续，不使用包内模板降级。
* **默认模板只读，定制只走 DocNexus**：要改模板或新建模板，都写进 DocNexus 知识库，团队共享同一份、每次变更有 timeline。不要直接改 skills 目录里的模板（升级会覆盖）；`workflow-run/templates/` 下的项目模板已不再生效，`doctor` 会提示你导入知识库后删除。

| skill | 文件名 | 用途 | 默认模板 |
| --- | --- | --- | --- |
| create-tech-md-doc | `template.md` | 技术方案模板 | **不提供**，第一次用时按样例创建 |
| create-release-md-doc | `template.md` | 上线方案模板 | **不提供**，第一次用时按样例创建 |
| dev | `clarification-template.md` | F2 业务场景待确认清单（技术澄清前，产品往返核对） | 有 |
| dev | `plan-template.md` | 方案模板（开发 / 修复） | 有 |
| dev | `delivery-template.md` | 交付说明模板 | 有 |
| project-review | `checklist.md` | 审查清单 | 有 |
| project-review | `report.md` | 审查报告模板 | 有 |

**技术方案、上线方案的模板按团队自己的格式创建**：各团队发到 wiki 的文档格式不同，skills 不再自带固定格式。第一次生成时 skill 会停下来，请你给一份团队现有的同类文档（本地 Markdown，或 wiki 的 pageId / URL）作样例，用 `workflow/scripts/make-template.mjs` 抽出章节和表格结构，把正文换成填写说明，你确认后经你授权写入 DocNexus。因此这两类文档**需要先接入 DocNexus**（`--with-docnexus`），未接入时 skill 会停下来提示。之后想换格式，直接说「重新生成技术方案模板」。

**修改模板**：说「改技术方案模板，加一节回滚方案」或 `/workflow template release 去掉灰度那节`，agent 会一路走完：

1. 把当前生效的模板复制成草稿 `workflow-run/tmp/template-draft/<skill>/<文件名>`，只改草稿；
2. `template.mjs check` 校验格式（必填 ` *`、可选「（如有）」、占位符），列出新增 / 删除的章节、必填变化，并拿最近几份已生成的文档试跑，告诉你新模板下它们会多出哪些错误；
3. 你确认后经你授权按 capture 流程写入 DocNexus 知识库，再确认生效；要撤销按 DocNexus 的 timeline 恢复旧版本。

模板别名：`clarification`、`requirement`、`tech`、`release`、`plan`、`delivery`、`review`、`checklist`。改带默认版本的模板（澄清清单、需求文档、方案、交付说明、审查报告、审查清单）也走这条路，知识库里的版本取代默认版本，升级不会覆盖。未接入 DocNexus 时不能修改模板，agent 会提示你先接入。

* `doctor` 和 `/workflow status` 会列出还没创建的模板，以及要先接入 DocNexus 才能创建的模板。

**模板导入 DocNexus**：

```
npx @rowansenne/workflow-run --envs claude --skip-db --with-docnexus   # 接入时自动导入默认模板
npx @rowansenne/workflow-run seed-templates                      # 已接入的项目补导入缺的模板（upgrade 时也会自动导入新增的）
npx @rowansenne/workflow-run seed-templates --update             # 导入后没改过的模板更新为新版
npx @rowansenne/workflow-run seed-templates --diff               # 团队改过的模板：打印与新默认模板的差异，手动合并
```

* 只导入 DocNexus 里还没有的、有默认版本的模板（技术方案、上线方案不在内），已有的不覆盖；项目已接入但缺模板时，安装结束会列出缺哪几份。
* 之后模板随知识库更新：直接编辑 `workflow-run/docnexus/library/templates/...` 后在业务项目根执行 `./.docnexus/node_modules/.bin/docnexus document sync --id <id>` 采纳；或者在生成文档后，skill 发现你做了结构性调整时会提议同步回模板（你确认后才写入）。每次变更都记录在 DocNexus 的 timeline 里，可追溯。
* 模板里的 `{{...}}` 是给 agent 的填写提示，DocNexus 原样保存；不要写成单独一行的 `{{fact:...}}`（那是 DocNexus 的事实引用语法）。
* 以前放在 `workflow-run/templates/` 下的项目模板：接入 DocNexus 后，缺模板时 skill 会把它作为 `import_from` 提议导入知识库；导入后删除这些文件。
