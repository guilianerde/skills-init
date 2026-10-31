# 工作流与命令

[返回首页](../README.md) · [安装与升级](installation.md) · [外部能力集成](integrations.md) · [团队共享、产物与模板](team-guide.md) · [维护、测试与发布](development.md)

## 代理命令示例

下列内容在代理对话中输入，不是在终端执行。分支、路径、连接、表名和页面 ID 按项目替换；没有固定参数格式的能力使用自然语言指定 skill 和目标。

| 目的 | 示例 |
| --- | --- |
| 查看能力地图 | `/workflow` |
| 初始化项目画像 | `/workflow profile` |
| 检查能力与当前流程进度 | `/workflow status` |
| 续接当前分支流程 | `/workflow resume`（有多个运行时可追加运行 ID） |
| 查看效果报告 | `/workflow report` |
| 浏览需求产物 | `/workflow view` |
| 修改业务场景清单模板 | `/workflow template clarification 增加场景优先级` |
| 修改实现方案模板 | `/workflow template plan 补充 HTTP 接口验证场景` |
| 功能开发 | `/dev 订单导出支持按渠道筛选` |
| 缺陷修复 | `/dev --bug 导出订单时重复返回数据` |
| 分支审查 | `用 project-review 审查当前分支相对 main 的改动` |
| 工作区快审 | `用 project-review 快审当前未提交的改动` |
| 技术方案 | `/create-tech-md-doc feature/order-export main --prd 123456` |
| 上线方案 | `/create-release-md-doc feature/order-export main`（自动查找同分支已有技术方案） |
| wiki 校验 | `/md-to-wiki "技术方案.md" 123456 --validate-only` |
| wiki 发布 | `/md-to-wiki "技术方案.md" 123456`（需要已配置 wiki 和已有目标页面） |
| 只读查库 | `用 database-query 查询 test 连接：SELECT id, status FROM orders LIMIT 10` |
| 调用入口分析 | `用 code-graph 查看 OrderService.exportOrders 从哪些接口或任务进入` |
| Nacos 参数查询 | `用 nacos-config 读取测试环境 order-test.yaml 中的 order.timeout` |

模板别名：`clarification`、`requirement`、`plan`、`delivery`、`review`、`checklist`、`tech`、`release`。技术 / 上线方案命令必须提供开发分支和基线分支；PRD 使用 pageId 或 URL，wiki 发布使用已有页面的 pageId 或含 pageId 的 URL。

## workflow：入口与项目画像

```
/workflow            # 按请求路由到对应 skill；无具体请求时输出能力地图 + 状态
/workflow status     # 检查项目画像、wiki、DocNexus、数据库是否可用
/workflow profile    # 从仓库推断并经你确认后填写 workflow/profile.json
/workflow report     # 本地效果报告（也可以直接运行 npx @rowansenne/workflow-run report）
```

**效果报告**（`/workflow report` 或 `npx @rowansenne/workflow-run report [--since YYYY-MM-DD] [--all-branches] [--json]`）只读统计 `workflow-run/docs/requirements/` 下已落盘的产物，不上报、不另存记录，用来回答「用了以后有没有更好」。默认只看工作区；产物随特性分支提交、还没合并时加 `--all-branches`，用 git 只读扫描所有本地分支（同一路径以工作区为准）。统计内容：

* 审查：各级别发现条数、严重问题复核通过率、复审时上次问题的修复率；
* 交付：功能 / 缺陷、S / M / L、开工前经需求澄清确认的决定条数、带「未验证项」的交付；
* 知识：交付与审查的 DocNexus 沉淀率（只算真正问过沉淀的，「未询问」「无需沉淀」不计入分母；dev 内部审查不单独询问或重复计入交付沉淀）、正文引用了知识库文档的产物占比；
* 各分支链路：方案、交付说明、审查报告、技术方案、上线方案齐不齐，哪些文档还没发布到 wiki。

**完整流程状态与续接**：需求目录的 `meta.json` 同时保存绑定、产物索引和按运行 id 区分的 `runs`。每次运行关联分支，记录阶段、逐步完成标记、上下文、待用户决定、阻塞原因、历史与 revision；完成后保存 `status: completed` 和 `completed_at`。`/workflow status` 查看状态，`/workflow resume [运行id]` 核对后继续；`/workflow view` 展示运行与“已完成”，尚未生成 Markdown 的运行也可见。快速通道保持不绑定、不创建运行状态。完整 dev 在首次落盘前初判规模、选择完整流程并开始记录，需要清单时在 F2／B3 先生成业务场景 clarification.md 并等待产品反馈；F3／B3 技术澄清完成后收尾 requirement.md，再进入 F4／B4 的实现方案，补入此前已确认的进度；后续文档／发布用独立运行保留开发的完成记录。脚本用法见 `workflow/references/runs.md`，`sync` 不会清掉状态。

**F3 前的业务核对循环**：F1 理解需求后，在 F2 先用 `artifact.mjs finalize --kind clarification` 发布同一需求目录的 `clarification.md`，聚焦角色、正常 / 异常场景、业务规则、范围和业务验收，供你找产品核对与完善 PRD。每轮在同一清单更新答复和状态、追加新问题与反馈记录，保留编号和已确认项，自动归档旧版。业务项未明确时保持 F2 in_progress、运行为 waiting_user；业务明确并完成现状调研后进入 F3，澄清可行性、接口兼容、数据、权限、依赖等技术约束。技术问题改变业务场景时回 F2 更新清单。业务与技术约束均明确后收尾 requirement.md，再进入 F4 写方案。清单是正式产物，纳入视图和统计；没有业务待确认项且用户未要求时可省清单。

**运行反馈**（`npx @rowansenne/workflow-run feedback [--json]`）：效果报告只看落盘的产物，看不到过程。dev 和 project-review 每跑完一次，用 `workflow/scripts/feedback.mjs add` 静默追加一行到 `workflow-run/feedback/<git 用户名>.jsonl`：模型、规模 / 深度、是否走快速通道、向用户提问几轮、用户纠正过几次理解、验收项验证了几条、跳过了哪些步骤、**哪条规则读不懂或做不到**、用户主动说的抱怨。只记过程，不记代码和业务名词；不额外问用户。每人一个文件，随 `workflow-run/` 提交，多人不冲突。独立文档仓库模式下，安装器在文档仓库的 `workflow-run/.gitattributes` 里给这些文件配 `merge=union`，同一个文件在几个分支上都有记录时合并也不冲突；随代码提交时不改代码仓库的 `.gitattributes`，合并时遇到冲突保留两边的行即可。用来定期精简 skill：

1. 团队照常用两三周；
2. 运行 `feedback` 汇总（或直接拿 `workflow-run/feedback/` 下的文件），按「常被跳过的步骤」「读不懂的规则」「提问太多」精简 SKILL.md，发新版本；
3. 各项目 `upgrade` 时清掉本项目旧版本的记录（git 历史里仍可找回），从新版本重新收集，回到第 1 步。

字段与记录规则见 `workflow/references/feedback.md`。

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
  "toolchain": {
    "java_home": "$JAVA_HOME",
    "maven": { "settings": "$HOME/.m2/settings.xml", "repository": "/data/maven-repo" },
    "gradle_user_home": "",
    "node": ""
  },
  "env_vars": { "JAVA_HOME": "/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home" },
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
| `toolchain` / `env_vars` | 开发环境配置：JDK（`java_home`）、Maven（`maven.settings` / `maven.repository`）、Gradle（`gradle_user_home`）、Node（`node`）的位置，以及路径里用到的变量。路径写 `$JAVA_HOME` 这类变量或本机绝对路径，`~` 展开为用户目录；**不含凭据**。构建跑不起来时 dev 用它核对 |

**开发环境配置**（`toolchain`）：JDK 在哪、Maven 用哪个 `settings.xml`、本地仓库在哪个盘，这些决定构建和测试能不能跑起来，统一由画像提供，模板里不写死：

```bash
node .agents/skills/workflow/scripts/resolve.mjs env --check   # 逐个字段核对在本机是否存在
```

`/workflow profile` 时会用 `infer-profile` 自动推断草稿（构建文件对应的工具、`JAVA_HOME` / `GRADLE_USER_HOME`、`~/.m2/settings.xml` 与其 `<localRepository>`、`~/.gradle`、锁定的 Node 版本），每个值带依据，经你确认后写入。Maven 的两份 `settings.xml`（全局 `$MAVEN_HOME/conf` 与用户级 `~/.m2`）**会合并、以用户级为准**，所以取用户级那份、全局的记在依据里；`<localRepository>` 也只认有效配置，注释里的示例会被忽略。路径可以写 `$JAVA_HOME`、`${VAR}`、`%VAR%`（用 `env_vars` 或本机环境展开）或 `~`。`env --check` 对每个字段给出展开后的路径、是否存在、哪个变量没配，以及本机实际的 `JAVA_HOME` / `MAVEN_HOME` / Node 目录，方便对照。**JDK、Maven 的位置每台机器不同**：团队共用一份就写 `profile.json`，个人不同就写 `profile.local.json` 的同名字段（优先），不用改团队那份；个人那份里写 `""` 表示**不用**团队那个值（用工具默认配置），不写这个键才是沿用。这一块只放路径和普通环境变量，token、密码一律不写。

**本机系统与终端**：安装 / 升级时检测一次，写进 `workflow/profile.local.json` 的 `env`（个人设置，已在 `.gitignore` 里，团队里各人各机器不同），例如 `{ "os": "windows", "shell": "powershell" }`。Windows 上区分 `pwsh`（PowerShell 7）和 `powershell`（Windows PowerShell 5.1，没有 `&&`），其他系统取 `$SHELL`。skill 写终端命令时读 `resolve.mjs env`（`profile` / `status` 的输出里也有），不再每次对话自己探测；skill 里给出的命令本身都是 `node …` / `git …`，在哪个终端都一样。换了终端或机器，重跑一次安装器即可。

## dev：开发与修 bug

```
/dev <需求描述 | PRD pageId/url>     # 功能开发
/dev --bug <现象 | 报错 | 日志>       # 缺陷修复
```

**仅显式触发 dev**：实际调用 `/dev` / `$dev`、点选 dev skill，或明确说「按 dev 流程」「使用完整开发工作流」时才启动。正常分析、问答、修改代码、修 bug、重构、跑测试、提交 / 推送代码都直接处理，不自动做 dev 的开工检查、需求命名、绑定或文档落盘，也不主动询问是否开启 dev。讨论 dev 或引用命令示例不算启动；任务复杂、分支已有需求目录或旧运行也不算授权。

Codex 原生元数据 `dev/agents/openai.yaml` 设置 `policy.allow_implicit_invocation: false`；所有环境同时遵守 skill 入口规则与安装写入的项目说明。已由用户启动的同一 dev 任务可按当前阶段继续，无需每条消息重复命令；只要求分析或提交时仅处理该请求，不重启流程。升级 / 重装会更新规则，随后新建会话加载；其他宿主的原生调用策略取决于宿主支持，不能将配置校验等同于所有模型的行为保证。

* **功能开发**：开始前先确定工作分支，再确认需求名（给不出名字或说不清要做什么就不开始）→ 理解需求（可读 PRD、查 DocNexus 历史决策）→ F2 先出业务场景清单与产品核对、调研现有代码 → F3 技术澄清（基于已确认场景查证可行性与系统约束，必要取舍分轮给推荐；新业务问题回 F2；S 规模无未定决定时省提问）→ **规模判定（S / M / L 说明判定依据，不再询问确认）** → 按规模出方案（非快速通道一律落方案文档：S 简版、M 精简版、L 完整版；S 符合条件时先问是否走快速通道，走则不落盘）→ 小步实现并编译 → 补测试并运行 → 优先由独立子 agent 按 project-review 审查并落盘 `review.md`（没有子 agent 时在当前会话自查，报告注明审查者）→ 报告交给用户，等待选择「修复问题 / 交付」；修复则验证后重新审查、再次等待选择，选择交付后才将交付说明落盘到 `workflow-run/docs/requirements/<需求名>/<项目名>/delivery.md`（带分支元信息；改动、验证结果、配置清单、未执行的 SQL），已接入 DocNexus 时交付里有值得记录的知识才问要不要沉淀（同意后以 `dev-notes` 分类写入，并把库内路径记回交付说明），没有就跳过并在元信息行写「无需沉淀」。审查和上线方案会按分支自动读取这份交付说明。
* **S 规模快速通道**：已发布本次正式清单或创建完整流程运行时继续完整流程，规模降为 S 也不切换。规模判定不询问用户；S 规模且不涉及配置、SQL / DDL、对外接口、表结构，也没有 F2 / F3 已确认或仍待澄清的业务决定，且本次未发布正式清单、未创建完整流程运行时，**问用户是否走快速通道**，问完等本轮答复——明确同意才走：编译、测试照常，审查在当前会话按标准清单做，**不绑定需求、不落任何产物文件**（方案 / `review.md` / 交付说明都不写；运行反馈照常记一行），对话里一次交付并注明「DocNexus：未询问（快速通道不问沉淀）」；拒绝或未明确同意就按完整流程落盘交付。实现中碰到上述任何一项或改动超过 3 个文件，先停下后续实现、重新评估规模，绑定需求并先回 F3（缺陷 B3）补需求文档，再到 F4 / B4 补方案、自检；M / L 确认方案后再继续实现、验证、审查与交付选择。缺陷修复同样适用（根因仍须在对话里写清楚）。
* **缺陷修复**：收集现象 → 用失败测试复现 → 用证据定位根因 → **判定规模并告知（S 规模问是否走快速通道；M / L 确认根因与修复方式后再改）** → 完整流程先生成描述现象、期望与验收的 `requirement.md`，再把根因与修复方式追加到 `plan.md`，同步更新文档头的修复分支与日期（不另建文件）→ 最小修复让测试转绿 → 审查并落盘报告（无子 agent 时当前会话自查）→ 用户选择修复或交付（修复后验证与复审；交付必须写明根因）。
* 审查优先用独立子 agent（期间不继续改被审代码，子 agent 只审查、写报告，不直接修复）；没有子 agent 时降级为当前会话自查并把「审查者」写成当前 agent，不阻塞、也不跳过审查。遗留严重问题须说明风险并由用户明确接受，不能把选择交付写成审查通过。
* **HTTP 接口验证**：新增 / 修改接口或接口行为时，F4 在方案列出方法 / 路径、AC 和场景，F6 沿用既有框架编写或更新并执行接口层测试，F7 标准 / 深审检查覆盖与执行证据。至少测正常请求、适用的参数错误和未登录 / 无权限场景，断言状态码与关键响应；纯内部重构且接口行为不变、已有覆盖充分时运行现有用例即可。缺环境时记录未验证、原因及可执行请求和预期结果，不将单元测试通过视为 HTTP 接口测试通过。缺陷修复 B4 / B5 沿用相同规则。
* 守则：不写库、不改凭据、不擅自 commit / push、不装新依赖；测试没跑就写「未验证」。
* DocNexus 是必装组件，缺失或查询失败时先修复；wiki、CodeGraph、数据库为可选增强，所有 Skill 共用开工能力快照与失败处理规则（`workflow/references/capabilities.md`）。

## 脚本化的规则

能写成确定规则的判断都放在脚本里，SKILL.md 只说明什么时候调用，不再让 agent 按文字描述自己判断：

| 脚本（安装后在 `<skills>/` 下） | 作用 |
| --- | --- |
| `workflow/scripts/resolve.mjs template <skill> <文件名>` | 只从 DocNexus 知识库解析模板；缺失时给出导入或创建指引，不回退到包内模板 |
| `workflow/scripts/resolve.mjs profile` | 读项目画像，列出空字段 |
| `workflow/scripts/resolve.mjs env` | 本机系统与终端（安装时记录在 `profile.local.json`），写终端命令按它来 |
| `workflow/scripts/resolve.mjs env --check` | 核对画像里的开发环境配置（`toolchain`）在本机是否存在：每个字段给出 `resolved`（展开后）、`exists`、`unset_vars`，以及 `current`（本机实际的 `JAVA_HOME` / `MAVEN_HOME` / Node 目录）便于对照 |
| `workflow/scripts/docnexus.mjs <参数>` / `--node <脚本> <参数>` | 在业务项目根运行 `.docnexus/` 中的 CLI 或它的 node 脚本，知识输出到 `workflow-run/docnexus/`；Windows 上直接用 node 跑 CLI 入口，不经过 `.cmd` |
| `workflow/scripts/knowledge.mjs <skill> [--match 词] [--limit n] [--query 问题]` | 按 `readFrom` 的分类列出 DocNexus 文档（标题、摘要、路径，不含正文）；`--query` 再在每个分类内 `recall --category`，直接使用新版按分类检索能力。必装组件不可用时退出码 2，查询失败返回非 0，不当作无匹配 |
| `workflow/scripts/resolve.mjs category <skill>` | 该 skill 写入 DocNexus 时的显式分类（画像 `docnexus_categories` 优先，其次 skill.json），输出 `seal_args` 与 `metadata`；未声明时退出码 1 |
| `workflow/lib/capabilities.mjs` | 集中探测必装 DocNexus 与可选增强；供 resolve status 输出本轮能力快照 |
| `workflow/scripts/resolve.mjs status` | `/workflow status` 的能力探测（不输出任何凭据） |
| `workflow/scripts/resolve.mjs infer-profile` | 按固定规则从构建文件、Makefile、依赖与配置文件、git 推断项目画像草稿，每个字段附依据；不写文件 |
| `workflow/scripts/lint-doc.mjs <文档> --skill <skill> [--facts]` | 对照当前生效的模板检查生成的文档：必填章节、残留 `{{...}}` 占位符、元信息行为错误；缺普通章节、顺序不一致为警告；列出待填写位置。`--facts` 再核对正文里的类名、文件、接口、表名：在对比分支的 diff 和代码里都找不到的记为警告（防编造） |
| `workflow/scripts/requirement.mjs which / bind / path / sync / pending / list / config` | 产物按需求归档（`workflow-run/docs/requirements/<需求>/<项目>/`，两种模式结构相同）：查当前分支绑定的需求（没绑定时给出按分支名生成的建议名）、绑定需求名、给出本次落盘路径（不覆盖，带上一版的 wiki 记录）、重建 `meta.json`、列出所有需求；`config` 设置产物位置（文档仓库、项目名、提交提示），`pending` 看文档仓库里还没提交的产物 |
| `workflow/scripts/view.mjs [--out f] [--open]` | 项目文档视图（`/workflow view`、`npx @rowansenne/workflow-run view`）：读需求目录里的产物，生成单个 HTML，按需求列出各阶段、审查记录（各级别数量、复核、与上次对比）、交付记录、沉淀到的知识文档，正文直接渲染；顶部「知识文档」列出每篇知识文档来自哪个需求、哪份产物；数据内嵌，只读、不联网，默认写到 `workflow-run/tmp/view/index.html` |
| `workflow/scripts/run.mjs show / start / save / complete / cancel` | 需求 meta.json 中的分支运行记录：恢复、checkpoint、已完成状态与时间、等待用户、修复回退、revision 冲突检查 |
| `workflow/scripts/artifacts.mjs [--branch b \| --all]` | 按分支汇总 `workflow-run/docs/requirements/` 下的方案、交付说明、审查报告、技术方案、上线方案及其 wiki 发布记录，给出下一步建议；分支取自文档元信息行，不另存记录。上线方案没传 `--tech` 时据此自动引用同分支的技术方案；project-review 据此对照本分支方案、识别复审 |
| `workflow/scripts/report.mjs [--since d] [--all-branches] [--json]` | 本地效果报告（`/workflow report`、`npx @rowansenne/workflow-run report`）：审查发现与修复率、复核率、需求澄清、沉淀率、知识引用、各分支链路 |
| `workflow/scripts/feedback.mjs add … / summary [--json]` | 运行反馈：dev / project-review 交付后追加一行过程记录到 `workflow-run/feedback/<用户>.jsonl`；`summary` 按 skill 汇总，跳过的步骤和不清楚的规则按 SKILL.md 章节归类（`npx @rowansenne/workflow-run feedback`）；`init` / `upgrade` 装了新版本时清掉本项目旧版本的记录 |
| `workflow/scripts/review-scope.mjs [--diff b...h \| --base b] [--exclude a,b]` / `rules <文件…>` | 审查范围：由脚本决定审哪些文件、跳过哪些（删除、二进制、敏感文件、依赖目录、生成文件、文档、本工具产物，各带原因）、每个文件的风险级别和分批，以及按文件类型和改动内容该看审查清单的哪几节；`--base` 含未提交和未跟踪的新文件。`rules` 打印这些小节的原文和画像 `review.rules` 里匹配的项目规则。project-review 第 1、3、4 步与 dev 自审使用 |
| `workflow/scripts/locate.mjs <发现.json> [--diff b...h \| --base b]` | 给审查发现定位行号：按每条发现引用的原代码片段在文件里查找（精确 → 忽略空白 → 单行部分匹配），多处时优先本次改动的行，输出起止行、是否落在本次改动上；找不到的标出来要求重读代码。project-review 第 6 步复核使用 |
| `workflow/scripts/tables.mjs [--diff b...h \| --base b \| --files a,b]` | 找出改动涉及哪些表：实体注解（`@TableName` / `@Table`，没写表名时按类名推断）、Mapper XML 与代码里的 SQL、DDL 脚本；标出 DDL、是否在 `schema.md` 里，并给出拉表结构的命令。dev 调研 / 自检与 project-review 审 SQL / DDL 时使用 |
| `workflow/scripts/template.mjs list / draft / check / save <模板>` | 修改 / 创建模板（`/workflow template`）：把当前模板复制成草稿（或 `--from <样例>` 抽骨架），`check` 校验格式、列出章节变化、拿最近几份已生成文档试跑 lint 看影响，`save` 给出写入 DocNexus 知识库的 capture 指引，不直接写知识库；必装组件不可用时先修复 |
| `workflow/scripts/pr-desc.mjs [--branch b] [--base m] [--out f]` | 按本分支产物生成 PR / MR 描述；没有交付说明时退回用 git 记录 |
| `database-query/scripts/query.mjs` | 执行 SQL：选连接、取密码（只通过环境变量传给客户端）、会话层只读、拦截写语句和多语句、自动补 LIMIT、超时、脱敏敏感列；支持 mysql / psql 客户端，其他 driver 退回 JDBC |
| `database-query/scripts/query.mjs --schema [--tables a,b] [--write]` | 按只读会话导出表结构为 Markdown；`--write` 写入 `references/schema.md` 的 `schema:begin` / `schema:end` 之间，标记外的补充说明保留；指定的表在库里不存在时标出 |
| `database-query/scripts/query.mjs --schema --tables a,b --indexes` | 另外列出索引（唯一与否、列顺序）和估算行数，供 dev / project-review 核对字段、索引支撑和 DDL 锁表风险 |
| `nacos-config/scripts/config.mjs inspect / get` | 本地定位 Nacos 连接；按显式环境、Namespace / Group / Data ID 只读获取配置，查询 key 或子树，返回脱敏属性与来源；独立运行，不创建需求状态 |
| `md-to-wiki/scripts/upload.mjs info / put / target / record` | REST 上传通道：`info` 读页面标题与版本给用户确认；`put --expect-version <n> [--record <md>]` 先校验 XHTML 良构，版本对不上就拒绝上传，上传后确认版本 +1，并把发布记录写回 Markdown 第一行注释（转换时丢弃，不出现在页面上）；`target` 读出记录，再次发布同一文档不必再给 pageId；`record` 供 MCP 通道上传后补写 |
