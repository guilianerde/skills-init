# Changelog

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 变更（破坏性）
- 随代码提交和独立文档仓库两种用法的目录结构统一为 `workflow-run/docs/requirements/<需求名>/<项目名>/`（归档的上一版同样在 `tmp/old-artifacts/<需求名>/<项目名>/`）。随代码提交时项目名不用配置，取 git 远端仓库名（没有远端用目录名），第一次 `bind` 时写进 `workflow/profile.json` 的 `artifacts.project`。
- 旧结构自动迁移：`init` / `upgrade` 把 `<需求名>/` 下直接放的文件挪到 `<需求名>/<项目名>/`（被 git 跟踪的用 `git mv`），结尾列出迁移的需求，改动由你提交；目标里已有同名文件的需求不动并提示。`doctor` 提示还没迁移的需求。
- `docs-repo` 支持原地切换：`workflow-run/` 里已有产物、DocNexus 时不再停下，而是原地 `git init` 并接上远端。远端是空仓库时本地内容就是第一批内容；远端已有内容时检出远端，本地和远端同路径冲突就退回原状并列出冲突的文件。

### 变更
- `--with-docnexus` 不再往项目的 `.gitignore` 追加 `node_modules/`：DocNexus 的依赖和检索库由它自带的 `docnexus/.gitignore` 忽略，随代码提交和独立文档仓库两种模式都适用。已追加过的这一行保留不动。
- `dev` 的 `project-review` 从 optional 改为 requires：`--skills dev` 会一起装上 `project-review`，已按子集装了 `dev` 的项目 `upgrade` 时自动补上。dev 自审必做，且要经 `resolve.mjs template project-review checklist.md` 取审查清单；之前没装 project-review 时这条命令报错，dev 写的「按清单手动自审」降级走不通。
- dev 自审调用 project-review 时只走第 1～6 步，跳过落盘审查报告和 DocNexus 询问，问题表、影响面、未覆盖项交回 dev 在交付时统一给出（DocNexus 只在 dev 交付时问一次）；两边的 SKILL.md 都写明了这条边界。
- dev 交付说明的「验证」节加「验收项 → 测试 / 操作 → 结果」对照表，每条验收标准写明靠什么验证，没法验证的标「未验证」和原因；新增「开工前已有的失败」一行。快速通道在对话里给同样的对应。
- dev 开工前先跑一次基线（构建 + 相关测试，不必全量），记下已有的失败，之后只对新增失败负责；构建从「每个可编译单元」改为一步改完再编译，测试改为先相关、最后全量一次。
- dev 开工时工作区有未提交改动或未跟踪文件，改为问用户哪些属于本需求：属于的（如先手写了一部分再让 dev 接着做）和 dev 的改动一样进影响面、测试、自审和交付说明；不属于的照常被测试跑到，但自审发现写进「范围外发现」、提交时不 add。之前只说「无关的告知用户」，没说怎么处理，用户手写的部分也可能被当成无关。自审补上本次新建的未跟踪文件。
- dev 规模判定加入权限和资金：涉及鉴权、数据可见范围、金额计算、扣款、退款、对账的改动，文件再少也至少按 M，需求理解和方案都要用户确认，也不走快速通道（功能开发和缺陷修复都适用）。M 规模的两次确认（F3 理解、F4 方案）保留，不合并。

### 修复
- `resolve.mjs template <skill> …` 在该 skill 没安装时提示「没有安装」并让重跑安装带上它，不再误报「没有登记模板」。

### 测试
- 新增检查：SKILL.md 里经 `resolve.mjs template <其他 skill>` 取模板的，必须把那个 skill 声明为 requires。

### 文档
- 新增图文教程 `docs/full-install.html`：带 DocNexus 与 CodeGraph 的全量安装、团队接入、独立文档仓库（原地切换、新服务接入、旧项目改用）、升级与卸载。

## [0.21.2] - 2026-10-19

### 文档
- README 新增「哪些文件提交、哪些忽略」：集中列出要提交的 skills 目录、软链接、项目画像、需求产物等，以及安装器追加的各条 `.gitignore` 规则、忽略的内容和追加时机，附 `git check-ignore` 检查命令。

## [0.21.1] - 2026-10-18

### 修复
- 提示里的命令改成完整的 `npx @rowansenne/workflow-run <子命令>`（如 `seed-templates --update`、`upgrade`）：之前写的是 `workflow-run ...`，用 npx 安装、没有全局安装时会报命令找不到。

## [0.21.0] - 2026-10-18

### 变更（破坏性）
- **默认模板只读，定制模板只放 DocNexus**：skills 自带的模板不能改；修改或新建模板一律写进 DocNexus 知识库，便于团队共享（每次变更有 timeline）。`workflow-run/templates/` 下的项目模板不再生效，`resolve.mjs` 输出 `stale_project_file`，`doctor` 提示导入知识库后删除；接入 DocNexus 后缺模板时仍把它作为 `import_from` 提议导入。
- 未接入 DocNexus 时：只用默认模板；`template.mjs draft` / `save` 退出码 2、输出 `need_docnexus: true`，提示先 `--with-docnexus` 接入。技术方案、上线方案没有默认模板，`resolve.mjs template` 同样返回 `need_docnexus`，要先接入 DocNexus 才能创建模板和生成文档；`resolve.mjs status` 新增 `templates_need_docnexus`。
- `template.mjs save` 不再写项目文件、不再备份到 `workflow-run/tmp/template-backup/`，只给出写入知识库的 capture 指引；撤销按 DocNexus 的 timeline 恢复。

## [0.20.0] - 2026-10-18

### 变更
- **project-review 独立复核**：能派子 agent 的环境（Claude Code、Codex、Qwen Code 等）里，CRITICAL / HIGH 每条交给一个只拿到结论、位置、触发条件的子 agent 重新读代码判定「成立 / 可能成立 / 不成立」，不成立的删掉并在「未覆盖与待确认」记复核排除的条数；派不了时自己复核，先找不成立的理由。复核方式写进报告「审查方式」。
- **project-review 分角度并行查找**（深审大改动，用户确认后）：深审、改动超过 30 个文件或 1500 行、环境能派子 agent 时，先问用户要不要分 5 个角度（正确性与字段完整性 / 并发事务与幂等 / 安全与异常 / 数据库与配置 / 性能测试与语言专项）各派一个子 agent 同时查；同意后主 agent 合并去重、做影响面，再交独立复核。不同意照旧分批精读。
- **project-review 审查深度与降噪**：分快审 / 标准（默认）/ 深审，写进「审查方式」。快审只查正确性、空值、安全、事务与幂等；标准不查风格；深审全部维度并复核 MEDIUM。新增「只报会出问题的」：风格、linter 能拦的、个人偏好、写不出后果的建议不报，LOW 只写有实际收益的优化。
- **需求目录里每种产物只留最新版，文件名固定**（`review.md`、`tech-doc.md` …，不再生成 `_v2`、`_v3`），上线方案引用技术方案、复审引用的产物等不会因为出了新版而失效。版本号记在 `meta.json` 的 `versions`。`requirement.mjs path` 发现已有旧版时，先把它复制到 `workflow-run/tmp/old-artifacts/<需求>/<种类>_v<N>.md`（`previous` 指向它，复审对照用），新版直接写到原文件；`sync <path>` 时内容变了才算新版本，输出 `archived` 列出归档的文件，由 skill 提示用户确认后自己删除。`/workflow report`、`/workflow view` 只统计目录里的最新版，`view` 显示版本号。
- `/workflow view` 的审查记录按报告内容判断首次 / 复审（原来按排序位置，只剩一份报告时会把复审标成首次）。

## [0.19.0] - 2026-10-18

### 变更（破坏性）
- **去掉「同时安装到 Codex 用户级 `~/.codex/skills`」的询问**：只装到项目里。之前选过的，`~/.codex/skills` 下本工具的 skill 需要自己删除。
- 目录里没有安装清单时，和新版不同的文件仍然备份后覆盖，但不再逐个报「被手动修改过」，改为一行汇总（哪个目录、备份了几个文件）。

### 新增
- **支持腾讯 WorkBuddy**（`--envs workbuddy`，交互菜单第 5 项）：skills 按 skill 软链接到 `.codebuddy/skills/`（WorkBuddy 读项目的 `.codebuddy/`，与 CodeBuddy Code 一致；`--copy` 时独立拷贝），DocNexus 的 skills 也链接过去，段落写在 `AGENTS.md`。`doctor`、`uninstall`、数据库配置查找、画像查找都认这个目录。

## [0.18.0] - 2026-10-18

### 变更（破坏性，不兼容旧版本）
- **包改名为 `@rowansenne/workflow-run`**，命令改为 `workflow-run`（`npx @rowansenne/workflow-run`）；项目里的目录 `skills-init/` 改为 `workflow-run/`，安装清单 `.skills-init.json` 改为 `.workflow-run.json`，`CLAUDE.md` / `AGENTS.md` 段落标记改为 `workflow-run:docnexus`，环境变量 `SKILLS_INIT_ADMIN` / `SKILLS_INIT_NO_SYMLINK` 改为 `WORKFLOW_RUN_ADMIN` / `WORKFLOW_RUN_NO_SYMLINK`，导入 DocNexus 的模板标签改为 `workflow-run-template`。
- 不自动迁移：项目里还有 `skills-init/` 或 `.skills-init.json` 时，任何命令都会列出改名命令后停下；旧的 `CLAUDE.md` / `AGENTS.md` 段落和含 `skills-init/` 的忽略规则只提示删除。

## [0.17.0] - 2026-10-17

### 新增
- **`skills-init docs-repo <仓库地址> [--project <项目名>]`：一条命令改用团队文档仓库**。克隆到 `skills-init/`（里面只有 `tmp/` 时先挪开再放回；已有产物、DocNexus 或项目模板时停下，不自动合并），代码仓库 `.gitignore` 加 `/skills-init/`，文档仓库 `.git/info/exclude` 加 `/tmp/`，项目名写进 `workflow/profile.json`（默认沿用已配置的，其次 git 远端仓库名），文档仓库里有 DocNexus 时接上本项目的链接与段落。不带地址显示当前状态；`--project` 单独使用时只改项目名。安装 / 升级时也会给文档仓库加上 `/tmp/` 排除。

### 变更（破坏性）
- **只保留 npx 安装**：删除 `init-skills.sh` / `init-skills.ps1` 及其冒烟测试，npm 包不再带它们；去掉「安装器克隆在项目的 `skills-init/` 里时停下」的检查。CI 的 4 个任务改为只跑 node 测试（macOS、Ubuntu 的 Node 22，Windows 的 Node 22 / 24）。

## [0.16.0] - 2026-10-17

### 变更（破坏性，不兼容旧版本）
- **本工具的产出都放进项目根的 `skills-init/`**，不再往项目的其他地方写：
  - 需求产物：`skills-init/docs/requirements/<需求名>/`（原 `docs/skills/requirements/`）；
  - DocNexus 工作区：`skills-init/docnexus/`，DocNexus 以 `skills-init/` 为项目根运行（`init --agent none`），由本工具把它的 skills 相对链接到各环境、在 `CLAUDE.md` / `AGENTS.md` 写段落（原 `docnexus/`）；
  - 项目模板：`skills-init/templates/<skill>/`（原 `docs/skills/templates/`）；
  - 临时文件：`skills-init/tmp/`（原 `tmp/skills/`），`.gitignore` 加 `/skills-init/tmp/`。
- **独立文档仓库改为克隆到 `skills-init/`**：`skills-init/` 自己是 git 仓库即为文档仓库模式，代码仓库 `.gitignore` 加 `/skills-init/`；产物在 `skills-init/docs/requirements/<需求名>/<项目名>/`，引用写「文档仓库名:路径」（仓库名取 git 远端）。去掉 `artifacts.repo`、`requirement.mjs config --repo`。
- **去掉 `--docnexus-root` / `-DocnexusRoot`**（`docnexus.root` 配置）。
- **安装器放在项目外**：`init-skills.sh` / `init-skills.ps1` 改为以当前目录为项目根；推荐用 `npx`。安装器克隆在项目的 `skills-init/` 里时停下并提示挪走。
- **不再迁移旧版本的产物**：去掉 `requirement.mjs migrate`、升级时的自动归档，以及对旧布局 `docs/skills/<skill>/` 的识别。旧位置的文件需要的话自己搬。
- **安装器去掉旧版本兼容**：不再把 `dev/profile.json` 迁成 `workflow/profile.json`、不再清理旧版本留下的 `<文件>.new`、不再移除改名前的 `code-review`（`skill.json` 去掉 `renamedFrom`）。升级时也不再把旧版本装进 skills 目录的技术方案、上线方案默认模板复制到项目模板目录。`--copy` 拷贝换成链接时合并用户配置仍保留。

- **DocNexus 命令不再要求先 `cd skills-init`**：新增 `workflow/scripts/docnexus.mjs`，在项目根运行即在 `skills-init/` 下执行 DocNexus（`--node <脚本>` 运行它的 node 脚本），bash / PowerShell 5.1 写法一样，Windows 上直接用 node 跑 CLI 入口。`resolve.mjs status` 的 `docnexus.run_in` 改为 `docnexus.run`；`CLAUDE.md` / `AGENTS.md` 段落与 DocNexus 升级命令同步改写，不再含 `cd … &&`。

### 新增
- **安装时记录本机系统与终端**：写进 `workflow/profile.local.json` 的 `env`（`os`、`shell`，Windows 区分 `pwsh` 与 `powershell`；个人设置，不提交）。新命令 `resolve.mjs env`，`profile` / `status` 输出也带上 `env`；各 skill 增加「终端命令」一节：按 `env` 写命令，不再每次对话自己探测系统。
- 技术方案里找候选分支改用 `git branch -a -i --list "*<关键词>*"`，不再依赖 `grep`。

### 修复
- 文档仓库的远端是 Windows 本地路径（反斜杠）时，引用里的仓库名会带上整段路径；改为和项目名建议一样按 `/`、`\`、`:` 切分。

## [0.15.0] - 2026-10-17

### 新增
- **DocNexus 可以和产物共用团队文档仓库**：`--docnexus-root <dir>`（PowerShell `-DocnexusRoot`）写入 `workflow/profile.json` 的 `docnexus.root`，DocNexus 装在 `<dir>/docnexus/` 并以 `<dir>` 为项目根运行（`init --agent none`），知识随文档仓库提交；DocNexus 本身不用改，也不需要它的 `--git-remote`。
  - 本项目里由 skills-init 接上：DocNexus 的 skills 相对链接到 `.claude/skills` / `.agents/skills` / `.qwen/skills`；`CLAUDE.md` / `AGENTS.md` 写入带自己标记的段落（概念索引位置、docnexus 系列 skill 的命令先 `cd <dir>` 再运行）。升级时刷新（DocNexus 新增的 skill 也接上），卸载时撤掉，文档仓库里的 DocNexus 不动。
  - 脚本按位置处理：`resolve.mjs status` 的 `docnexus` 增加 `root`、`run_in`，`bin` 给出实际路径；模板从文档仓库的知识库取；`knowledge.mjs` 在那里运行，文档多一个从本项目读正文的 `file`；`seed-templates`、`doctor`（报告位置与链接、段落是否齐全）、升级命令同步支持。
  - 文档仓库里的 `docnexus/` 不当作需求目录；`requirement.mjs pending` 单独列出知识库里未提交的改动（`knowledge_files` / `knowledge_commands`）。说明见 `workflow/references/docnexus.md`「DocNexus 在团队文档仓库里」。

### 修复
- `view` 在 Windows 上打印的页面路径是反斜杠，导致 Windows CI 从 0.13.0 起一直失败（页面本身生成正常）；改为统一用 `/`。

## [0.14.0] - 2026-10-17

### 新增
- **产物可放到独立文档仓库**（可选，默认仍放在项目里）：`workflow/profile.json` 配置 `artifacts.repo`（文档仓库相对项目根的位置）与 `artifacts.project`（项目名，只配一次；没配时 skill 问一次，默认取 git 远端仓库名），产物写到 `<文档仓库>/<需求名>/<项目名>/`，跨服务的需求共用一个需求目录（`which` 列出其他服务已有的需求，同名 `bind` 即加入）。文档里引用产物用 `cite`（「文档仓库名:仓库内路径」）。新命令 `requirement.mjs config`（查看 / 修改配置）、`requirement.mjs pending`（文档仓库里未提交的产物）。
- **写完提示提交文档仓库**：文档仓库模式下 `requirement.mjs sync` 输出 `commit`（未提交的文件、建议的提交信息、命令），skill 给用户看、用户确认后才提交，推送另外问。`artifacts.commit_prompt: false` 关闭提示；个人设置写 `workflow/profile.local.json`（`config --commit-prompt off --local`，已加入 `.gitignore`），不影响团队。
- `requirement.mjs migrate` 在文档仓库模式下把项目里的需求目录和旧布局产物搬到文档仓库，引用改成 `cite`；升级时只提示，不自动跨仓库搬。`/workflow view` 在此模式下显示文档仓库里所有项目的需求，一个需求下按项目区分；`resolve.mjs status` 输出产物位置。

### 变更
- **沉淀到 DocNexus 时只写知识**：dev 和 project-review 的沉淀正文不再写分支名、产物路径等工作流信息（避免进入 recall 的检索索引、避免知识文档和工作流目录结构绑定）。有 facts 时，每条 fact 的 provenance 写一条简单来源，格式为「<产物种类> <产物路径>（<日期>）」，没有 facts 就不写。从知识库追溯产物，靠产物里已有的「DocNexus：docnexus/library/<path>」行反查，不往 DocNexus 多写内容。规则见 `workflow/references/docnexus.md`「沉淀的来源」。

### 新增
- 项目文档视图显示知识沉淀的反向关联：每个需求列出「沉淀到的知识文档」（汇总各产物的「DocNexus：」行，去重，注明来自哪份产物）；顶部「知识文档」入口列出所有知识文档 → 来源产物，可按路径或需求名过滤，点击跳到对应产物。

### 修复
- 需求目录产物的日期会误取第一行 md-to-wiki 发布记录里的 `at=`（发布时间），影响 `meta.json`、视图与排序；改为跳过 HTML 注释，取文档头的日期。

## [0.13.0] - 2026-10-16

### 新增
- **项目文档视图**：`/workflow view` 或 `skills-init view [--out <文件>] [--open]`（PowerShell `-Out` / `-Open`），脚本 `workflow/scripts/view.mjs`。读需求目录（以及旧布局，标为「未归档」）里的产物，生成单个本地 HTML（默认 `tmp/skills/view/index.html`）：左侧需求列表（搜索、各阶段完成情况），右侧该需求的阶段进度（含 wiki 页面）、审查记录（每轮 CRITICAL / HIGH / MEDIUM / LOW 数量、复核、与上次对比的修复情况、DocNexus 沉淀）、交付记录（类型、规模、确认的决定、未验证项），以及各份文档的渲染正文；顶部是效果报告的关键数字。数据内嵌、正文转义，只读、不联网，支持明暗主题与窄屏。

### 修复
- workflow skill 的 description 超过 Agent Skills 规范的 1024 字符上限（0.10.1 起），在会校验长度的环境里可能无法加载；精简到 920 字符，并加测试约束所有 skill。

### 变更
- **产物按需求归档**：开发方案、交付说明、审查报告、技术方案、上线方案不再按 skill 分目录，改为一个需求一个目录 `docs/skills/requirements/<需求名>/`（`plan.md`、`delivery.md`、`review.md` / `review_v2.md`、`tech-doc.md`、`release-doc.md`），`meta.json` 汇总需求名、绑定的分支、各产物的版本、日期、wiki 发布记录与 DocNexus 沉淀，供以后的可视化直接读取。需求名由用户在流程开始（dev 确定 M / L 规模、`/workflow` 完整链路开始）或第一次落盘时给出，不给时按分支名生成；同一分支后续各 skill 沿用，一个需求可绑定多个分支。新脚本 `workflow/scripts/requirement.mjs`（`which` / `bind` / `path` / `sync` / `list` / `migrate`），新共用说明 `workflow/references/requirements.md`；dev、project-review、技术方案、上线方案的落盘改用 `requirement.mjs path`，同种产物不覆盖、自动加版本，上一版发布过 wiki 时新版沿用同一页面。
- 需求目录写入项目根 `.ignore`，ripgrep 与 agent 的代码搜索跳过它，产物多了不污染搜索（检索交给 DocNexus）。
- 升级时自动把旧版 `docs/skills/<skill>/` 下的产物按「对比分支」搬进需求目录（`git mv` 保留历史），需求名取交付说明 / 开发方案的需求短名，没有就用分支名；元信息里没有分支的留在原处并列出。文档里引用的旧路径（「参考产物」等）一并改成新路径，搬迁记录写进 `meta.json` 的 `migrated_from`，之后合进来、仍引用旧路径的文档再次迁移时按记录补改。`artifacts.mjs`、`report.mjs`（分支链路表标出需求）、`pr-desc.mjs`、`template.mjs check` 同时识别新旧布局。

## [0.12.0] - 2026-10-16

### 新增
- **dev / project-review 用实际表结构核对数据库相关改动**。新脚本 `workflow/scripts/tables.mjs`（`--diff <base>...<head>` / `--base <分支>` / `--files a,b`）找出改动涉及哪些表：实体注解 `@TableName` / `@Table`（没写表名时按类名转下划线并标 `inferred`）、Mapper XML 与代码里的 SQL 字符串、SQL 脚本里的 DDL（标 `ddl`），并标出是否已在 `schema.md` 里、给出拉表结构的命令。`database-query` 的 `query.mjs --schema --tables a,b --indexes` 另外列出索引（唯一与否、列顺序）、估算行数，并标出库里不存在的表（不加 `--indexes` 时也标）。新共用说明 `workflow/references/tables.md`：先定位表，数据库已配置时只读拉实际结构核对字段、索引支撑、DDL 锁表与回填，没有连接时退回 `schema.md` / DDL 脚本并注明「未与实际库核对」。
  - dev：F2 调研、F5 写 DDL 前、F6 自检时按它核对；交付说明的 SQL 节写明涉及的表与核对结果。
  - project-review：第 2 步 diff 涉及 SQL / Mapper / 实体 / DDL 时先拉实际表结构，作为索引支撑、字段存在与类型、锁表与滚动发布兼容的判断依据；查不了库写进「未覆盖与待确认」，这类发现不凭推测升到 HIGH。`skill.json` 的 optional 加上 `database-query`，审查清单第 12 节同步。

## [0.11.0] - 2026-10-16

### 新增
- **`/workflow template [<模板>] [怎么改]`：修改 / 创建模板一条命令走完**。新脚本 `workflow/scripts/template.mjs`：`draft` 把当前生效的模板复制成草稿 `tmp/skills/template-draft/<skill>/<文件名>`（还没有模板或 `--from <样例>` 时用 make-template 抽骨架）；`check` 校验草稿格式（标题、`{{ }}` 成对、`{{fact:}}`、重名章节、没有必填章节），列出与当前模板相比新增 / 删除的章节、必填与可选标记变化、顺序变化，并拿最近 5 份已生成的文档按新旧模板各跑一次 lint，列出新模板下多出的错误；`save` 在校验通过后备份旧模板到 `tmp/skills/template-backup/<时间>/`、写入 `docs/skills/templates/<skill>/`、重新判定确认生效；已接入 DocNexus 时退出码 2 并给出 capture 指引（写入需授权）。`list` 列出各模板来源与未完成的草稿。别名 `tech` / `release` / `plan` / `delivery` / `review` / `checklist`。`workflow/references/templates.md` 新增「修改模板」流程，「创建模板」改为同一套草稿 / 校验 / 保存；技术方案、上线方案 skill 的改模板与模板回写指向它。

## [0.10.1] - 2026-10-16

### 变更
- **skills 目录里的文件一律以安装包为准**：重跑与升级时 `SKILL.md`、`skill.json`、references、scripts 总是更新为新版，不再询问、不再保留旧版本并另存 `.new`。手改过的（或没有清单无从判断的）先备份到 `tmp/skills/upgrade-backup/<时间>/`，结尾列出；新版已删除的文件，改过的同样备份后删除。旧版本留下的 `.new` 升级时清理。避免出现「新 SKILL.md 配旧 skill.json」这类新旧混搭（例如 0.10.0 升级时技术方案 / 上线方案的 `skill.json` 被保留，新的按需创建模板逻辑不生效）。用户配置（`config.json`、`schema.md`、`wiki-config.json`、`profile.json`）照旧不覆盖。`doctor` 的提示同步调整。

## [0.10.0] - 2026-10-16

### 变更
- **技术方案、上线方案的模板不再随 skills 提供**：各团队发到 wiki 的格式不同，`create-tech-md-doc` / `create-release-md-doc` 改为按项目自己的模板生成。还没有模板时（`resolve.mjs template` 退出码 2，输出 `on_demand: true` 与 `expected`），skill 停下来请用户给一份团队现有的同类文档作样例（本地 Markdown，或 wiki pageId / URL），生成模板、用户确认后保存：未接入 DocNexus 时存到 `docs/skills/templates/<skill>/template.md`，已接入时经授权写入 DocNexus（`doc-template` 分类）。用户也可以随时要求重新生成模板。两个 skill 的填充改为按章节含义放事实，不再依赖固定的模块编号；元信息行「填充模块」改为「待补充章节」。
- 老项目升级时，还在用原自带默认模板的（项目和 DocNexus 里都没有自己的版本），安装器先把它保存到 `docs/skills/templates/<skill>/template.md`，生成效果不变。
- `seed-templates` 只导入、跟踪有默认版本的模板；`resolve.mjs status` 新增 `templates_to_create`，`doctor` 列出还没创建的模板。

### 新增
- `workflow/scripts/make-template.mjs <样例.md | ->`：从样例文档抽模板骨架，保留标题层级与表格列，正文换成 `{{...}}` 填写提示，去掉标题前的元信息块；wiki 页面的纯文本（`upload.mjs get --text`）也能直接用。`workflow/references/templates.md` 新增「创建模板」流程。

## [0.9.0] - 2026-10-16

### 新增
- 本地效果报告：`/workflow report` 或 `skills-init report [--since YYYY-MM-DD] [--json]`，脚本 `workflow/scripts/report.mjs` 只读统计 `docs/skills/` 下的产物，不上报：审查各级别发现、严重问题复核通过率、复审时上次问题的修复率；交付的类型与规模、需求澄清确认的决定条数、带未验证项的交付；DocNexus 沉淀率与正文引用知识库的产物占比；各分支产物链路是否齐全、哪些文档未发布到 wiki。
- PR / MR 描述：`workflow/scripts/pr-desc.mjs` 把本分支的交付说明（做了什么、已确认的决定、改动、验证、配置 / SQL）、审查报告（结论、CRITICAL / HIGH、影响面）和相关文档汇总成描述；没有交付说明时退回用提交记录和改动文件。dev 交付后要提 PR 时调用；workflow 路由新增「写 PR / MR 描述」。
- `report --all-branches`（PowerShell `-AllBranches`）：用 git 只读扫描所有本地分支里提交过、还没合并的产物，同一路径以工作区为准；默认只看工作区时报告会提示这一点。
- `artifacts.mjs` 的下一步建议：本分支有交付说明或审查报告时提示用 `pr-desc.mjs` 生成 PR / MR 描述；`/workflow status` 末尾提示 `/workflow report`。

### 变更
- dev 新增 **S 规模快速通道**：S 规模且不涉及配置、SQL / DDL、对外接口、表结构，也没有需要澄清的决定时，编译、测试、自审照常，只在对话里交付，不落盘交付说明、不问 DocNexus 沉淀；实现中碰到上述任何一项、改动超过 3 个文件或用户要求落盘时退回完整流程。缺陷修复同样适用，根因仍须在对话里写清楚。
- Node 要求从 >= 18 提到 >= 22（`engines`、封装脚本、README）：18、20 已停止维护，CI 只在 Node 22 / 24 上测试；低于 22 时安装器给出警告，`doctor` 记为错误。
- `doc-sections.mjs` 的标题识别改为复用 `lint-doc.mjs`（跳过代码块、统一归一化编号 / 必填 / 「如有」标记），模板标题的写法只在一处定义。

### 修复
- `init-skills.ps1` 不认 `report` 子命令（`ValidateSet` 缺失），新增 `-Since` / `-Json` / `-AllBranches`。

## [0.8.1] - 2026-10-16

### 变更
- project-review 的 DocNexus 沉淀对齐 dev：已接入 DocNexus 时交付报告后**每次都问**要不要沉淀（列出建议沉淀的问题模式 / 约定 / 坑，没有值得记的也照问并说明）；同意后以 `code-review` 分类写入，只沉淀问题模式和约定（不含逐条清单和「⚠ 待确认」的发现），成功后把 `docnexus/library/<path>` 记回报告新增的「DocNexus」元信息行；未接入时不提问，元信息行写「未接入」。
- `package.json` 的 description 补上 code-graph。

## [0.8.0] - 2026-10-16

### 新增
- 新 skill **code-graph**：在 CodeGraph 代码图谱之上封装本工作流需要的查询，脚本 `code-graph/scripts/cg.mjs` 直接调用 CodeGraph 的库（`CodeGraph.openSync` / `getNodesInFile` / `getCallers` / `getCallees`），并补上它看不到的 Java / Spring 关联：
  - `impact --diff <main>...<dev>` / `--base <main>`：diff → 改动的方法 / 配置常量 / XML 语句 → 向上追调用方，一次给出受影响的 HTTP 接口、MQ 消费者（含 topic，方法或类上的 `@KafkaListener` / `@RabbitListener` / `@RocketMQMessageListener` 等）、定时任务（`@Scheduled` / `@XxlJob`）、受影响与改动过的测试、向下调用到的 MyBatis 语句及表、改动的 `@Value` 配置 key、删除的文件；索引落后于工作区时先 `codegraph sync`。
  - `entry <Class.method>`：方法向上能到达的入口与覆盖它的测试。
  - `mq` / `jobs` / `tables`：topic 生产方与消费方、定时任务入口、XML 语句涉及的表；只扫源码，没有索引也能用。
  - 没有 `.codegraph/` 索引、找不到库或 Node < 22.5 时退出码 2 并说明原因，skill 退回 grep / 读文件；不替用户建索引。
  - dev（改公共方法前看入口、先跑受影响的测试、交付写受影响的接口 / 表 / 配置）、project-review（影响面按入口归纳）、技术方案与上线方案（影响范围、中间件上线、回归验证）改为调用它；workflow 路由新增 code-graph。
  - `--with-codegraph` 改为安装 `@colbymchenry/codegraph@1`（skill 按 1.x 的库接口编写）。
- 集成 [CodeGraph](https://github.com/colbymchenry/codegraph) 代码图谱（可选），补上「读项目源码」这一块：
  - `--with-codegraph` / `-WithCodeGraph`：没有 `codegraph` 命令时 `npm i -g @colbymchenry/codegraph`；为 claude / codex 用 `codegraph install --location=local --yes` 写项目级 MCP 配置（doubao / qwen 不支持，skills 改走 CLI）；`codegraph init` 建本项目索引 `.codegraph/` 并加入 `.gitignore`。本工具发起的调用都带 `DO_NOT_TRACK=1`，安装结束提示如何关闭 CodeGraph 自身的匿名统计。
  - `resolve.mjs status` 新增 `codegraph`（`ok` / `cli` / `indexed`），`/workflow status` 与 `doctor` 显示接入状态。
  - 新增 `workflow/references/codegraph.md`：MCP 工具 `codegraph_explore` 与 CLI（`explore` / `node` / `callers` / `callees` / `impact` / `affected` / `query`）对照、结论仍需「文件:行号」出处、图谱看不到的部分（Spring 注入 / AOP / 反射、MyBatis XML、MQ、配置 key）照常 grep、「没有调用方」不等于安全、skill 不自行建索引。
  - dev：现状调研用 `explore` 读调用链，改公共方法前 `impact`，验证时用 `affected` 先跑受影响的测试；project-review 影响面分析用 `callers` / `impact`；技术方案的影响范围、上线方案的回归接口参考 `impact`。

### 变更
- 适配 DocNexus 0.17.0 的安装位置：CLI 从项目根 `node_modules/.bin/docnexus` 改为 `docnexus/node_modules/.bin/docnexus`（npm 清单与依赖不进宿主项目）。安装器、`seed-templates`、`doctor`、`resolve.mjs`、`knowledge.mjs` 统一按「`docnexus/` 下优先、项目根兼容」查找 CLI，之前只认项目根，新装法的项目会被当成「未接入 DocNexus」。`--with-docnexus` 新装时用 `npm install --prefix ./docnexus --save-exact`，已装在项目根的沿用原位置升级；`doctor` 的升级提示按实际装法给命令；`resolve.mjs status` 新增 `docnexus.bin`（实际 CLI 路径），SKILL 里的接入判定改为引用它。

## [0.7.0] - 2026-10-15

### 变更
- dev 交付说明落盘：每次交付（功能开发与缺陷修复）都写到 `docs/skills/dev/delivery-<需求短名>-<YYYYMMDD>.md`，模板 `dev/references/delivery-template.md` 改为可被 DocNexus 覆盖、可 lint 的正式模板（元信息：类型、规模、对比分支、参考产物、DocNexus），写完跑 `lint-doc.mjs --template delivery-template.md`；对话里只给摘要和路径。
- dev 交付后，已接入 DocNexus 时**每次都问**要不要启动 DocNexus 流程沉淀本次交付（列出建议沉淀的决定 / 约定 / 坑 / 根因 / 配置变化）；同意后以交付说明为来源、`dev-notes` 分类写入，成功后把 `docnexus/library/<path>` 记回交付说明的「DocNexus」元信息行；未接入时不提问。
- `artifacts.mjs` 识别交付说明（`latest.delivery`）。project-review 把交付说明里「已确认的决定」并入需求对照，并核对它的配置清单 / SQL 有没有漏列 diff 里的配置 key / DDL；上线方案按分支自动引用交付说明的配置清单、SQL 与未验证项（新增元信息行「交付说明引用」）。
- 已接入 DocNexus 的项目 `upgrade` 时会自动导入新的交付说明模板。

## [0.6.2] - 2026-10-15

### 变更
- Windows 上 `init` / `upgrade` 只能在管理员终端执行：开始前检测当前终端是否以管理员身份运行（PowerShell 判断管理员角色，没有 PowerShell 时用 `net session`），不是就直接停下、不做任何改动，并提示「以管理员身份运行」终端后进入项目目录重跑（给出原命令；经 init-skills 脚本调用时提示重跑脚本）。`doctor`、`seed-templates`、`uninstall` 不受限制；macOS / Linux 不检查。

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

[Unreleased]: https://github.com/guilianerde/skills-init/compare/v0.21.0...HEAD
[0.21.0]: https://github.com/guilianerde/skills-init/compare/v0.20.0...v0.21.0
[0.20.0]: https://github.com/guilianerde/skills-init/compare/v0.19.0...v0.20.0
[0.19.0]: https://github.com/guilianerde/skills-init/compare/v0.18.0...v0.19.0
[0.18.0]: https://github.com/guilianerde/skills-init/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/guilianerde/skills-init/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/guilianerde/skills-init/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/guilianerde/skills-init/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/guilianerde/skills-init/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/guilianerde/skills-init/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/guilianerde/skills-init/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/guilianerde/skills-init/compare/v0.10.1...v0.11.0
[0.10.1]: https://github.com/guilianerde/skills-init/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/guilianerde/skills-init/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/guilianerde/skills-init/compare/v0.8.1...v0.9.0
[0.8.1]: https://github.com/guilianerde/skills-init/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/guilianerde/skills-init/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/guilianerde/skills-init/compare/v0.6.2...v0.7.0
[0.6.2]: https://github.com/guilianerde/skills-init/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/guilianerde/skills-init/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/guilianerde/skills-init/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/guilianerde/skills-init/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/guilianerde/skills-init/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/guilianerde/skills-init/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/guilianerde/skills-init/releases/tag/v0.2.0
