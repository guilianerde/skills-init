# skills-init — 项目级 Agent Skills 一键初始化

把 **workflow（入口路由 + 共用项目画像）**、**dev（功能开发 / 缺陷修复编排）**、**database-query（数据库查询）**、**project-review（代码审查）**、**md-to-wiki（发布文档到**

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

需要 **Node.js >= 18**（接入 DocNexus 时需 >= 22.13）。安装逻辑只有一份实现 `bin/skills-init.mjs`，两个脚本只是薄封装：

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
| `upgrade` | 读安装清单里记录的环境与模式，非交互升级到当前版本：保留数据库配置，手改过的文件另存 `.new`；已接入 DocNexus 时顺带导入新版本新增的文档模板（只新增，不改动已有模板） |
| `doctor` | 自检：已装版本与当前包对比、手改 / 缺失 / 待合并的文件、软链接是否断开、项目画像、DocNexus 模板是否齐全、各数据库连接能否只读 `SELECT 1`（`--offline` 跳过）、`.gitignore` 是否忽略了凭据。有错误时退出码 1 |
| `uninstall` | 等价于 `--uninstall` |
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
├── database-query/                   # 数据库查询
│   ├── SKILL.md                      # 触发描述 + 查询工作流 + 只读/安全规则
│   ├── config.json                   # 数据库连接（init 生成，已加入 .gitignore）
│   ├── scripts/query.mjs             # 执行查询：会话只读、写语句拦截、自动 LIMIT、脱敏
│   └── references/schema.md          # 表结构速查（初始为空，建议补齐后提交）
├── md-to-wiki/                       # 发布 md 到 Confluence wiki
│   ├── SKILL.md                      # GATE：wiki 未配置则禁止启动
│   ├── wiki-config.json              # wiki 连接（init 生成，默认 enabled=false，已 gitignore）
│   └── scripts/md-to-wiki.mjs        # md → Confluence Storage Format XHTML 转换 + 良构校验（Node，无依赖）
├── create-tech-md-doc/               # 从分支 diff 生成技术方案 md（8 模块）
│   ├── SKILL.md
│   └── template.md
├── create-release-md-doc/            # 从分支 diff 生成上线方案 md（6 模块）
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
```

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

* **功能开发**：理解需求（可读 PRD、查 DocNexus 历史决策）→ 调研现有代码 → 需求澄清（借鉴 grill-me：按决策树分轮提问，每题给推荐答案；事实自己查、决定交给用户；S 规模无未定决定时跳过）→ 按规模出方案（S 直接做；M 对话内方案待确认；L 落盘方案文档待确认）→ 小步实现并编译 → 补测试并运行 → 用 project-review 自审 → 交付说明落盘到 `docs/skills/dev/delivery-<需求>-<日期>.md`（带分支元信息；改动、验证结果、配置清单、未执行的 SQL），已接入 DocNexus 时每次都问要不要沉淀（同意后以 `dev-notes` 分类写入，并把库内路径记回交付说明）。审查和上线方案会按分支自动读取这份交付说明。
* **缺陷修复**：收集现象 → 用失败测试复现 → 用证据定位根因 → 最小修复让测试转绿 → 自审 → 交付（必须写明根因）。
* 守则：不写库、不改凭据、不擅自 commit / push、不装新依赖；测试没跑就写「未验证」。
* 其他 skill 都是可选增强：wiki、DocNexus、数据库没配置时自动跳过，并在交付说明中注明。

## 参数



| 参数                      | 说明                                                                    |
| ----------------------- | --------------------------------------------------------------------- |
| `-Envs` / `--envs`      | 环境列表，逗号分隔：`codex,claude,doubao,qwen`；`all` = 全部                       |
| `-SkipDb` / `--skip-db` | 跳过数据库连接配置（database-query 不生成 config.json）                             |
| `-WithDocNexus` / `--with-docnexus` | 可选：接入 [DocNexus](https://www.npmjs.com/package/@rowansenne/docnexus) 项目文档库（需 Node >= 22.13），见下方「DocNexus 文档库（可选）」 |
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
* 安装后 `dev`、`project-review` 会先按 `docnexus-recall` 查项目约定；`dev`、`create-tech-md-doc`、`create-release-md-doc` 结束时只会**提议**沉淀，**任何写入 DocNexus 的操作都必须经你授权**。
* 离线或测试时可用环境变量指定安装来源，例如 `DOCNEXUS_PKG=/path/to/rowansenne-docnexus-0.13.0.tgz ./skills-init/init-skills.sh --with-docnexus`（PowerShell：`$env:DOCNEXUS_PKG=...`）。
* Windows 上 qwen 的链接使用目录 junction（与 docnexus 的做法一致）；Git Bash 下 `ln -s` 是否生成真正的链接取决于 MSYS 设置，建议 Windows 用 PowerShell 版。

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

每次安装后在 `.agents/skills/.skills-init.json`（`--copy` 时各目标目录各一份）写入清单：安装器版本、安装时间、所选环境、安装模式，以及每个 skill 的模板文件相对路径与 sha256。用户配置（`config.json`、`schema.md`、`wiki-config.json`、`profile.json`）只记录存在与否，不记哈希。重跑时据此判断：

| 情况 | 交互模式 | `--yes` |
| --- | --- | --- |
| 模板文件当前内容与清单记录一致（没改过） | 直接更新 | 直接更新 |
| 与清单记录不同（手改过） | 询问：`o` 用新模板覆盖 / `k` 保留你的版本 / 回车 = 保留并把新模板另存为同目录的 `<文件名>.new` | 保留你的版本，新模板写成 `<文件名>.new`，结尾汇总列出 |
| 清单里有、新模板里已没有 | 没改过就删除；改过的保留并提示 | 同左 |

* 合并完 `.new` 后删掉它即可；你采纳了新模板（内容与新模板一致）或选了覆盖 / 保留后，下次重跑会自动清掉上次生成的 `.new`。
* 没有清单的旧安装（本功能之前装的）无从判断是否手改过，第一次重跑仍按旧行为直接更新模板，之后就有清单了。

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
| `workflow/scripts/artifacts.mjs [--branch b \| --all]` | 按分支汇总 `docs/skills/` 下的开发方案、交付说明、审查报告、技术方案、上线方案及其 wiki 发布记录，给出下一步建议；分支取自文档元信息行，不另存记录。上线方案没传 `--tech` 时据此自动引用同分支的技术方案；project-review 据此对照本分支方案、识别复审 |
| `database-query/scripts/query.mjs` | 执行 SQL：选连接、取密码（只通过环境变量传给客户端）、会话层只读、拦截写语句和多语句、自动补 LIMIT、超时、脱敏敏感列；支持 mysql / psql 客户端，其他 driver 退回 JDBC |
| `database-query/scripts/query.mjs --schema [--tables a,b] [--write]` | 按只读会话导出表结构为 Markdown；`--write` 写入 `references/schema.md` 的 `schema:begin` / `schema:end` 之间，标记外的补充说明保留 |
| `md-to-wiki/scripts/upload.mjs info / put / target / record` | REST 上传通道：`info` 读页面标题与版本给用户确认；`put --expect-version <n> [--record <md>]` 先校验 XHTML 良构，版本对不上就拒绝上传，上传后确认版本 +1，并把发布记录写回 Markdown 第一行注释（转换时丢弃，不出现在页面上）；`target` 读出记录，再次发布同一文档不必再给 pageId；`record` 供 MCP 通道上传后补写 |

## 测试

```bash
npm test                                  # bash 冒烟测试 + 全部 node 测试
node --test "tests/*.mjs"                 # 只跑 node 测试（三个平台都能跑）
```

node 测试覆盖：skill.json 一致性、子命令（upgrade / doctor / seed-templates / uninstall）、`resolve.mjs` 与画像推断、`lint-doc.mjs`（含 `--facts` 核对，用临时 git 仓库）、`artifacts.mjs`、`knowledge.mjs`、`query.mjs` 与表结构导出（用假的 mysql / psql 客户端）、md-to-wiki 转换与上传（用本地假 Confluence 服务）、DocNexus 模板导入与版本跟踪（用假的 docnexus CLI）。

安装器的黑盒场景都在 `tests/test-install.mjs`，三个平台共用：每个用例在临时目录放一份 skills-init 副本，执行安装后检查目录、软链接和配置。覆盖全新安装（单一来源 + 相对软链接）、`SKILLS_INIT_NO_SYMLINK=1` 退回独立拷贝、`--copy`、`--yes` 无数据库配置时退出码 1、含 `/ & | " \` 的密码、重跑保留用户配置、安装清单、手改模板另存 `.new`（含交互选覆盖 / 保留）、删除模板文件后的清理、卸载与备份、从旧版各环境独立拷贝升级（用 git 历史中 `71a23c8` 的旧脚本生成旧布局，浅克隆时先 `git fetch --unshallow`）、两边配置冲突、`.gitignore` 只追加缺失规则。

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

所有技能生成的**文档产物**统一按 `<根>/技能名/` 落位（四环境一致，不再依赖 `.claude/`）：



| 技能                    | 产物         | 规范路径                                                               |
| --------------------- | ---------- | ------------------------------------------------------------------ |
| project-review           | 审查报告（md）   | `docs/skills/project-review/review-<范围>-<YYYYMMDD>.md`                |
| create-tech-md-doc    | 技术方案（md）   | `docs/skills/create-tech-md-doc/tech-doc_<分支>_<YYYYMMDD>.md`       |
| create-release-md-doc | 上线方案（md）   | `docs/skills/create-release-md-doc/release-doc_<分支>_<YYYYMMDD>.md` |
| database-query        | 查询结果       | 默认对话输出；导出时 `tmp/skills/database-query/result-<时间戳>.csv`            |
| dev                   | L 规模方案、交付说明（md） | `docs/skills/dev/plan-<需求短名>-<YYYYMMDD>.md`；`docs/skills/dev/delivery-<需求短名>-<YYYYMMDD>.md`（每次交付都写） |
| md-to-wiki            | 转换临时 XHTML | `tmp/skills/md-to-wiki/_wiki_upload_<时间戳>.html`（上传后可删）             |

规则：



* `docs/skills/` 是**持久产物**目录，可提交 git，团队共享。

* `tmp/skills/` 是**临时产物**目录，`init-skills` 自动把 `/tmp/` 加入 `.gitignore`，不入库。

* 同路径已存在时加 `_v2`、`_v3`，不覆盖旧文件。

* 存量历史产物（项目根 `code-review-*.md`、`.claude/docs/` 下的 `tech-doc_*` / `release-doc_*`）

  属此前规范遗留，新产物按上表落位；需要归档迁移可自行移动，不影响本规范。

## 自定义模板

初始化命令与模板集中在 `skills-init/` 一个文件夹（`.tpl` 后缀不会被任何平台误加载）：



```
skills-init/
├── bin/
│   ├── skills-init.mjs                # 安装器入口（唯一实现，Node >= 18）：参数解析与 init / upgrade / doctor / uninstall / seed-templates 调度
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
│   ├── references/                    # profile.md、templates.md、docnexus.md、status.md（其他 skill 直接读对应文件）
│   └── profile.json.tpl               # 空画像，首次使用时由 agent 推断并经确认后填写
├── dev/
│   ├── SKILL.md.tpl · skill.json
│   └── references/                    # plan-template.md（方案模板）、delivery-template.md（交付模板）
├── project-review/
│   ├── SKILL.md.tpl · skill.json
│   └── references/                    # checklist.md.tpl、report.md.tpl（报告模板）、diff-strategy.md
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
│   ├── references/                    # diff-collection.md（分层采集）、prd.md（PRD 拉取）
│   └── template.md                    # 8 模块文档模板
└── create-release-md-doc/
    ├── SKILL.md.tpl · skill.json
    ├── references/                    # diff-collection.md、prd.md
    └── template.md                    # 6 模块文档模板
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

| skill | 文件名 | 用途 |
| --- | --- | --- |
| create-tech-md-doc | `template.md` | 技术方案模板 |
| create-release-md-doc | `template.md` | 上线方案模板 |
| dev | `plan-template.md` | 开发方案模板 |
| dev | `delivery-template.md` | 交付说明模板 |
| project-review | `checklist.md` | 审查清单 |
| project-review | `report.md` | 审查报告模板 |

**模板导入 DocNexus**：

```
./skills-init/init-skills.sh --envs claude --skip-db --with-docnexus   # 接入时自动导入默认模板
./skills-init/init-skills.sh seed-templates                      # 已接入的项目补导入缺的模板（upgrade 时也会自动导入新增的）
./skills-init/init-skills.sh seed-templates --update             # 导入后没改过的模板更新为新版
./skills-init/init-skills.sh seed-templates --diff               # 团队改过的模板：打印与新默认模板的差异，手动合并
```

* 只导入 DocNexus 里还没有的模板，已有的不覆盖；项目已接入但缺模板时，安装结束会列出缺哪几份。
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