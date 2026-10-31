# 安装与升级

[返回首页](../README.md) · [工作流与命令](workflows.md) · [外部能力集成](integrations.md) · [团队共享、产物与模板](team-guide.md) · [维护、测试与发布](development.md)

## 快速开始

需要 **Node.js >= 22.13** 与 npm（DocNexus 为必装组件）。只用 npx 安装，在项目根执行（以当前目录为项目根；Windows 要在管理员终端里运行）。推荐全量安装：

```
npx @rowansenne/workflow-run@latest --with-codegraph
```

按提示：选择环境（编号多选，回车 = 全部）→ 确认 / 填写数据库连接 → 自动生成。安装时自动接入 DocNexus 文档库（开发约定与审查问题的沉淀和召回、团队定制的文档模板），`--with-codegraph` 接入 CodeGraph 代码图谱（改动影响到的接口、MQ、定时任务和测试）；不需要 CodeGraph 就去掉 `--with-codegraph`。装完后在 agent 里运行 `/workflow profile` 填写项目画像。

全量安装的分步说明见图文教程 [docs/full-install.html](full-install.html)（下载后用浏览器打开）。

整体架构、dev 主线流程、独立能力调用、数据归属与知识闭环见 [docs/architecture.html](architecture.html)（下载后用浏览器打开）。

非交互示例（bash、zsh、PowerShell 写法一样；环境列表加引号）：

```bash
# 已有数据库连接配置时，安装全部代理环境
npx @rowansenne/workflow-run@latest --envs all --yes --with-codegraph

# 跳过数据库配置，安装 Codex 与 Qwen
npx @rowansenne/workflow-run@latest --envs "codex,qwen" --skip-db --yes --with-codegraph

# 全部代理环境分别拷贝，不使用软链接
npx @rowansenne/workflow-run@latest --envs all --skip-db --yes --copy

# 只安装 Claude 环境，DocNexus 自动接入
npx @rowansenne/workflow-run@latest --envs claude --skip-db --yes
```

`--with-docnexus` 表示强制更新 DocNexus，首次安装时无需额外指定；默认缺失即安装，已安装则复用。未跳过数据库配置且本机没有已有连接时，`--yes` 会报错，应改用交互安装或加 `--skip-db`。

### 子命令

以下命令在业务项目根的终端执行。示例使用 `@latest`，确保获取最新发布包；路径、日期、仓库地址与项目名按实际情况替换。

| 命令 | 可复制示例 | 作用 |
| --- | --- | --- |
| `init`（默认） | `npx @rowansenne/workflow-run@latest init --envs codex --yes --skip-db` | 安装或重装；首次安装段落已给出省略 init 的写法 |
| `upgrade` | `npx @rowansenne/workflow-run@latest upgrade` | 按安装清单升级 skills，保留用户配置，手改的 skill 文件先备份；自动补入新增模板 |
| `doctor` | `npx @rowansenne/workflow-run@latest doctor --offline` | 本地自检；去掉 --offline 时另测数据库连通性 |
| `uninstall` | `npx @rowansenne/workflow-run@latest uninstall` | 按安装清单卸载，保留用户产物并备份用户配置 |
| `seed-templates` | `npx @rowansenne/workflow-run@latest seed-templates` | 补导入缺失的默认模板，不覆盖已有模板 |
| `report` | `npx @rowansenne/workflow-run@latest report --since 2026-10-01 --all-branches --json` | 统计指定日期起、工作区及所有本地分支中的产物 |
| `feedback` | `npx @rowansenne/workflow-run@latest feedback --json` | 汇总运行反馈 |
| `view` | `npx @rowansenne/workflow-run@latest view --open` | 生成并打开本地文档视图 |
| `docs-repo` | `npx @rowansenne/workflow-run@latest docs-repo git@git.example.com:team/team-docs.git --project order-service` | 接入团队文档仓库；省略仓库地址时显示当前状态 |

常用附加参数：

```bash
# 更新 DocNexus 依赖；旧布局清理行为先看外部能力集成文档
npx @rowansenne/workflow-run@latest upgrade --with-docnexus

# 更新未定制的旧默认模板；定制模板仅查看差异后手动合并
npx @rowansenne/workflow-run@latest seed-templates --update
npx @rowansenne/workflow-run@latest seed-templates --diff

# 指定文档视图输出路径；从其他目录操作项目
npx @rowansenne/workflow-run@latest view --out workflow-run/tmp/docs.html
npx @rowansenne/workflow-run@latest doctor --offline --project-root ../order-service

# 查看全部参数或当前包版本
npx @rowansenne/workflow-run@latest --help
npx @rowansenne/workflow-run@latest --version
```

升级 DocNexus 的旧布局清理说明见[外部能力集成](integrations.md#破坏性更新旧布局强制清理)。

## 安装路径与启用方式


| 环境          | 生成目录                         | 启用方式                                     |
| ----------- | ---------------------------- | ---------------------------------------- |
| codex       | `.agents/skills/`（**单一来源**，完整文件） | 重启 codex 自动发现；也可 `/use project-review` 手动加载 |
| claude-code | `.claude/skills/<skill>` → 软链接到 `.agents/skills/<skill>` | Claude Code 自动发现，无需额外配置                  |
| doubao      | `.agents/skills/`（与 codex 共用）   | 豆包办公自动发现（新会话生效）                          |
| qwen        | `.qwen/skills/<skill>` → 软链接到 `.agents/skills/<skill>` | Qwen Code 自动发现；`/skills` 面板可查看与切换        |
| workbuddy   | `.codebuddy/skills/<skill>` → 软链接到 `.agents/skills/<skill>` | WorkBuddy 打开项目目录后读取（项目级优先于用户级 `~/.workbuddy/skills/`） |

**单一来源 + 软链接**：skills 只在 `.agents/skills/` 装一份完整文件，`.claude/skills`、`.qwen/skills`、`.codebuddy/skills` 下按 skill 建相对软链接（`../../.agents/skills/<skill>`），改模板、填配置都只需改一处。因此即使只选了 claude、qwen 或 workbuddy，`.agents/skills/` 也会生成。

* 按 skill 建链接而不是链接整个目录，这样 `.claude/skills/` 里还能放其他 skill（例如 DocNexus 的链接）。
* 之前用 `--copy`（或建不了链接时）装的独立拷贝，再不带 `--copy` 安装时会换成链接：拷贝里填过的用户配置（`config.json`、`schema.md`、`wiki-config.json`、`profile.json`）先并入 `.agents/skills/`，原目录移到 `workflow-run/tmp/backup/<时间>/<环境>/`；两份都填过且内容不同时不会自动合并，会保留那个目录并提示手动处理。
* Windows：安装与升级（`init` / `upgrade`）**必须在管理员终端执行**（建目录软链接需要该权限）；在普通终端运行会直接停下、不做任何改动，并提示改用「以管理员身份运行」的终端。`doctor`、`seed-templates`、`uninstall` 不要求管理员。少数文件系统仍建不了软链接时，该环境自动退回独立拷贝。在 Windows 上 clone 含软链接的仓库需要 `git config core.symlinks true`。
* 不想用软链接：加 `--copy`，每个环境各装一份完整文件。

### 在 Windows 的 WorkBuddy 中使用

在**业务项目根目录**打开管理员 PowerShell，运行 npm 包提供的安装命令（仅 `npm install` 下载包不会生成项目技能）：

```powershell
npx @rowansenne/workflow-run@latest --envs workbuddy --copy --skip-db --yes
npx @rowansenne/workflow-run@latest doctor --offline
```

这里用 `--copy` 在 `.codebuddy/skills/<skill>/` 生成真实目录和 `SKILL.md`，便于排除目录软链接的兼容问题。已有指向 `.agents/skills/` 的本工具链接会先转成独立拷贝，保留已填配置，再更新技能文件；共享来源和 Qwen 等其他环境的链接不变。后续 `upgrade` 沿用最近一次显式安装的环境和模式。只选择 WorkBuddy 时，全新安装不会生成 `.qwen/skills/`。

安装后，将 **同一个业务项目目录**设为 WorkBuddy 任务的工作目录，重新打开项目并新建会话，再尝试 `/workflow status`、`/dev` 或 `/project-review`。`/workflow profile` 等是技能参数，不是额外的独立技能。

如果仍然不可见，先确认业务项目下确实有 `.codebuddy/skills/workflow/SKILL.md`，并保留安装命令、`doctor --offline` 输出与 WorkBuddy 版本以便排查。项目级配置目录见 [WorkBuddy 官方说明](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Project)。

各环境中的 skill 内容相同；默认共用 `.agents/skills/` 的这一份文件：


```
<env-dir>/
├── workflow/                         # 入口：路由到各 skill、能力探测、维护共用项目画像
│   ├── SKILL.md
│   ├── scripts/resolve.mjs           # 模板来源 / 画像 / 能力探测的判定脚本
│   ├── lib/                          # 共享模型、读取、状态与门禁，随 workflow 安装
│   └── profile.json                  # 项目画像：主分支、构建 / 测试命令、配置中心、发布平台等（无凭据，可提交；重跑不覆盖）
├── project-review/                      # 代码审查
│   ├── SKILL.md                      # 触发描述 + 审查工作流（含大改动分批、发现复核）
│   └── references/
│       ├── checklist.md              # 14 维度审查清单（配置维度按 profile.config_center 判断；含幂等、DB 变更、测试、语言专项）
│       ├── report.md                 # 审查报告模板（触发条件、复核列、复审对比、需求对照；lint-doc 据此自检）
│       ├── diff-strategy.md          # 读 diff 的策略：按规模全量 / 按风险分批，未提交改动
│       └── diff-collection-common.md # 与文档类共用的分层过滤规则
├── code-graph/                       # 代码图谱查询（基于 CodeGraph）
│   ├── SKILL.md                      # 触发描述 + 命令 + 结果归纳方式
│   └── scripts/cg.mjs                # impact / entry / mq / jobs / tables / status
├── database-query/                   # 数据库查询
│   ├── SKILL.md                      # 触发描述 + 查询工作流 + 只读/安全规则
│   ├── config.json                   # 数据库连接（init 生成，已加入 .gitignore）
│   ├── scripts/query.mjs             # 执行查询：会话只读、写语句拦截、自动 LIMIT、脱敏
│   └── references/schema.md          # 表结构速查（初始为空，建议补齐后提交）
├── nacos-config/                     # 独立只读远程配置查询，无其他 skill 运行依赖
│   ├── SKILL.md
│   ├── scripts/config.mjs            # inspect 本地定位 / get 远程读取、参数查询、脱敏
│   ├── package.json                  # YAML 解析依赖；首次需要时在本目录安装
│   └── config.json                   # 可选命名连接，用户自行配置，不生成、不提交
├── md-to-wiki/                       # 发布 md 到 Confluence wiki
│   ├── SKILL.md                      # GATE：wiki 未配置则禁止启动
│   ├── wiki-config.json              # wiki 连接（init 生成，默认 enabled=false，已 gitignore）
│   └── scripts/md-to-wiki.mjs        # md → Confluence Storage Format XHTML 转换 + 良构校验（Node，无依赖）
├── create-tech-md-doc/               # 从分支 diff 生成技术方案，生效模板在 DocNexus
│   └── SKILL.md                      # 首次按用户样例创建模板，不附带 template.md
├── create-release-md-doc/            # 从分支 diff 生成上线方案，生效模板在 DocNexus
│   └── SKILL.md
└── dev/                              # 开发 / 修 bug：需求→调研→方案→实现→测试→自审→交付
    ├── SKILL.md
    └── references/plan-template.md   # 导入 DocNexus 的方案模板种子；快速通道不用
```

## 参数


| 参数                      | 说明                                                                    |
| ----------------------- | --------------------------------------------------------------------- |
| `--envs`      | 环境列表，逗号分隔：`codex,claude,doubao,qwen,workbuddy`；`all` = 全部                       |
| `--skip-db` | 跳过数据库连接配置（database-query 不生成 config.json）                             |
| `--with-docnexus` | 强制将必装的 DocNexus 更新到最新版；默认缺失即安装、已有则复用（需 Node >= 22.13 与 npm） |
| `--with-codegraph` | 可选：接入 [CodeGraph](https://github.com/colbymchenry/codegraph) 代码图谱，见 [CodeGraph 集成](integrations.md) |
| `--copy`      | 不建软链接，各环境独立拷贝一份完整 skills                                  |
| `--skills <列表>` | 只装这些 skill（逗号分隔），自动带上 `requires` 依赖；之后可以再用 `--skills` 补装，已装的保留；`upgrade` 只升级装过的。不含 database-query 时不询问数据库 |
| `--seed-templates` | 把自带的文档模板导入 DocNexus（已有的不覆盖）；接入 DocNexus 后文档类 skill 只从知识库取模板。每次安装 / 升级都会自动执行 |
| `--uninstall` | 按安装清单卸载本项目装的 skills 与链接，见下方「卸载」 |
| `--offline` | `doctor` 不测试数据库连通性 |
| `--yes`        | 非交互：自动使用已有数据库配置（依次查找 `.codex/database-query/config.json` 与各环境已安装的 `database-query/config.json`）；都没有且未 `-SkipDb` 时报错退出 |
| `--project-root`        | 项目根目录；默认当前目录 |
| `--version`      | 显示版本                                                                |
| `--help`         | 帮助                                                                    |

## 重跑与升级

可以放心重复执行 init 来升级模板；只想按原来的环境升级时用 `npx @rowansenne/workflow-run upgrade`，不用再选一遍：

* `SKILL.md`、`references/checklist.md`、`template.md`、脚本等**模板文件会被更新**；但被你**手动改过**的模板文件不会被静默覆盖（见下方「安装清单」）；
* 新版本模板里已删除的文件会被清理；你改过的不删，保留并在结尾提示；
* 用户填过的 `md-to-wiki/wiki-config.json`、`database-query/references/schema.md`、`workflow/profile.json` **保留不覆盖**；
* `database-query/config.json` 只在本次确认或填写了数据库配置时写入；`--skip-db` 时保留已有文件；
* `.gitignore` 规则无论是否配置数据库都会补齐（只追加缺失的行）；
* 安装器按 skill 目录自动发现文件（`*.tpl` 去掉后缀），新增 `references/` 文件不需要改安装器。
* skill 的元数据只写在各目录的 `skill.json` 里（见[维护说明](development.md#skilljson)），安装器、`seed-templates` 和 `resolve.mjs` 都从它读取。
* 设置环境变量 `WORKFLOW_RUN_NO_SYMLINK=1` 可强制不建软链接（各环境独立拷贝）；无法建链接时会先探测，旧目录原样保留、只更新模板。

### 从 skills-init 改名过来

包从 `@rowansenne/skills-init` 改名为 `@rowansenne/workflow-run`，项目里的目录从 `skills-init/` 改成 `workflow-run/`，安装清单从 `.skills-init.json` 改成 `.workflow-run.json`。不做自动迁移：在旧项目里运行新包时，会列出要执行的改名命令后停下，例如：

```bash
git mv skills-init workflow-run
```

```bash
mv .agents/skills/.skills-init.json .agents/skills/.workflow-run.json
```

（`skills-init/` 是独立文档仓库、没被代码仓库跟踪时用 `mv`；PowerShell 里 `mv` 同样可用。）改完再运行 `npx @rowansenne/workflow-run upgrade`：它会重建 DocNexus skill 链接、补上 `workflow-run/` 的 `.gitignore` / `.ignore` 规则，并提示删掉 `CLAUDE.md` / `AGENTS.md` 里 `skills-init:docnexus` 的旧段落和含 `skills-init/` 的旧忽略规则。

### 安装清单

每次安装后在 `.agents/skills/.workflow-run.json`（`--copy` 时各目标目录各一份）写入清单：安装器版本、安装时间、所选环境、安装模式，以及每个 skill 的模板文件相对路径与 sha256。用户配置（`config.json`、`schema.md`、`wiki-config.json`、`profile.json`）只记录存在与否，不记哈希，重跑和升级都不覆盖。

**skills 目录里的其他文件（SKILL.md、skill.json、references、scripts）一律以安装包为准**，重跑和升级时总是更新为新版，不询问：

| 情况 | 处理 |
| --- | --- |
| 当前内容与清单记录一致（没改过） | 直接更新 |
| 与清单记录不同（手改过） | 原文件先备份到 `workflow-run/tmp/upgrade-backup/<时间>/<相对项目根的路径>`，再更新为新版；结尾列出这些文件和备份目录 |
| 目录里没有清单，无从判断 | 和新版不同的文件同样备份后更新；结尾只用一行说明哪个目录没有清单、备份了几个文件，不当作手改过 |
| 清单里有、新版里已没有 | 没改过直接删除；改过的备份后删除 |

* 这样 `SKILL.md`、`skill.json`、脚本始终是同一个版本，不会出现「新 SKILL.md 配旧 skill.json」的混搭。
* 项目自己的定制不要改 skills 目录里的文件，放到不会被覆盖的地方：项目事实和约定写 `workflow/profile.json`（约定写 `notes`），文档模板只能在 DocNexus 里定制（skills 自带的默认模板只读），通用规则写 `CLAUDE.md` / `AGENTS.md`。
* 需要找回手改内容时到备份目录里取。

### 卸载

```
npx @rowansenne/workflow-run uninstall
```

按清单移除本项目安装的 skill 文件、`.claude/skills`、`.qwen/skills`、`.codebuddy/skills` 下指向 `.agents/skills` 的软链接，以及清单本身：

* 用户配置（`config.json`、`schema.md`、`wiki-config.json`、`profile.json`）和手改过的模板文件先移到 `workflow-run/tmp/uninstall-backup/<时间戳>/<安装目录>/<skill>/`，结尾列出；
* 不在清单里的文件、你自己的 skill 和链接都不动；skill 目录里还有你自己加的文件时保留该目录并提示；目录清空后才删除；
* `.gitignore` 里追加的规则和 DocNexus 不处理；没有清单时什么也不做。

## 为什么这些路径


* **Codex CLI 项目级 skills** 官方约定为 `.agents/skills/`（团队提交即共享），与豆包办公

  的项目级技能目录一致，因此两者共用一份。

* **Claude Code** 项目级为 `.claude/skills/`，自动发现。

* **Qwen Code** 项目级为 `.qwen/skills/`，自动发现。

* **腾讯 WorkBuddy** 读项目工作目录下的 `.codebuddy/`（与 CodeBuddy Code 一致），项目级技能在 `.codebuddy/skills/`，同名时优先于用户级；它也读 `AGENTS.md`。
