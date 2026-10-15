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
.\skills-init\init-skills.ps1         # Windows PowerShell
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
* Windows：建软链接需要开启「开发者模式」或以管理员运行，建不了时该环境自动退回独立拷贝；在 Windows 上 clone 含软链接的仓库需要 `git config core.symlinks true`。
* 不想用软链接：加 `--copy`（PowerShell：`-Copy`），每个环境各装一份完整文件。

> Codex 也可选择额外安装到用户级
> `~/.codex/skills/`
> （所有项目可用），脚本会询问。

每个 skill 目录结构（四环境一致）：



```
<env-dir>/
├── workflow/                         # 入口：路由到各 skill、能力探测、维护共用项目画像
│   ├── SKILL.md
│   └── profile.json                  # 项目画像：主分支、构建 / 测试命令、配置中心、发布平台等（无凭据，可提交；重跑不覆盖）
├── project-review/                      # 代码审查
│   ├── SKILL.md                      # 触发描述 + 审查工作流 + 输出模板
│   └── references/checklist.md       # 10 维度审查清单（配置维度按 profile.config_center 判断）
├── database-query/                   # 数据库查询
│   ├── SKILL.md                      # 触发描述 + 查询工作流 + 只读/安全规则
│   ├── config.json                   # 数据库连接（init 生成，已加入 .gitignore）
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

* **功能开发**：理解需求（可读 PRD、查 DocNexus 历史决策）→ 调研现有代码 → 按规模出方案（S 直接做；M 对话内方案待确认；L 落盘方案文档待确认）→ 小步实现并编译 → 补测试并运行 → 用 project-review 自审 → 输出交付说明（改动、验证结果、配置清单、未执行的 SQL）。
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
| `-Yes` / `--yes`        | 非交互：自动使用已有数据库配置（依次查找 `.codex/database-query/config.json` 与各环境已安装的 `database-query/config.json`）；都没有且未 `-SkipDb` 时报错退出 |
| `--project-root`        | 项目根目录；直接调用 `bin/skills-init.mjs` 时默认当前目录，两个封装脚本自动传上级目录 |
| `-v` / `--version`      | 显示版本                                                                |
| `-h` / `--help`         | 帮助                                                                    |

## DocNexus 文档库（可选）

加 `--with-docnexus`（PowerShell：`-WithDocNexus`）时，脚本在装完本仓库的 skills 后额外执行：

1. 检查 Node >= 22.13 与 npm（不满足时**在安装任何文件之前**报错退出）；
2. 在项目根执行 `npm i -D @rowansenne/docnexus`（项目根没有 `package.json` 时 npm 会新建一个）；
3. 执行 `./node_modules/.bin/docnexus init --agent <claude|codex|all>`：创建 `docnexus/` 工作区，把 DocNexus 的 skills 同步到 `docnexus/skills/`，并软链接到对应环境目录、写入 `CLAUDE.md` / `AGENTS.md` 的 DocNexus 段落；
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

可以放心重复执行 init 来升级模板：

* `SKILL.md`、`references/checklist.md`、`template.md`、脚本等**模板文件会被更新**；
* 用户填过的 `md-to-wiki/wiki-config.json`、`database-query/references/schema.md`、`workflow/profile.json` **保留不覆盖**；
* `database-query/config.json` 只在本次确认或填写了数据库配置时写入；`--skip-db` 时保留已有文件；
* `.gitignore` 规则无论是否配置数据库都会补齐（只追加缺失的行）；
* 安装器按 skill 目录自动发现文件（`*.tpl` 去掉后缀），新增 `references/` 文件不需要改安装器。
* `code-review` 已改名为 `project-review`（避免与 Claude Code 内置的 `/code-review` 撞名）：重跑时自动移除旧名的目录和链接；只删能确认是本项目装的那份，你自己的同名 skill 不动。
* 设置环境变量 `SKILLS_INIT_NO_SYMLINK=1` 可强制不建软链接（各环境独立拷贝）；无法建链接时会先探测，旧目录原样保留、只更新模板。

## 测试

`tests/` 下是两个安装脚本的黑盒测试：每个用例在临时目录放一份 skills-init 副本，执行安装后检查生成的目录、软链接和配置文件。

```bash
bash tests/test-init-skills.sh            # bash 版（兼容 macOS 自带的 /bin/bash 3.2）
bash tests/test-init-skills.sh upgrade    # 只跑名字含 upgrade 的用例
```

```powershell
pwsh -NoProfile -File tests/test-init-skills.ps1   # PowerShell 版（Windows，PowerShell 7）
```

覆盖的场景：全新安装（`.agents/skills` 完整文件 + `.claude` / `.qwen` 相对软链接）、`--copy`、`--yes` 无数据库配置时退出码 1、交互输入含 `/ & | " \` 的密码后 `config.json` 仍是合法 JSON 且值一致、重跑保留用户配置、从旧版各环境独立拷贝升级（用 git 历史中 `71a23c8` 的脚本生成旧布局）、两边配置冲突时保留旧目录、`.gitignore` 只追加缺失规则。PowerShell 版另外覆盖软链接不可用时退回独立拷贝（用环境变量 `SKILLS_INIT_NO_SYMLINK=1` 模拟）。

依赖：bash 版需要 `python3` 校验 JSON；升级用例需要完整 git 历史（浅克隆时先 `git fetch --unshallow`）。

CI（`.github/workflows/test.yml`）在 push 到 main 和每个 PR 上运行：macOS 用 `/bin/bash`、Ubuntu 用 bash 跑 bash 版，Windows 用 pwsh 跑 PowerShell 版。

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
| dev                   | L 规模方案（md） | `docs/skills/dev/plan-<需求短名>-<YYYYMMDD>.md`；交付说明默认只在对话输出 |
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
├── bin/skills-init.mjs                # 安装器（唯一实现，Node >= 18）
├── init-skills.sh / init-skills.ps1   # 薄封装：以上级目录为项目根调用安装器
├── package.json                       # npm 包信息（bin: skills-init）
├── evals/trigger-cases.json           # 多 skill 分流评估用例
├── scripts/eval-triggers.mjs          # 分流评估脚本
├── README.md                          # 本说明
├── database-query/
│   ├── SKILL.md.tpl
│   ├── config.json.tpl
│   └── references/schema.md.tpl
├── project-review/
│   ├── SKILL.md.tpl
│   └── references/checklist.md.tpl
├── md-to-wiki/
│   ├── SKILL.md.tpl
│   ├── wiki-config.json.tpl
│   ├── references/                    # upload.md（上传通道）、troubleshooting.md（脚本与排错）
│   └── scripts/md-to-wiki.mjs
├── create-tech-md-doc/
│   ├── SKILL.md.tpl
│   ├── references/                    # diff-collection.md（分层采集）、prd.md（PRD 拉取）
│   └── template.md                    # 8 模块文档模板
├── create-release-md-doc/
│   ├── SKILL.md.tpl
│   ├── references/                    # diff-collection.md、prd.md
│   └── template.md                    # 6 模块文档模板
├── dev/
│   ├── SKILL.md.tpl
│   └── references/                    # plan-template.md（方案模板）、delivery-template.md（交付模板）
└── workflow/
    ├── SKILL.md.tpl
    └── profile.json.tpl               # 空画像，首次使用时由 agent 推断并经确认后填写
```



* 修改 `SKILL.md.tpl` 可调整触发词、工作流、输出模板（四环境共用同一份）。

* 项目相关的约定（配置中心、发布平台与 Region、定时任务注解、是否需要库表评审）不写在模板里，统一由 `workflow/profile.json` 提供；换项目时只需重新填画像。

* 安装后建议运行一次 `SHOW TABLES` 并 `DESCRIBE` 关键表，把结构补进

  `<env-dir>/database-query/references/schema.md`，能显著提升查库效率。

* SKILL.md 只保留主流程，细节放在各自的 `references/`，agent 需要时再读，减少每次触发占用的上下文。

### 按项目覆盖模板（不改 skills-init）

在项目里放同名文件即可覆盖默认模板，skill 会优先使用：

| 覆盖文件 | 替代 |
| --- | --- |
| `docs/skills/templates/create-tech-md-doc/template.md` | 技术方案模板 |
| `docs/skills/templates/create-release-md-doc/template.md` | 上线方案模板 |
| `docs/skills/templates/dev/plan-template.md` | dev 的方案模板 |
| `docs/skills/templates/project-review/checklist.md` | 审查清单 |

这样换团队、换文档格式时只改项目里的文件，重跑 init 也不会被覆盖。

## 触发准确度评估

7 个 skill 的描述有交叉（如「修 bug」该走 dev 而不是 project-review），`evals/trigger-cases.json` 收录了 26 条真实口吻的请求及期望的 skill（含不该触发任何 skill 的近似请求）。评估方法：在临时项目里装好全部 skill，用 `claude -p` 逐条发送，取第一个被调用的工具判断分流结果：

```
npm run eval:triggers                       # 全量，每条 1 次
node scripts/eval-triggers.mjs --runs 3     # 每条 3 次，看稳定性
node scripts/eval-triggers.mjs --only dev   # 只跑期望为 dev 的用例
```

* 需要已登录的 `claude` CLI（终端执行 `claude` 后 `/login`）；每条请求会真实调用一次模型并计费，检测到第一个工具调用即终止，不会执行任何工具。
* 结果明细写到 `tmp/evals/`。改了任何 skill 的 description 后建议重跑一次。

## 为什么这些路径



* **Codex CLI 项目级 skills** 官方约定为 `.agents/skills/`（团队提交即共享），与豆包办公

  的项目级技能目录一致，因此两者共用一份。

* **Claude Code** 项目级为 `.claude/skills/`，自动发现。

* **Qwen Code** 项目级为 `.qwen/skills/`，自动发现。