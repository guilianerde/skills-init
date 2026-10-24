# 内部模块边界与统一读取模型

安装接入在 `bin/`；各 Skill 的 SKILL.md 与 references 定义流程步骤、确认点和调用时机；`workflow/lib/` 承担共享规则与数据读写；`workflow/scripts/` 保留既有命令和导出入口。数据库、代码图谱、wiki 的执行与凭据仍在各自能力目录。`shared/` 只分发参考文档，运行共享代码随 workflow 的 lib 一起安装。


dev / project-review 的 SKILL.md 只保留触发边界、门禁、步骤路由、必要命令和结果去向。方法细节按阶段保存在各自 references 中，进入阶段前只读对应小节，避免开工加载全部方法。F1～F8、B1～B5 与审查第 1～9 步编号不变；报告选择、快速通道、完成标记等关键约束在入口可见，具体执行仍由阶段说明和共享状态协议约束。

## 共享核心

| 模块 | 职责 |
|---|---|
| capabilities | 必装 DocNexus 门槛、wiki / CodeGraph / 数据库的统一接入探测与通道选择 |
| project | 布局、路径、项目画像、本机环境与配置 |
| requirement-read | 需求目录和元信息读取、查询与分组 |
| requirements | 需求绑定、产物版本、归档、索引写入 |
| runs | 运行阶段、用户选择、revision、完成与取消 |
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

`lib/capabilities.mjs` 集中探测接入，`resolve.mjs status` 输出本轮能力快照（ready / blockers、通道、模板解析结果），`references/capabilities.md` 定义所有 Skill 共用的失败处理。CodeGraph 的库探测通过其 status 命令交给能力适配器，lib 不导入 Skill 执行脚本。新会话或环境变化时刷新，不持久化个人能力状态到需求元信息。

DocNexus 是必装组件：安装器缺失即接入，安装失败不报告完成；已有组件默认复用，`--with-docnexus` 强制更新。模板只从知识库读取，包内模板仅用于导入。知识查询失败不作为空结果继续。CodeGraph、wiki、数据库仍按共享规则选择增强通道；必需目标、需求绑定和语句拦截按各自语义处理。
