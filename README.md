# skills-init — 项目级 Agent Skills 一键初始化

把 **workflow（入口路由 + 共用项目画像）**、**dev（功能开发 / 缺陷修复编排）**、**database-query（数据库查询）**、**project-review（代码审查）**、**code-graph（代码图谱：影响面、调用入口、MQ、定时任务、SQL 涉及的表）**、**md-to-wiki（发布文档到**

**Confluence）**、**create-tech-md-doc /create-release-md-doc（从 git diff 生成技术 / 上线方案）**

封装成通用项目级 Skills。在工作目录执行一条命令、选择环境，自动生成到各 AI 编程代理的项目级

技能目录，团队共享（可提交 git）。

支持环境：**Codex CLI / Claude Code / 豆包办公（Doubao）/ 千问（Qwen Code）**。

> 本文件夹自包含：初始化命令 + 模板都在
> `skills-init/`
> 下，脚本会以
> **上级目录**
> 作为项目根，
> 因此从项目任意位置引用均可（调用时保持脚本位于
> `<项目根>/skills-init/`
> 即可）。

## 快速开始

需要 **Node.js >= 22**（接入 DocNexus 时需 >= 22.13，code-graph 的 `impact` / `entry` 需 >= 22.5）。安装逻辑只有一份实现 `bin/skills-init.mjs`，两个脚本只是薄封装：

```
# 仓库放在 <项目根>/skills-init/ 时，在项目根执行
./skills-init/init-skills.sh          # macOS / Linux / Git Bash / WSL
.\skills-init\init-skills.ps1         # Windows PowerShell（需以管理员身份运行）
node skills-init/bin/skills-init.mjs --project-root .   # 直接调用，等价

# 或者不拷贝仓库，直接在任意项目根执行（npm 包）
npx @rowansenne/skills-init
```

按提示：选择环境（编号多选，回车 = 全部）→ 确认 / 填写数据库连接 → 自动生成。装完后在 agent 里运行 `/workflow profile` 填写项目画像。

非交互示例：



```
.\skills-init\init-skills.ps1 -Envs codex,claude,doubao,qwen -Yes   # 用现有配置，装全部环境
.\skills-init\init-skills.ps1 -Envs all -Yes -SkipDb                 # 跳过数据库，只装 project-review 等
```



```
./skills-init/init-skills.sh --envs all --yes                        # bash 版等价
./skills-init/init-skills.sh --envs codex,qwen --skip-db
./skills-init/init-skills.sh --envs claude,qwen --skip-db --with-docnexus   # 同时接入 DocNexus 文档库
./skills-init/init-skills.sh --envs all --skip-db --copy             # 不用软链接，各环境独立拷贝
./skills-init/init-skills.sh --uninstall                             # 按安装清单卸载（PowerShell：-Uninstall）
```

### 子命令

| 命令 | 作用 |
| --- | --- |
| `init`（默认，可省略） | 安装或重装 |
| `upgrade` | 读安装清单里记录的环境与模式，非交互升级到当前版本：保留数据库配置等用户配置，skills 文件一律更新为新版（手改过的先备份到 `tmp/skills/upgrade-backup/`）；已接入 DocNexus 时顺带导入新版本新增的文档模板（只新增，不改动已有模板） |
| `doctor` | 自检：已装版本与当前包对比、手改 / 缺失的文件、软链接是否断开、项目画像、DocNexus 模板是否齐全、各数据库连接能否只读 `SELECT 1`（`--offline` 跳过）、`.gitignore` 是否忽略了凭据。有错误时退出码 1 |
| `uninstall` | 等价于 `--uninstall` |
| `report` | 本地效果报告：只读统计 `docs/skills/` 下的产物（`--since YYYY-MM-DD`、`--all-branches`、`--json`；PowerShell 为 `-Since` / `-AllBranches` / `-Json`），见「workflow：入口与项目画像」 |
| `view` | 项目文档视图：按需求浏览开发方案、交付说明、审查记录（含复审修复情况）、技术 / 上线方案，生成本地静态页面（`--out <文件>`、`--open`；PowerShell 为 `-Out` / `-Open`） |
| `seed-templates` | 只把默认文档模板导入 DocNexus，不重装 skills。`--update` 把导入后未改动的模板更新为新版；`--diff` 只读打印团队改过的模板与新默认模板的差异，供手动合并 |

```
npx @rowansenne/skills-init upgrade      # 拿最新版升级
npx @rowansenne/skills-init doctor
./skills-init/init-skills.sh doctor --offline
.\skills-init\init-skills.ps1 doctor -Offline
```

## 安装路径与启用方式



| 环境          | 生成目录                         | 启用方式                                     |
| ----------- | ---------------------------- | ---------------------------------------- |
| codex       | `.agents/skills/`（**单一来源**，完整文件） | 重启 codex 自动发现；也可 `/use project-review` 手动加载 |
| claude-code | `.claude/skills/<skill>` → 软链接到 `.agents/skills/<skill>` | Claude Code 自动发现，无需额外配置                  |
| doubao      | `.agents/skills/`（与 codex 共用）   | 豆包办公自动发现（新会话生效）                          |
| qwen        | `.qwen/skills/<skill>` → 软链接到 `.agents/skills/<skill>` | Qwen Code 自动发现；`/skills` 面板可查看与切换        |

**单一来源 + 软链接**：skills 只在 `.agents/skills/` 装一份完整文件，`.claude/skills`、`.qwen/skills` 下按 skill 建相对软链接（`../../.agents/skills/<skill>`），改模板、填配置都只需改一处。因此即使只选了 claude 或 qwen，`.agents/skills/` 也会生成。

* 按 skill 建链接而不是链接整个目录，这样 `.claude/skills/` 里还能放其他 skill（例如 DocNexus 的链接）。
* 从旧版本（各环境独立拷贝）升级时，脚本会把旧拷贝里的用户配置（`config.json`、`schema.md`、`wiki-config.json`、`profile.json`）并入 `.agents/skills/`，原目录移到 `tmp/skills/backup/<时间>/<环境>/`；两边配置都填过且内容不同时不会自动合并，会保留旧目录并提示手动处理。
* Windows：安装与升级（`init` / `upgrade`）**必须在管理员终端执行**（建目录软链接需要该权限）；在普通终端运行会直接停下、不做任何改动，并提示改用「以管理员身份运行」的终端。`doctor`、`seed-templates`、`uninstall` 不要求管理员。少数文件系统仍建不了软链接时，该环境自动退回独立拷贝。在 Windows 上 clone 含软链接的仓库需要 `git config core.symlinks true`。
* 不想用软链接：加 `--copy`（PowerShell：`-Copy`），每个环境各装一份完整文件。

> Codex 也可选择额外安装到用户级
> `~/.codex/skills/`
> （所有项目可用），脚本会询问。

每个 skill 目录结构（四环境一致）：



```
<env-dir>/
├── workflow/                         # 入口：路由到各 skill、能力探测、维护共用项目画像
│   ├── SKILL.md
│   ├── scripts/resolve.mjs           # 模板来源 / 画像 / 能力探测的判定脚本
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
├── md-to-wiki/                       # 发布 md 到 Confluence wiki
│   ├── SKILL.md                      # GATE：wiki 未配置则禁止启动
│   ├── wiki-config.json              # wiki 连接（init 生成，默认 enabled=false，已 gitignore）
│   └── scripts/md-to-wiki.mjs        # md → Confluence Storage Format XHTML 转换 + 良构校验（Node，无依赖）
├── create-tech-md-doc/               # 从分支 diff 生成技术方案 md（按项目模板，没有就用样例创建）
│   ├── SKILL.md
│   └── template.md
├── create-release-md-doc/            # 从分支 diff 生成上线方案 md（按项目模板，没有就用样例创建）
│   ├── SKILL.md
│   └── template.md
└── dev/                              # 开发 / 修 bug：需求→调研→方案→实现→测试→自审→交付
    ├── SKILL.md
    └── references/plan-template.md   # M / L 规模方案模板
```

## workflow：入口与项目画像

```
/workflow            # 按请求路由到对应 skill；无具体请求时输出能力地图 + 状态
/workflow status     # 检查项目画像、wiki、DocNexus、数据库是否可用
/workflow profile    # 从仓库推断并经你确认后填写 workflow/profile.json
/workflow report     # 本地效果报告（也可以直接运行 npx @rowansenne/skills-init report）
```

**效果报告**（`/workflow report` 或 `skills-init report [--since YYYY-MM-DD] [--all-branches] [--json]`）只读统计 `docs/skills/` 下已落盘的产物，不上报、不另存记录，用来回答「用了以后有没有更好」。默认只看工作区；产物随特性分支提交、还没合并时加 `--all-branches`，用 git 只读扫描所有本地分支（同一路径以工作区为准）。统计内容：

* 审查：各级别发现条数、严重问题复核通过率、复审时上次问题的修复率；
* 交付：功能 / 缺陷、S / M / L、开工前经需求澄清确认的决定条数、带「未验证项」的交付；
* 知识：交付与审查的 DocNexus 沉淀率、正文引用了知识库文档的产物占比；
* 各分支链路：开发方案、交付说明、审查报告、技术方案、上线方案齐不齐，哪些文档还没发布到 wiki。

**PR / MR 描述**：`node <skills>/workflow/scripts/pr-desc.mjs [--branch b] [--base main] [--out 文件]` 把本分支的交付说明（做了什么、已确认的决定、改动、验证、配置 / SQL）、审查报告（结论、CRITICAL / HIGH、影响面）和相关文档路径汇总成描述；没有交付说明时退回用提交记录和改动文件列表。dev 交付后要提 PR 时会调用它；创建 PR 要你同意。

`workflow/profile.json` 是所有 skill 共用的项目事实，模板里不再写死任何公司或项目约定。缺失字段视为空，文档中对应位置写「待填写」。示例：

```json
{
  "main_branch": "master",
  "build": "mvn -q -DskipTests compile",
  "test": "mvn -q test",
  "test_single": "mvn -q test -Dtest={target}",
  "lint": "",
  "config_center": "nacos",
  "deploy": { "platform": "内部发布平台", "regions": ["华东-生产", "华南-生产", "海外-生产"] },
  "job_annotation": "@XxlJob",
  "data_review": true,
  "notes": ["技术方案的「上线服务」与「数据链路」为必填"]
}
```

| 字段 | 影响 |
| --- | --- |
| `main_branch` | dev、project-review、文档类的 diff 基线 |
| `build` / `test` / `test_single` / `lint` | dev 的编译与测试 |
| `config_center` | project-review 第 10 维度（配置中心下发的 key 不算缺失）、dev 配置清单、上线方案的上线顺序与配置回滚 |
| `deploy` | 技术 / 上线方案「上线服务」的服务名与环境说明 |
| `job_annotation` | 技术方案「定时任务变更」识别任务类 |
| `data_review` | 是否输出技术方案模块 7 与上线方案 2.3 的库表评审块 |

旧版本的 `dev/profile.json` 会在重跑 init 时自动迁移为 `workflow/profile.json`。

## dev：开发与修 bug

```
/dev <需求描述 | PRD pageId/url>     # 功能开发
/dev --bug <现象 | 报错 | 日志>       # 缺陷修复
```

* **功能开发**：理解需求（可读 PRD、查 DocNexus 历史决策）→ 调研现有代码 → 需求澄清（借鉴 grill-me：按决策树分轮提问，每题给推荐答案；事实自己查、决定交给用户；S 规模无未定决定时跳过）→ 按规模出方案（S 直接做；M 对话内方案待确认；L 落盘方案文档待确认）→ 小步实现并编译 → 补测试并运行 → 用 project-review 自审 → 交付说明落盘到 `docs/skills/requirements/<需求名>/delivery.md`（带分支元信息；改动、验证结果、配置清单、未执行的 SQL），已接入 DocNexus 时每次都问要不要沉淀（同意后以 `dev-notes` 分类写入，并把库内路径记回交付说明）。审查和上线方案会按分支自动读取这份交付说明。
* **S 规模快速通道**：S 规模且不涉及配置、SQL / DDL、对外接口、表结构，也没有需要澄清的决定时，编译、测试、自审照常，但只在对话里交付，不落盘交付说明、不问沉淀；实现中碰到上述任何一项或改动超过 3 个文件，就退回完整流程。缺陷修复同样适用（根因仍须在对话里写清楚）。
* **缺陷修复**：收集现象 → 用失败测试复现 → 用证据定位根因 → 最小修复让测试转绿 → 自审 → 交付（必须写明根因）。
* 守则：不写库、不改凭据、不擅自 commit / push、不装新依赖；测试没跑就写「未验证」。
* 其他 skill 都是可选增强：wiki、DocNexus、数据库没配置时自动跳过，并在交付说明中注明。

## 参数



| 参数                      | 说明                                                                    |
| ----------------------- | --------------------------------------------------------------------- |
| `-Envs` / `--envs`      | 环境列表，逗号分隔：`codex,claude,doubao,qwen`；`all` = 全部                       |
| `-SkipDb` / `--skip-db` | 跳过数据库连接配置（database-query 不生成 config.json）                             |
| `-WithDocNexus` / `--with-docnexus` | 可选：接入 [DocNexus](https://www.npmjs.com/package/@rowansenne/docnexus) 项目文档库（需 Node >= 22.13），见下方「DocNexus 文档库（可选）」 |
| `-WithCodeGraph` / `--with-codegraph` | 可选：接入 [CodeGraph](https://github.com/colbymchenry/codegraph) 代码图谱，见下方「CodeGraph 代码图谱（可选）」 |
| `-Copy` / `--copy`      | 不建软链接，各环境独立拷贝一份完整 skills                                  |
| `--skills <列表>` | 只装这些 skill（逗号分隔），自动带上 `requires` 依赖；之后可以再用 `--skills` 补装，已装的保留；`upgrade` 只升级装过的。不含 database-query 时不询问数据库 |
| `-SeedTemplates` / `--seed-templates` | 把自带的文档模板导入 DocNexus（已有的不覆盖）；接入 DocNexus 后文档类 skill 只从知识库取模板。`--with-docnexus` 会自动执行 |
| `-Uninstall` / `--uninstall` | 按安装清单卸载本项目装的 skills 与链接，见下方「卸载」 |
| `-Offline` / `--offline` | `doctor` 不测试数据库连通性 |
| `-Yes` / `--yes`        | 非交互：自动使用已有数据库配置（依次查找 `.codex/database-query/config.json` 与各环境已安装的 `database-query/config.json`）；都没有且未 `-SkipDb` 时报错退出 |
| `--project-root`        | 项目根目录；直接调用 `bin/skills-init.mjs` 时默认当前目录，两个封装脚本自动传上级目录 |
| `-v` / `--version`      | 显示版本                                                                |
| `-h` / `--help`         | 帮助                                                                    |

## DocNexus 文档库（可选）

加 `--with-docnexus`（PowerShell：`-WithDocNexus`）时，脚本在装完本仓库的 skills 后额外执行：

1. 检查 Node >= 22.13 与 npm（不满足时**在安装任何文件之前**报错退出）；
2. 执行 `npm install --prefix ./docnexus --save-exact @rowansenne/docnexus`：按 DocNexus 0.17.0 起的装法装在 `docnexus/` 下，npm 清单、锁文件和依赖不进宿主项目的 `package.json`。之前已经装在项目根（`node_modules/.bin/docnexus`）的项目沿用原位置升级；skills 两种位置都认，都有时用 `docnexus/` 下的；
3. 执行 `./docnexus/node_modules/.bin/docnexus init --agent <claude|codex|all>`：创建 `docnexus/` 工作区，把 DocNexus 的 skills 同步到 `docnexus/skills/`，并软链接到对应环境目录、写入 `CLAUDE.md` / `AGENTS.md` 的 DocNexus 段落；
4. `.gitignore` 追加 `node_modules/`。

环境映射：

| 所选环境 | `--agent` | 说明 |
| --- | --- | --- |
| claude | `claude` | 链接到 `.claude/skills/`，写 `CLAUDE.md` |
| codex / doubao | `codex` | 两者共用 `.agents/skills/`，写 `AGENTS.md` |
| claude + (codex 或 doubao) | `all` | 以上两者 |
| qwen | —（仅 qwen 时为 `none`） | docnexus 不支持 qwen：由本脚本把 `docnexus/skills/*` 软链接到 `.qwen/skills/`；不写 `QWEN.md`，需要自动召回时可在 `QWEN.md` 引用 `AGENTS.md` 的 DocNexus 段落，或在 `.qwen/settings.json` 的 `context.fileName` 加入 `AGENTS.md` |

说明：

* DocNexus 的 skills 不在本仓库中，始终以安装的 npm 包为准；重跑脚本会按包版本重新同步与链接（`docnexus init` 可重复执行，不影响已有记忆）。
* `.qwen/skills/` 下已存在的同名**真实目录**不会被替换，脚本会提示跳过。
* npm 安装或 `docnexus init` 失败时只跳过 DocNexus，本仓库的 skills 照常安装，脚本最后以退出码 1 结束；修好后重跑即可。
* 安装后 `dev`、`project-review` 会先按 `docnexus-recall` 查项目约定；`dev`、`project-review` 交付时**每次都问**要不要沉淀（写入后把库内路径记回交付说明 / 审查报告的「DocNexus」元信息行），`create-tech-md-doc`、`create-release-md-doc` 结束时有值得记的内容才**提议**沉淀；**任何写入 DocNexus 的操作都必须经你授权**。
* 离线或测试时可用环境变量指定安装来源，例如 `DOCNEXUS_PKG=/path/to/rowansenne-docnexus-0.13.0.tgz ./skills-init/init-skills.sh --with-docnexus`（PowerShell：`$env:DOCNEXUS_PKG=...`）。
* Windows 上 qwen 的链接使用目录 junction（与 docnexus 的做法一致）；Git Bash 下 `ln -s` 是否生成真正的链接取决于 MSYS 设置，建议 Windows 用 PowerShell 版。

## CodeGraph 代码图谱与 code-graph skill（可选）

[CodeGraph](https://github.com/colbymchenry/codegraph)（MIT，100% 本地）把项目预先解析成代码知识图谱。图谱里有：
- 符号、调用边、继承 / 实现（含接口到实现的调用）；
- Spring 路由；
- MyBatis XML 语句与 Mapper 接口的对应；
- `@Value` 配置 key。

本项目的集成分两层：

- **CodeGraph 本身（外部依赖）**：解析与图谱由上游维护。全局装一份，各项目各建索引 `.codegraph/`；Claude Code / Codex 还能直接用它的 MCP 工具 `codegraph_explore` 读代码。
- **code-graph skill（自己的封装）**：`code-graph/scripts/cg.mjs` 调用 CodeGraph 的库（`CodeGraph.openSync` / `getNodesInFile` / `getCallers` / `getCallees`），面向本工作流做查询，并补上 CodeGraph 看不到的 Java / Spring 关联：

| 命令 | 作用 |
|---|---|
| `cg.mjs impact --diff <main>...<dev>` / `--base <main>` | 从 diff 找到改动的方法、配置常量、XML 语句，向上追调用方（默认 3 层），一次给出：受影响的 **HTTP 接口**、**MQ 消费者**（含 topic）、**定时任务**；受影响的代码文件；受影响和改动过的**测试**；向下调用到的 **SQL 语句与表**；改动的**配置 key**；删除的文件 |
| `cg.mjs entry <Class.method>` | 一个方法向上能到达哪些入口（接口、消费者、定时任务），以及哪些测试覆盖它 |
| `cg.mjs mq [--topic t]` | topic 的消费方（`@KafkaListener`、`@RabbitListener`、`@RocketMQMessageListener`、`@JmsListener`、`@StreamListener`）与生产方（`*Template.send/convertAndSend/syncSend…`） |
| `cg.mjs jobs` | `@Scheduled`、`@XxlJob` 定时任务入口 |
| `cg.mjs tables [--table t]` | MyBatis XML 语句（namespace.id）涉及的表 |
| `cg.mjs status` | 索引与库是否可用 |

`mq`、`jobs`、`tables` 只扫源码，没有索引也能用。`impact`、`entry` 需要 `.codegraph/` 索引和 CodeGraph 的库（Node >= 22.5）；缺了就退出码 2 并说明原因，skill 会退回 grep / 读文件。

dev、project-review、技术方案、上线方案都在对应环节调用它：
- **dev**：改公共方法前看入口；验证时先跑受影响的测试；交付说明里写受影响的接口 / 表 / 配置。
- **project-review**：「影响面」按入口归纳。
- **技术方案、上线方案**：影响范围、中间件上线、回归验证参考 `impact` 的结果。

用法约定见 `workflow/references/codegraph.md`。

### 安装：`--with-codegraph`

加 `--with-codegraph`（PowerShell：`-WithCodeGraph`）时，装完 skills 后额外执行：

1. 找不到 `codegraph` 命令时执行 `npm i -g @colbymchenry/codegraph@1`。全局装 CLI 和库（平台包约 300MB，所以不在每个项目里各装一份）；code-graph skill 按 1.x 的库接口编写。
2. 所选环境里有 claude / codex 时，执行 `codegraph install --target=<claude,codex> --location=local --yes`，把 MCP 配置写进本项目：
   - claude：`.mcp.json`、`.claude/settings.json`（自动放行 `codegraph_explore`）、`.claude/CLAUDE.md`；
   - codex：`.codex/config.toml`、`AGENTS.md`；Codex 只在受信任的项目里加载项目级配置。
   - doubao、qwen 不在 CodeGraph 支持的 agent 里，在这两个环境用 code-graph skill 和 `codegraph` CLI。
3. 执行 `codegraph init <项目根> --yes` 建索引，生成 `.codegraph/`（本地 SQLite），并把它加入 `.gitignore`。之后 agent 使用期间自动增量同步；`cg.mjs` 发现索引落后于工作区时也会先 `codegraph sync`。

* 能力探测：`resolve.mjs status` 的 `codegraph`（`ok` = 有 `.codegraph/` 且 `codegraph` 命令可用）。`/workflow status` 和 `doctor` 都会显示。
* 没有 `.codegraph/` 时，skills **不会自己建索引**，只在交付或报告里注明「未使用代码图谱」。要不要建索引由你决定。
* 本工具和 `cg.mjs` 调用 codegraph 时都带 `DO_NOT_TRACK=1`。但 CodeGraph 自身默认上报匿名使用统计（不含代码、路径、符号名），`--yes` 不会询问；需要关闭时运行 `codegraph telemetry off`。
* 静态分析的局限：Spring 多实现的选择、AOP、反射、配置驱动的路由看不到；图谱里「没有调用方」不等于没人用。
* 卸载：`codegraph uninstall` 移除 agent 配置和 CLI，`codegraph uninit` 删除本项目的索引。

## 重跑与升级

可以放心重复执行 init 来升级模板；只想按原来的环境升级时用 `skills-init upgrade`，不用再选一遍：

* `SKILL.md`、`references/checklist.md`、`template.md`、脚本等**模板文件会被更新**；但被你**手动改过**的模板文件不会被静默覆盖（见下方「安装清单」）；
* 新版本模板里已删除的文件会被清理；你改过的不删，保留并在结尾提示；
* 用户填过的 `md-to-wiki/wiki-config.json`、`database-query/references/schema.md`、`workflow/profile.json` **保留不覆盖**；
* `database-query/config.json` 只在本次确认或填写了数据库配置时写入；`--skip-db` 时保留已有文件；
* `.gitignore` 规则无论是否配置数据库都会补齐（只追加缺失的行）；
* 安装器按 skill 目录自动发现文件（`*.tpl` 去掉后缀），新增 `references/` 文件不需要改安装器。
* skill 的元数据只写在各目录的 `skill.json` 里（见下方「skill.json」），安装器、`seed-templates` 和 `resolve.mjs` 都从它读取。
* `code-review` 已改名为 `project-review`（避免与 Claude Code 内置的 `/code-review` 撞名）：重跑时自动移除旧名的目录和链接；只删能确认是本项目装的那份，你自己的同名 skill 不动。
* 设置环境变量 `SKILLS_INIT_NO_SYMLINK=1` 可强制不建软链接（各环境独立拷贝）；无法建链接时会先探测，旧目录原样保留、只更新模板。

### 安装清单

每次安装后在 `.agents/skills/.skills-init.json`（`--copy` 时各目标目录各一份）写入清单：安装器版本、安装时间、所选环境、安装模式，以及每个 skill 的模板文件相对路径与 sha256。用户配置（`config.json`、`schema.md`、`wiki-config.json`、`profile.json`）只记录存在与否，不记哈希，重跑和升级都不覆盖。

**skills 目录里的其他文件（SKILL.md、skill.json、references、scripts）一律以安装包为准**，重跑和升级时总是更新为新版，不询问、不生成 `.new`：

| 情况 | 处理 |
| --- | --- |
| 当前内容与清单记录一致（没改过） | 直接更新 |
| 与清单记录不同（手改过），或没有清单无从判断 | 原文件先备份到 `tmp/skills/upgrade-backup/<时间>/<相对项目根的路径>`，再更新为新版；结尾列出这些文件和备份目录 |
| 清单里有、新版里已没有 | 没改过直接删除；改过的备份后删除 |

* 这样 `SKILL.md`、`skill.json`、脚本始终是同一个版本，不会出现「新 SKILL.md 配旧 skill.json」的混搭。
* 项目自己的定制不要改 skills 目录里的文件，放到不会被覆盖的地方：项目事实和约定写 `workflow/profile.json`（约定写 `notes`），文档结构用 `docs/skills/templates/<skill>/` 或 DocNexus 里的模板，通用规则写 `CLAUDE.md` / `AGENTS.md`。
* 旧版本留下的 `<文件名>.new` 在升级时一并删除；需要找回手改内容时到备份目录里取。

### 卸载

```
./skills-init/init-skills.sh --uninstall       # PowerShell：.\skills-init\init-skills.ps1 -Uninstall
```

按清单移除本项目安装的 skill 文件、`.claude/skills` 与 `.qwen/skills` 下指向 `.agents/skills` 的软链接，以及清单本身：

* 用户配置（`config.json`、`schema.md`、`wiki-config.json`、`profile.json`）和手改过的模板文件先移到 `tmp/skills/uninstall-backup/<时间戳>/<安装目录>/<skill>/`，结尾列出；
* 不在清单里的文件、你自己的 skill 和链接都不动；skill 目录里还有你自己加的文件时保留该目录并提示；目录清空后才删除；
* `.gitignore` 里追加的规则和 DocNexus 不处理；没有清单时什么也不做。
* 用户级 `~/.codex/skills` 不在卸载范围内。

### skill.json

每个 skill 目录下有一份 `skill.json`，是这个 skill 元数据的唯一来源：

```json
{
  "name": "create-tech-md-doc",
  "order": 6,
  "userFiles": {},
  "requires": ["workflow"],
  "optional": ["md-to-wiki", "create-release-md-doc"],
  "shared": ["diff-collection-common.md", "prd-fetch.md"],
  "templates": [{ "id": "template.md", "src": "template.md", "title": "技术方案模板", "summary": "...", "lint": { "requiredMeta": ["模板来源"] } }],
  "docnexus": { "category": "tech-design", "reason": "create-tech-md-doc skill 从技术方案中沉淀的决策、约定与风险", "readFrom": ["create-tech-md-doc", "dev"] },
  "renamedFrom": {}
}
```

| 字段 | 含义 |
| --- | --- |
| `name` / `order` | 与目录名一致；安装和展示顺序 |
| `userFiles` | 用户配置（安装后的相对路径 → 对应空模板的源路径或 `null`），重跑不覆盖，卸载时备份 |
| `templates` | 可由 DocNexus 接管的文档模板，知识库路径为 `templates/<skill>/<id>` |
| `renamedFrom` | 旧名 → SKILL.md 签名正则；升级时只清理能确认是本项目装的旧目录 |
| `requires` | 运行时必需的 skill（会调用它的脚本或读它的文件）；`--skills` 安装时自动带上 |
| `optional` | 协作但非必需的 skill：没装时跳过对应增强（如 PRD 读取、自审），不报错 |
| `shared` | 共享参考文件：源在仓库 `shared/`，安装时拷进本 skill 的 `references/`。仓库里只维护一份，装好后每个 skill 自带完整文件，运行时不依赖别的 skill |
| `docnexus` | 本 skill 写入 DocNexus 时的显式分类 `{ category, reason }`。写入时以调用方显式分类封存（`draft seal --category`），不走 DocNexus 的模型分类；项目可在 `workflow/profile.json` 的 `docnexus_categories` 里按 skill 覆盖。`readFrom` 列出开工前要参考哪些 skill 的沉淀，`knowledge.mjs` 按它们的分类列出文档 |

当前分类与参考关系：

| skill | 写入分类 | 开工前参考（readFrom） |
| --- | --- | --- |
| `dev` | `dev-notes` | dev、create-tech-md-doc、project-review |
| `project-review` | `code-review` | project-review、dev |
| `create-tech-md-doc` | `tech-design` | create-tech-md-doc、dev |
| `create-release-md-doc` | `release-plan` | create-release-md-doc、create-tech-md-doc |

导入的模板固定为 `doc-template`；`database-query`、`md-to-wiki` 不读写知识库。这样形成闭环：审查发现的反复问题沉淀为 `code-review`，下次 dev 开工前会被列出来。测试会检查：SKILL.md 里有 DocNexus 写入步骤的 skill 必须声明分类并通过 `resolve.mjs category` 取用；`readFrom` 只能引用声明了分类的 skill，且 SKILL.md 里有对应的 `knowledge.mjs` 调用。

`tests/test-skills-meta.mjs` 会检查：skill 的文件里出现了别的 skill 的路径（如 `md-to-wiki/scripts/…`、`workflow/scripts/…`），就必须在 `requires` 或 `optional` 里声明；`requires` 声明了就必须真的用到，而且不能成环。

当前依赖关系：`workflow` 是共享核心（模板来源、画像、文档自检脚本），`dev`、`project-review`、两个文档 skill 依赖它；`database-query`、`md-to-wiki` 完全独立；wiki 凭据只由 `md-to-wiki` 的脚本读取，其他 skill 拉 PRD 统一调用 `upload.mjs get`。

新增一个 skill 就是新建目录、写 `SKILL.md.tpl` 和 `skill.json`，再加进 `package.json` 的 `files`。`tests/test-skills-meta.mjs` 会检查它们是否一致。

## 脚本化的规则

能写成确定规则的判断都放在脚本里，SKILL.md 只说明什么时候调用，不再让 agent 按文字描述自己判断：

| 脚本（安装后在 `<skills>/` 下） | 作用 |
| --- | --- |
| `workflow/scripts/resolve.mjs template <skill> <文件名>` | 判定用哪份模板：已接入 DocNexus 只用知识库，缺失时退出码 2 并给出导入来源；未接入时项目文件优先，其次默认模板 |
| `workflow/scripts/resolve.mjs profile` | 读项目画像，列出空字段 |
| `workflow/scripts/knowledge.mjs <skill> [--match 词] [--limit n] [--query 问题]` | 按 `readFrom` 的分类列出 DocNexus 文档（标题、摘要、路径，不含正文）；`--query` 再在每个分类内 `recall --category`（DocNexus 0.16.0 起），旧版自动退回只列文档并提示。未接入时退出码 2 |
| `workflow/scripts/resolve.mjs category <skill>` | 该 skill 写入 DocNexus 时的显式分类（画像 `docnexus_categories` 优先，其次 skill.json），输出 `seal_args` 与 `metadata`；未声明时退出码 1 |
| `workflow/scripts/resolve.mjs status` | `/workflow status` 的能力探测（不输出任何凭据） |
| `workflow/scripts/resolve.mjs infer-profile` | 按固定规则从构建文件、Makefile、依赖与配置文件、git 推断项目画像草稿，每个字段附依据；不写文件 |
| `workflow/scripts/lint-doc.mjs <文档> --skill <skill> [--facts]` | 对照当前生效的模板检查生成的文档：必填章节、残留 `{{...}}` 占位符、元信息行为错误；缺普通章节、顺序不一致为警告；列出待填写位置。`--facts` 再核对正文里的类名、文件、接口、表名：在对比分支的 diff 和代码里都找不到的记为警告（防编造） |
| `workflow/scripts/requirement.mjs which / bind / path / sync / list / migrate` | 产物按需求归档：查当前分支绑定的需求（没绑定时给出按分支名生成的建议名）、绑定需求名、给出本次落盘路径（不覆盖，带上一版的 wiki 记录）、重建 `meta.json`、列出所有需求、把旧布局的产物迁进需求目录 |
| `workflow/scripts/view.mjs [--out f] [--open]` | 项目文档视图（`/workflow view`、`skills-init view`）：读需求目录（和旧布局）里的产物，生成单个 HTML，按需求列出各阶段、审查记录（各级别数量、复核、与上次对比）、交付记录，正文直接渲染；数据内嵌，只读、不联网，默认写到 `tmp/skills/view/index.html` |
| `workflow/scripts/artifacts.mjs [--branch b \| --all]` | 按分支汇总 `docs/skills/requirements/`（及旧版 `docs/skills/<skill>/`）下的开发方案、交付说明、审查报告、技术方案、上线方案及其 wiki 发布记录，给出下一步建议；分支取自文档元信息行，不另存记录。上线方案没传 `--tech` 时据此自动引用同分支的技术方案；project-review 据此对照本分支方案、识别复审 |
| `workflow/scripts/report.mjs [--since d] [--all-branches] [--json]` | 本地效果报告（`/workflow report`、`skills-init report`）：审查发现与修复率、复核率、需求澄清、沉淀率、知识引用、各分支链路 |
| `workflow/scripts/tables.mjs [--diff b...h \| --base b \| --files a,b]` | 找出改动涉及哪些表：实体注解（`@TableName` / `@Table`，没写表名时按类名推断）、Mapper XML 与代码里的 SQL、DDL 脚本；标出 DDL、是否在 `schema.md` 里，并给出拉表结构的命令。dev 调研 / 自检与 project-review 审 SQL / DDL 时使用 |
| `workflow/scripts/template.mjs list / draft / check / save <模板>` | 修改 / 创建模板（`/workflow template`）：把当前模板复制成草稿（或 `--from <样例>` 抽骨架），`check` 校验格式、列出章节变化、拿最近几份已生成文档试跑 lint 看影响，`save` 备份旧模板后写入项目模板并确认生效；已接入 DocNexus 时 `save` 给出 capture 指引，不直接写知识库 |
| `workflow/scripts/pr-desc.mjs [--branch b] [--base m] [--out f]` | 按本分支产物生成 PR / MR 描述；没有交付说明时退回用 git 记录 |
| `database-query/scripts/query.mjs` | 执行 SQL：选连接、取密码（只通过环境变量传给客户端）、会话层只读、拦截写语句和多语句、自动补 LIMIT、超时、脱敏敏感列；支持 mysql / psql 客户端，其他 driver 退回 JDBC |
| `database-query/scripts/query.mjs --schema [--tables a,b] [--write]` | 按只读会话导出表结构为 Markdown；`--write` 写入 `references/schema.md` 的 `schema:begin` / `schema:end` 之间，标记外的补充说明保留；指定的表在库里不存在时标出 |
| `database-query/scripts/query.mjs --schema --tables a,b --indexes` | 另外列出索引（唯一与否、列顺序）和估算行数，供 dev / project-review 核对字段、索引支撑和 DDL 锁表风险 |
| `md-to-wiki/scripts/upload.mjs info / put / target / record` | REST 上传通道：`info` 读页面标题与版本给用户确认；`put --expect-version <n> [--record <md>]` 先校验 XHTML 良构，版本对不上就拒绝上传，上传后确认版本 +1，并把发布记录写回 Markdown 第一行注释（转换时丢弃，不出现在页面上）；`target` 读出记录，再次发布同一文档不必再给 pageId；`record` 供 MCP 通道上传后补写 |

## 测试

```bash
npm test                                  # bash 冒烟测试 + 全部 node 测试
node --test "tests/*.mjs"                 # 只跑 node 测试（三个平台都能跑）
```

node 测试覆盖：skill.json 一致性、子命令（upgrade / doctor / seed-templates / uninstall）、`resolve.mjs` 与画像推断、`lint-doc.mjs`（含 `--facts` 核对，用临时 git 仓库）、`artifacts.mjs`、`knowledge.mjs`、`query.mjs` 与表结构导出（用假的 mysql / psql 客户端）、md-to-wiki 转换与上传（用本地假 Confluence 服务）、DocNexus 模板导入与版本跟踪（用假的 docnexus CLI）。

安装器的黑盒场景都在 `tests/test-install.mjs`，三个平台共用：每个用例在临时目录放一份 skills-init 副本，执行安装后检查目录、软链接和配置。覆盖全新安装（单一来源 + 相对软链接）、`SKILLS_INIT_NO_SYMLINK=1` 退回独立拷贝、`--copy`、`--yes` 无数据库配置时退出码 1、含 `/ & | " \` 的密码、重跑保留用户配置、安装清单、手改的 skill 文件备份后更新为新版（含清理旧版本的 `.new`）、删除模板文件后的清理（改过的先备份）、卸载与备份、从旧版各环境独立拷贝升级（用 git 历史中 `71a23c8` 的旧脚本生成旧布局，浅克隆时先 `git fetch --unshallow`）、两边配置冲突、`.gitignore` 只追加缺失规则。

`tests/test-init-skills.sh` / `.ps1` 只是封装脚本的冒烟测试：确认以上级目录为项目根、参数与子命令原样透传、stdin 交互可用。

```bash
bash tests/test-init-skills.sh                     # bash 版（兼容 macOS 自带的 /bin/bash 3.2，需要 python3）
pwsh -NoProfile -File tests/test-init-skills.ps1   # PowerShell 版
```

CI（`.github/workflows/test.yml`）在 push 到 main 和每个 PR 上运行：三个平台都跑全部 node 测试；另外 macOS 用 `/bin/bash`、Ubuntu 用 bash 跑 bash 冒烟测试，Windows 用 pwsh 跑 PowerShell 冒烟测试。

## 发布

1. 在 `CHANGELOG.md` 的 `[Unreleased]` 下记录改动，发布时改成 `## [x.y.z] - 日期`，同步改 `package.json` 的 `version`。
2. 推送 `vx.y.z` tag：`.github/workflows/release.yml` 校验 tag 与版本、CHANGELOG 一致，跑测试，然后用 npm Trusted Publishing 发布（不需要 npm token / OTP）。
3. 首次使用前需要在 npmjs.com 的包设置 → Trusted Publisher 里登记 GitHub 仓库 `guilianerde/skills-init` 与工作流 `release.yml`。

## 凭据安全



* **数据库**：连接配置从已有 `.codex/database-query/config.json` 自动迁移，或按提示填写。

  生成后 `**/database-query/config.json` 追加到 `.gitignore`，**请勿提交**。

* **wiki**：连接配置**默认留空**（`enabled: false`）。启用时填写各环境

  `md-to-wiki/wiki-config.json` 的 `base_url` / `api_token`；`**/wiki-config.json` 同样加入

  `.gitignore`，**请勿提交**。

* 技能内置安全规则：database-query 只读查询优先、写操作必须用户确认、敏感字段脱敏、

  不在对话中输出密码。

## wiki 能力说明（连接空着不启动）



* `md-to-wiki` 带 **GATE**：执行前先读 `wiki-config.json`，若文件缺失 / `enabled` 非 true /

  `base_url` 为空 → **立即停止**，提示用户补配，不做任何转换与上传。

* `create-tech-md-doc` / `create-release-md-doc` 的 `--prd`**&#x20;增强**同样受 GATE 约束：

  未配置时自动回退纯 diff 流程（文档生成主流程不受影响）。

* 启用方式（三选一）：

1. 填写 `md-to-wiki/wiki-config.json`：`enabled: true` + `base_url`（如

   `https://wiki.example.com`）+ `api_token`（Confluence PAT）；

2. 环境接入 Confluence MCP（如 Claude Code 的 `wiki-mcp`），SKILL.md 会优先走 MCP 通道；

3. 同时保留 `remote_url` 字段记录远程 MCP 地址（可选）。

* 上传通道自动选择：环境有 wiki MCP 工具 → 用工具；否则用 `wiki-config.json` 的 REST 参数

  调 Confluence REST API。

## 产物输出规范（统一落位）

一个需求的文档产物放在**同一个需求目录**里，开发方案、交付说明、审查报告、技术方案、上线方案一起看：

```
docs/skills/requirements/<需求名>/
├── meta.json        # 需求名、绑定的分支、各产物（版本、日期、wiki 发布记录、DocNexus 沉淀），给以后的可视化用
├── plan.md          # 开发方案（dev，L 规模）
├── delivery.md      # 交付说明（dev，每次完整交付都写）
├── review.md        # 审查报告（project-review）；复审 review_v2.md、review_v3.md
├── tech-doc.md      # 技术方案
└── release-doc.md   # 上线方案
```

* **需求名由你定**：dev 确定是 M / L 规模（要落盘）时，或从 `/workflow` 完整链路开始时，如果当前分支还没有绑定需求，会问你这个需求叫什么（默认值按分支名生成；也可以选已有的需求，例如修 bug 的新分支挂到原需求下）。你不起名就按分支名生成。绑定后，同一分支上的各 skill 都写到这个目录，不再问。一个需求可以绑定多个分支。
* 路径由 `workflow/scripts/requirement.mjs path <种类>` 给出，同种产物已存在时加 `_v2`、`_v3`，不覆盖旧文件；上一版发布过 wiki 时，新版沿用同一个页面。
* 需求目录写在项目根的 `.ignore` 里，ripgrep 和 agent 的代码搜索会跳过它，产物多了不会污染搜索结果（找历史决策用 DocNexus）。git 不受影响，建议随代码提交。
* 升级时安装器会把旧版 `docs/skills/<skill>/` 下的产物按「对比分支」搬进需求目录（`git mv`，保留历史）。需求名取交付说明或开发方案里的需求短名，没有就用分支名，可以在 `meta.json` 里改。文档里引用的旧路径（「参考产物」等）一并改成新路径；搬迁记录存在 `meta.json` 的 `migrated_from`，之后从其他分支合进来、还引用旧路径的文档，再跑一次迁移（`requirement.mjs migrate` 或下次升级）也会改对。元信息里没有分支的文件留在原处，其中的旧路径同样会改。

**浏览**：`/workflow view` 或 `skills-init view --open` 生成一个本地页面（`tmp/skills/view/index.html`）。左边是需求列表，可按名称或分支搜索；右边是这个需求的各阶段、审查记录（每轮的级别数量、复核、与上次对比的修复情况）、交付记录，以及各份文档的渲染正文。页面是生成那一刻的快照，产物有更新时重新生成。

其他产物：

| 技能 | 产物 | 位置 |
| --- | --- | --- |
| database-query | 查询结果 | 默认对话输出；导出时 `tmp/skills/database-query/result-<时间戳>.csv` |
| md-to-wiki | 转换临时 XHTML | `tmp/skills/md-to-wiki/_wiki_upload_<时间戳>.html`（上传后可删） |
| 各文档类 skill | 项目模板 | `docs/skills/templates/<skill>/`（见下文「模板」） |

规则：

* `docs/skills/` 是**持久产物**目录，可提交 git，团队共享。
* `tmp/skills/` 是**临时产物**目录，`init-skills` 自动把 `/tmp/` 加入 `.gitignore`，不入库。

## 自定义模板

初始化命令与模板集中在 `skills-init/` 一个文件夹（`.tpl` 后缀不会被任何平台误加载）：



```
skills-init/
├── bin/
│   ├── skills-init.mjs                # 安装器入口（唯一实现，Node >= 22）：参数解析与 init / upgrade / doctor / uninstall / seed-templates / report 调度
│   ├── lib/                           # core / prompt / db / install / uninstall / docnexus / doctor
│   ├── skills.mjs                     # 读取各 skill 的 skill.json
│   └── seed-templates.mjs             # 把文档模板导入 DocNexus
├── init-skills.sh / init-skills.ps1   # 薄封装：以上级目录为项目根调用安装器
├── package.json                       # npm 包信息（bin: skills-init）
├── shared/                            # 多个 skill 共用的参考文件（diff-collection-common.md、prd-fetch.md），安装时按 skill.json 的 shared 拷入
├── tests/                             # node 测试 + 封装脚本冒烟测试（bash / pwsh）
├── evals/trigger-cases.json           # 多 skill 分流评估用例
├── scripts/eval-triggers.mjs          # 分流评估脚本
├── README.md                          # 本说明
├── workflow/
│   ├── SKILL.md.tpl · skill.json
│   ├── scripts/resolve.mjs            # 模板来源 / 画像 / 画像推断 / 能力探测
│   ├── scripts/lint-doc.mjs           # 对照模板检查生成的文档
│   ├── scripts/infer-profile.mjs      # 画像推断规则（resolve.mjs infer-profile 调用）
│   ├── scripts/knowledge.mjs          # 按分类列出相关的 DocNexus 文档
│   ├── scripts/artifacts.mjs          # 按分支汇总各 skill 产物与 wiki 发布记录
│   ├── scripts/report.mjs             # 本地效果报告
│   ├── scripts/pr-desc.mjs            # 按本分支产物生成 PR / MR 描述
│   ├── scripts/template.mjs           # 修改 / 创建模板：草稿 → 校验与影响 → 保存
│   ├── scripts/tables.mjs             # 找出改动涉及的数据库表
│   ├── scripts/requirement.mjs        # 产物按需求归档：绑定需求名、落盘路径、meta.json、旧布局迁移
│   ├── scripts/view.mjs               # 项目文档视图（本地静态页面）
│   ├── scripts/make-template.mjs      # 从样例文档抽模板骨架
│   ├── scripts/doc-sections.mjs       # 读产物的章节、表格、元信息（report / pr-desc 共用，标题解析复用 lint-doc）
│   ├── references/                    # profile.md、templates.md、docnexus.md、status.md、tables.md、requirements.md、codegraph.md（其他 skill 直接读对应文件）
│   └── profile.json.tpl               # 空画像，首次使用时由 agent 推断并经确认后填写
├── dev/
│   ├── SKILL.md.tpl · skill.json
│   └── references/                    # plan-template.md（方案模板）、delivery-template.md（交付模板）
├── project-review/
│   ├── SKILL.md.tpl · skill.json
│   └── references/                    # checklist.md.tpl、report.md.tpl（报告模板）、diff-strategy.md
├── code-graph/
│   ├── SKILL.md.tpl · skill.json
│   └── scripts/cg.mjs                 # 调 CodeGraph 库 + 扫源码补 MQ / 定时任务 / XML 表
├── database-query/
│   ├── SKILL.md.tpl · skill.json
│   ├── scripts/query.mjs              # 只读查询执行与表结构导出
│   └── references/                    # config.example.json、schema.md.tpl
├── md-to-wiki/
│   ├── SKILL.md.tpl · skill.json
│   ├── wiki-config.json.tpl
│   ├── references/                    # upload.md（上传通道）、troubleshooting.md（脚本与排错）
│   └── scripts/                       # md-to-wiki.mjs（转换 + 良构校验）、upload.mjs（REST 上传）
├── create-tech-md-doc/
│   ├── SKILL.md.tpl · skill.json
│   └── references/                    # diff-collection.md（分层采集）、prd.md（PRD 拉取）；模板不随包提供
└── create-release-md-doc/
    ├── SKILL.md.tpl · skill.json
    └── references/                    # diff-collection.md、prd.md；模板不随包提供
```



* 修改 `SKILL.md.tpl` 可调整触发词、工作流、输出模板（四环境共用同一份）。

* 项目相关的约定（配置中心、发布平台与 Region、定时任务注解、是否需要库表评审）不写在模板里，统一由 `workflow/profile.json` 提供；换项目时只需重新填画像。

* 安装后建议运行一次 `SHOW TABLES` 并 `DESCRIBE` 关键表，把结构补进

  `<env-dir>/database-query/references/schema.md`，能显著提升查库效率。

* SKILL.md 只保留主流程，细节放在各自的 `references/`，agent 需要时再读，减少每次触发占用的上下文。

### 模板从哪里取

文档类 skill 的模板来源取决于项目是否接入了 DocNexus，生成的文档开头会注明「模板来源」：

* **已接入 DocNexus：只用知识库里的模板** `docnexus/library/templates/<skill>/<文件名>`（分类 `doc-template`）。不再使用 skill 自带的默认模板，也不使用 `docs/skills/templates/` 下的文件。库里缺模板时 skill 会停下来，提示你导入后再继续，不会悄悄回退到默认模板。
* **未接入 DocNexus**：依次取项目文件 `docs/skills/templates/<skill>/<文件名>`、skill 自带默认模板。

| skill | 文件名 | 用途 | 默认模板 |
| --- | --- | --- | --- |
| create-tech-md-doc | `template.md` | 技术方案模板 | **不提供**，第一次用时按样例创建 |
| create-release-md-doc | `template.md` | 上线方案模板 | **不提供**，第一次用时按样例创建 |
| dev | `plan-template.md` | 开发方案模板 | 有 |
| dev | `delivery-template.md` | 交付说明模板 | 有 |
| project-review | `checklist.md` | 审查清单 | 有 |
| project-review | `report.md` | 审查报告模板 | 有 |

**技术方案、上线方案的模板按团队自己的格式创建**：各团队发到 wiki 的文档格式不同，skills 不再自带固定格式。第一次生成时 skill 会停下来，请你给一份团队现有的同类文档（本地 Markdown，或 wiki 的 pageId / URL）作样例，用 `workflow/scripts/make-template.mjs` 抽出章节和表格结构，把正文换成填写说明，你确认后保存：未接入 DocNexus 时存到 `docs/skills/templates/<skill>/template.md`（建议提交，团队共用），已接入时经你授权写入 DocNexus。之后想换格式，直接说「重新生成技术方案模板」。

**修改模板**：说「改技术方案模板，加一节回滚方案」或 `/workflow template release 去掉灰度那节`，agent 会一路走完：

1. 把当前生效的模板复制成草稿 `tmp/skills/template-draft/<skill>/<文件名>`，只改草稿；
2. `template.mjs check` 校验格式（必填 ` *`、可选「（如有）」、占位符），列出新增 / 删除的章节、必填变化，并拿最近几份已生成的文档试跑，告诉你新模板下它们会多出哪些错误；
3. 你确认后 `template.mjs save`：旧模板备份到 `tmp/skills/template-backup/<时间>/`，写入 `docs/skills/templates/<skill>/`，再确认生效；已接入 DocNexus 时经你授权按 capture 流程写入知识库。

模板别名：`tech`、`release`、`plan`、`delivery`、`review`、`checklist`。改带默认版本的模板（开发方案、交付说明、审查报告、审查清单）也走这条路，保存后项目文件优先，升级不会覆盖。

* 老项目升级时，如果还在用原来自带的默认模板（项目和 DocNexus 里都没有自己的版本），安装器会先把它保存到 `docs/skills/templates/<skill>/template.md`，生成效果不变。
* `doctor` 和 `/workflow status` 会列出还没创建的模板。

**模板导入 DocNexus**：

```
./skills-init/init-skills.sh --envs claude --skip-db --with-docnexus   # 接入时自动导入默认模板
./skills-init/init-skills.sh seed-templates                      # 已接入的项目补导入缺的模板（upgrade 时也会自动导入新增的）
./skills-init/init-skills.sh seed-templates --update             # 导入后没改过的模板更新为新版
./skills-init/init-skills.sh seed-templates --diff               # 团队改过的模板：打印与新默认模板的差异，手动合并
```

* 只导入 DocNexus 里还没有的、有默认版本的模板（技术方案、上线方案不在内），已有的不覆盖；项目已接入但缺模板时，安装结束会列出缺哪几份。
* 之后模板随知识库更新：直接编辑 `docnexus/library/templates/...` 后执行 `./docnexus/node_modules/.bin/docnexus document sync --id <id>`（旧装法为 `./node_modules/.bin/docnexus`）采纳；或者在生成文档后，skill 发现你做了结构性调整时会提议同步回模板（你确认后才写入）。每次变更都记录在 DocNexus 的 timeline 里，可追溯。
* 模板里的 `{{...}}` 是给 agent 的填写提示，DocNexus 原样保存；不要写成单独一行的 `{{fact:...}}`（那是 DocNexus 的事实引用语法）。
* 没接入 DocNexus 时，可用 `docs/skills/templates/` 下的同名文件覆盖默认模板；之后接入 DocNexus，skill 会提示你把这些文件导入知识库（导入后它们不再生效）。

## 触发准确度评估

7 个 skill 的描述有交叉（如「修 bug」该走 dev 而不是 project-review），`evals/trigger-cases.json` 收录了 26 条真实口吻的请求及期望的 skill（含不该触发任何 skill 的近似请求）。评估方法：在临时项目里装好全部 skill，用 `claude -p` 逐条发送，取第一个被调用的工具判断分流结果：

```
npm run eval:triggers                       # 全量，每条 1 次
node scripts/eval-triggers.mjs --runs 3     # 每条 3 次，看稳定性
node scripts/eval-triggers.mjs --only dev   # 只跑期望为 dev 的用例
```

* 需要已登录的 `claude` CLI（终端执行 `claude` 后 `/login`）；每条请求会真实调用一次模型并计费，检测到第一个工具调用即终止，不会执行任何工具。
* 期望 `none` 表示不该触发本项目的 skill；触发了你环境里的其他 skill（如全局安装的 pdf skill）也算对。
* 额度用尽、未登录等调用失败记为 `E`（error），不计作「没触发」，并在结尾提示结果不可信。
* 结果明细写到 `tmp/evals/`。改了任何 skill 的 description 后建议重跑一次（最近一次：26 条 × 3 次，78/78）。

## 为什么这些路径



* **Codex CLI 项目级 skills** 官方约定为 `.agents/skills/`（团队提交即共享），与豆包办公

  的项目级技能目录一致，因此两者共用一份。

* **Claude Code** 项目级为 `.claude/skills/`，自动发现。

* **Qwen Code** 项目级为 `.qwen/skills/`，自动发现。