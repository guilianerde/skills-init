# 架构、模块边界与统一读取模型

本文对应 0.29.0（2026-10-28），包括独立 nacos-config、需求文档与 dev 显式触发规则；实现以代码与各 skill 的 skill.json 为准。

## 安装分发与运行

安装接入在 `bin/`；各 Skill 的 SKILL.md 与 references 定义流程步骤、确认点和调用时机；`workflow/lib/` 承担共享规则与数据读写；`workflow/scripts/` 保留既有命令和导出入口。数据库、代码图谱、wiki、Nacos 的执行与凭据仍在各自能力目录。`shared/` 只分发参考文档，运行共享代码随 workflow 的 lib 一起安装。宿主代理执行规则与命令，workflow-run 不提供常驻的 Agent 调度服务。

`bin/skills.mjs` 从各目录的 `skill.json` 发现当前 9 个 skills，以 `requires` 展开必需依赖，`optional` 标记可选协作；`userFiles` 决定升级保留范围，`templates` 声明知识模板，`docnexus` 声明分类。`package.json.files` 决定 npm 分发内容。默认在 `.agents/skills/` 安装完整文件，其他环境逐 skill 建相对链接；`--copy` 或链接失败时改用拷贝。安装清单记录分发文件 hash，手改文件升级前备份，用户配置不覆盖。

DocNexus 在安装环节必装，即使只选择 nacos-config 也会接入；Nacos 的读取脚本本身没有 workflow / DocNexus 运行依赖。DocNexus 自带的入口、召回等 skills 单独链接给宿主，不计入本包的 9 个 skills。

## 两条执行路径

| 请求 | 调用路径 | 状态归属 |
|---|---|---|
| 开发、正式审查、技术 / 上线方案 | 宿主 → 流程 skill → workflow/scripts → workflow/lib；按需调用能力型 skills 或 DocNexus | 正式需求产物与 meta.json；按执行协议记录 runs |
| 读取 Nacos 参数 | 宿主 → nacos-config → config.mjs → 所选 Nacos 配置接口 | 默认仅返回脱敏快照，不绑定需求、不创建运行、不落盘原文 |

dev / project-review 可在已有流程中按需调用 nacos-config，读取结果作为配置证据；独立查询不自动启动完整工作流。能力型 skill 的 SQL、HTTP、CodeGraph 执行逻辑不因共享核心存在而搬进 lib。

dev / project-review 的 SKILL.md 只保留触发边界、门禁、步骤路由、必要命令和结果去向。方法细节按阶段保存在各自 references 中，进入阶段前只读对应小节，避免开工加载全部方法。F1～F8、B1～B5 与审查第 1～9 步编号不变；报告选择、快速通道、完成标记等关键约束在入口可见，具体执行仍由阶段说明和共享状态协议约束。

dev 的入口要求显式流程授权：实际调用 `/dev` / `$dev`、点选 skill 或明确要求 dev / 完整开发工作流。普通分析、修改、修复、测试和 Git 操作不会经 workflow 自动转进 dev；旧运行与绑定也不构成启动授权。Codex 的 `dev/agents/openai.yaml` 关闭隐式调用，skill 本文在任何开工命令前检查入口；安装器把同一边界写进所选环境的项目说明。已授权同任务按阶段续接，当前独立分析 / 提交请求不重启或自行推进阶段。

## 共享核心

| 模块 | 职责 |
|---|---|
| capabilities | 必装 DocNexus 门槛、wiki / CodeGraph / 数据库的统一接入探测与通道选择 |
| project | 布局、路径、项目画像、本机环境与配置 |
| requirement-read | 需求目录和元信息读取、查询与分组 |
| requirements | 需求绑定、产物版本、归档、索引写入 |
| runs | 运行阶段、用户选择、revision、完成与取消 |
| run-gates | 方案确认、实现／验证／审查／交付转换门禁，核对证据与版本 |
| code-snapshot | 基线、HEAD 与工作区文件内容摘要，校验验证／审查仍适用 |
| artifact-finalize | 草稿检查、正式发布、归档、索引与运行证据登记；在 meta 中记录可恢复收尾 |
| path-match | 审查范围与代码快照复用的纯 glob 匹配 |
| meta-store | 元信息写锁与原子替换；写入前自动创建父目录，再按真实路径归一化加锁；读取不创建目录 |
| document-model | 标题、章节、表格、元信息等纯文本解析 |
| artifact-model | 产物种类、文件名、分支、日期、发布与沉淀、审查和交付解析 |
| workspace-read | 工作区／Git 数据采集，统一内存快照与诊断 |

lib 不依赖 scripts；纯模型不依赖 I/O。读侧不调用 sync 或推进运行，写侧在原有锁内重读元信息。布局配置不依赖需求或运行，避免形成循环依赖。`updateMeta` 负责创建写入所需的父目录，调用方负责需求绑定与流程前置校验；存储层建目录不代表需求已绑定。

## 数据归属

- `meta.json`：需求名称、绑定分支、项目、已登记版本、runs 和扩展字段。
- Markdown：正文、文档头、wiki 发布记录、DocNexus 沉淀引用。
- `artifacts`、`latest`：由显式 sync 重建的索引，不能覆盖 runs；文档头不隐式改变需求绑定。
- 文件存在不代表运行已完成。只读查询不会创建需求目录或状态文件。

`loadWorkspace` 返回 requirements、artifacts、runs、diagnostics、layout 和 scanned_branches。产物条目包含来源、需求／项目、分支、类型、版本、日期、正文及解析结果。相同来源和查询范围内，按日期、版本、修改时间排序。当前项目、全部项目和 Git 分支是显式读取范围：view 使用全部项目，分支查询与效果报告默认当前项目；所有入口都忽略 other、tmp、DocNexus 知识目录。

一次命令内只采集一份快照并传给各查询，正文不再次读取。快照是已读数据的内存表示，不是跨全部文件的事务锁；并发改动在下次采集时可见。不会新增持久索引或缓存文件。运行写入仍用 revision 与元信息锁。

`--all-branches` 继续按路径去重、工作区优先；分支中才有的文件从 Git 补入，版本取同一 Git 引用的 meta.json，不混用工作区版本。未迁移旧目录的 Git 产物仍可读取，版本缺失时按原文件名规则回退。

损坏元信息、无效运行、索引不一致和引用文件缺失进入 diagnostics，状态／报告／视图显示诊断。可读正文保留展示，损坏运行不提供恢复；读取不会将坏元信息重建为空记录。`list` 也只读取；用户修复数据或显式 sync 后重新加载即可。

## 能力边界

`lib/capabilities.mjs` 集中探测接入，`resolve.mjs status` 输出本轮能力快照（ready / blockers、通道、模板解析结果），`references/capabilities.md` 定义依赖 workflow 的 Skill 共用的失败处理。CodeGraph 的库探测通过其 status 命令交给能力适配器，lib 不导入 Skill 执行脚本。新会话或环境变化时刷新，不持久化个人能力状态到需求元信息。

DocNexus 是必装组件：安装器缺失即接入，安装失败不报告完成；已有组件默认复用，`--with-docnexus` 强制更新。模板只从知识库读取，包内模板仅用于导入。知识查询失败不作为空结果继续。CodeGraph、wiki、数据库仍按共享规则选择增强通道；必需目标、需求绑定和语句拦截按各自语义处理。

nacos-config 独立按需读取，不属于 capabilities.mjs 集中探测的通道。`inspect` 仅列本地 application / bootstrap 候选与命名连接；`get` 才验证远端网络、鉴权和指定配置。项目画像 `config_center: nacos` 只说明项目使用的配置中心，不代表已有 Nacos 连接、鉴权通过或运行时配置已核实。

`config.mjs` 处理 YAML / properties、本地属性与环境变量占位符、显式 profile、指定文件的覆盖顺序和脱敏输出；YAML 解析依赖装在 nacos-config 目录。连接可来自所选文件，或本机 `config.json` 中的命名连接，两者互斥。配置请求仅 GET，POST 仅用于登录；token 不落盘。输出标明 Namespace、Group、Data ID、时间和内容摘要，不模拟完整 Spring 配置合并、灰度或刷新，也不自动生成数据库连接。协议和字段见 `<skills>/nacos-config/references/connection.md`（该 skill 未安装时不可用）。

## 运行环境与数据位置

| 位置 | 保存内容 |
|---|---|
| 代理技能目录 | SKILL.md、references、执行脚本和安装清单；连接配置按规则忽略 |
| workflow/profile.json / profile.local.json | 团队项目事实 / 本机环境与覆盖项，均不放凭据；后者不提交 |
| .docnexus/ | DocNexus 项目配置、npm 清单、依赖、skills、草稿与索引；内部文件按其 gitignore 管理 |
| .codegraph/ | 本机代码图谱索引，不提交 |
| workflow-run/docs/requirements/&lt;需求&gt;/&lt;项目&gt;/ | 正式 Markdown 与需求 meta.json（绑定、产物索引、runs、可恢复收尾待办） |
| workflow-run/docnexus/ | 团队知识与生效模板；技术 / 上线方案模板首次按用户样例创建 |
| workflow-run/feedback/、other/、tmp/ | 运行反馈、普通聊天辅助文件、忽略提交的临时文件与锁 |

view / report 读取需求工作区快照展示，不触发运行转换或远程配置拉取。DocNexus 的 view 是单独的本地知识浏览服务。远端数据库 / wiki / Nacos 始终是外部数据源，本地产物仅保留任务所需、允许展示的证据。

## 执行可靠性

完整流程在首次落盘前创建运行；需要产品核对时，在 F2 / B3 先发布偏业务场景的 clarification.md，逐轮归档、等待反馈。feature 业务明确并完成现状调研后进入 F3 技术澄清，最终在 F3 / B3 收尾 requirement.md，记录目标、范围、AC、有效决定与技术约束。清单发布不能代替阶段完成；无业务待确认项时可省清单。plan.md 保存实现设计并绑定需求 hash / 版本，需求变化使旧方案与下游证据失效；只调整设计不修改需求文档。view / report / PR 引用分别展示清单与需求文档。

关键转换由 run-gates 执行，不仅在 complete 检查。方案批准关联具体正文；验证在执行前 snapshot、执行后登记；review-handoff 从已保存事实和代码范围生成交接材料，不传实现者结论。审查结果同时返回报告草稿与结构化 findings／coverage，主 agent 统一收尾，交付选择绑定该轮代码与报告版本。

artifact.mjs 在命令层解析知识模板并传入精确草稿检查；artifact-finalize 不导入命令入口。两次带锁写入先登记 pending_finalization，再发布文档并提交索引与运行；meta 中的待办是恢复依据，不另建状态数据库。中断后拒绝其他元信息写入，resume 重查证据并幂等完成，abort 安全还原原文件。只读命令展示待办，不自动修复。快照与阶段协议见 execution.md。
