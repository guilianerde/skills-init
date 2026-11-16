# 第一阶段：Skills 与内部程序入口共用核心

状态：待实施。日期：2026-11-16。本文为开发方案，本次文档提交不包含实现。

[整体目标方案](workflow-control-roadmap.md) · [当前架构](development.md) · [当前执行约定](../workflow/references/execution.md)

## 1. 目标与范围

以当前仓库为主干，完成公共核心抽取，使现有 Skills 脚本和一个内部 Node.js 入口调用同一套领域实现。第一阶段必须跑通完整流程，不能只添加一个导出文件后宣告完成。

不承担旧用户兼容：可以修改路径、脚本参数和数据结构，不提供旧数据迁移、旧路径转发、双写或弃用过渡。保留的是新版本 Skills 的功能范围，不是旧版本调用细节。默认沿用合理的现有数据格式，只有结构调整确有需要才改变；“允许破坏兼容”不是重设计全部数据的理由。

### 范围内

- 运行与需求绑定、阶段和 revision、门禁、代码快照、证据登记与关联。
- 产物版本、文档审查规则、正式收尾及 pending_finalization 恢复 / 中止。
- 文件系统存储、锁和原子替换的现有能力。
- Skills 脚本调用调整、模板校验接线、安装打包、相关文档和测试。
- 内部入口示例，以及它与 Skills 入口共享同一运行的集成验证。

### 范围外

- 新的公共 CLI 命令产品、MCP Server、外部 SDK 和完整 JSON Schema 协议。
- Pi / Codex / Claude / OpenHands 专用 Adapter 或会话管理。
- 真实验证执行器、证据分级升级、独立审查进程、人类身份认证及写入强制拦截。
- 跨 Agent 完整运行交接包、SQLite、Web UI、远程服务、多用户权限。
- 导入整个 project-agent、重写数据库 / Wiki / Nacos 等能力型 Skills。

现有审查 handoff 必须继续可用，但不将其包装为完整的跨 Agent 恢复能力。现有 CLI 脚本继续作为 Skills 的运行入口，范围外的是新建正式外部协议。

## 2. 当前基础与需要解决的耦合

基准为当前主干代码；实施开始时记录确切 commit 和工作区状态。

| 当前位置 | 现有职责 | 阶段一处理 |
| --- | --- | --- |
| `workflow/lib/runs.mjs` | 运行、阶段、checkpoint、完成校验、状态展示 | 规则和状态服务纳入核心；脚本命令提示移到入口层 |
| `workflow/lib/run-gates.mjs` | 需求 / 方案 / 验证 / 审查 / 交付关联 | 保持唯一实现，不在入口重复判断 |
| `workflow/lib/code-snapshot.mjs` | Git 与工作区快照 | 纳入核心依赖，保留快照范围语义并测试 |
| `workflow/lib/artifact-finalize.mjs` | 发布、版本、待完成事务及恢复 | 保留恢复能力；分离 Skills 模板选择与领域规则 |
| `workflow/lib/meta-store.mjs` | 锁、读取和元信息更新 | 作为文件系统实现，不新增无用途的通用 Store 层 |
| `workflow/lib/requirements.mjs` / `requirement-read.mjs` | 绑定、索引、目录读取 | 纳入运行生命周期需要的依赖闭包；梳理历史迁移分支 |
| `workflow/lib/project.mjs` / `workspace-read.mjs` | 布局、画像和工作区读取 | 分清核心必要配置与宿主 / 展示逻辑，避免整文件机械搬迁 |
| `workflow/scripts/run.mjs` | 参数解析、状态和快照调用、JSON 输出 | 改成内部入口的薄调用方 |
| `workflow/scripts/artifact.mjs` | 模板解析、lint、正式产物操作 | 保留 I/O 参数处理，将校验能力按明确契约接入核心 |
| `workflow/scripts/review-handoff.mjs` | 生成审查 packet、输入与结果结构 | 可复用的组装逻辑移出脚本，命令保留参数和输出 |

现有 `workflow/lib` 已不反向依赖 scripts，但业务能力仍有分散在脚本中的部分，也没有统一受支持的程序入口。重构要解决真实依赖，不只改目录名。

## 3. 目录与依赖规则

建议初始落点保持在 workflow 安装单元内，避免引入新的包和跨安装目录依赖：

```text
workflow/
  core/
    index.mjs                内部入口与实例装配
    runs.mjs                 运行操作
    run-gates.mjs            门禁规则
    code-snapshot.mjs        快照
    artifact-finalize.mjs    产物收尾与恢复
    document-review.mjs      文档审查证据
    review-handoff.mjs       审查交接组装
    ...                      实际需要的模型、布局和存储依赖
  integrations/
    skill-document-policy.mjs  Skills 模板解析与校验装配
  scripts/                   参数解析、文件输入、展示及调用
  lib/                       仍被其他功能使用、未纳入核心的工具
examples/
  workflow-core.mjs          内部调用示例
tests/
  ...                        原有测试与新增边界 / 集成测试
```

先用少量模块，不为每个概念预建子目录。最终文件列表在依赖盘点后确定，但以下边界必须满足：

1. Skills 脚本和内部示例通过 `core/index.mjs` 调用运行生命周期能力，不深层导入私有实现。
2. 核心不导入 scripts、SKILL 文本、Pi、MCP 或 Agent 会话。
3. 核心可以使用 Node.js 文件和 Git 能力；阶段一不追求所有模块纯函数化。
4. 共享纯模型只能有一份；核心不得依赖含模板解析或展示逻辑的外围模块。必要时拆出最小共用模块。
5. 状态写入继续通过统一元信息写入机制。入口不得自行修改 meta.json 或重复执行门禁判断。
6. 技术 / 上线方案、独立审查和 Wiki 相关运行的现有规则不能在抽取时遗漏；能力型 Skills 本身不整包进入核心。

## 4. 内部接口设计

提供 `createWorkflow({ root, documentPolicy })`，返回作用于明确项目根目录的对象。无全局单例，不依赖调用者当前目录，也不在 import 或构造时写文件、启动子进程或创建 run。

内部接口是受信任程序入口，不是安全边界；调用者能直接访问本机数据这一事实不因接口命名改变。它不认证批准人，也不禁止模型通过其他途径改文件。

### 4.1 操作表

下列名称作为阶段一目标契约，实施时若调整须同步文档、Skills 和测试。

| 分组 | 方法 | 语义 |
| --- | --- | --- |
| requirements | `bind`、`which` | 绑定及查询需求，保留现有目录与项目语义 |
| runs | `start`、`status`、`get` | 创建和查询；多 run 时由明确 id 选择 |
| runs | `save`、`complete`、`cancel` | 统一状态变更与完成门禁 |
| snapshots | `capture` | 获取某运行对应的代码快照 |
| artifacts | `finalize`、`resume`、`abort` | 校验、发布、索引和中断处理 |
| reviews | `prepare` | 生成代码 / 文档审查交接材料 |

批准、验证记录和交付决定在阶段一通过现有 checkpoint / finalize 语义进入核心；不新增一套 Human API，也不声称这些声明已经过身份或执行认证。后续正式协议阶段再拆分操作面。

### 4.2 参数与结果

- `root` 明确业务项目根，`branch` 明确操作分支；入口可通过只读 Git 查询帮助解析，写入仍检查真实分支条件。
- 写操作显式携带 `id` 和 `expectedRevision`。新建运行除外；恢复 / 中止操作在锁内检查调用时 revision 与待完成记录。不要在 API 内重新读取最新 revision 后静默绕过冲突。
- 状态查询返回 run、revision、证据有效性和结构化待办 / 阻塞；人类提示、脚本命令及中文文案由入口层生成。
- 方法返回普通可序列化对象。领域失败抛出含 `code`、`message`、必要 `details` 的统一错误；先覆盖实际需要的错误，不建立庞大分类框架。
- 至少区分输入错误、run 不存在、revision 冲突、阶段不允许、门禁失败、证据失效、待恢复收尾和存储错误。保留底层原因，不把未知 I/O 错误伪装成门禁拒绝。
- 核心不写 stdout / stderr、不调用 process.exit；脚本负责输出和退出码。
- 阶段一沿用同步文件操作即可，不因未来远程执行而强制把所有方法改成异步。

示意调用（设计示例，不代表当前已有 API）：

```js
import { createWorkflow } from '../workflow/core/index.mjs';

const workflow = createWorkflow({ root: projectRoot });
const binding = workflow.requirements.bind({ name, branch, base });
const { run } = workflow.runs.start({
  branch, kind: 'feature', size: 'M', dir: binding.dir, input,
});
workflow.runs.save({
  branch, id: run.id, expectedRevision: run.revision,
  input: checkpoint,
});
```

`start` 不自动伪造用户调研、需求或方案已完成。示例在临时项目运行，不修改仓库真实业务状态。

### 4.3 文档校验边界

保留领域完整性校验和内容校验的区别：

- 核心始终执行产物类型、运行阶段、引用 hash、批准和审查等领域检查。
- `documentPolicy` 负责解析生效模板并校验正文，返回结构化错误 / 警告；Skills 使用真实模板来源的实现。
- 从 `resolve.mjs` / `lint-doc.mjs` 提取必要可复用函数，外围装配不得通过 import 脚本主函数来运行 CLI。
- 需要正式发布正文而未提供 policy 时，返回明确的配置错误，不默认跳过校验。
- 程序入口的完整流程测试使用与 Skills 相同的 policy。纯规则单元测试可以使用明确的测试替身，但不据此声称验证了模板集成。
- pending_finalization 保留恢复所需的已校验内容和引用；恢复时继续复核领域门禁，不在恢复路径绕过内容完整性检查。

政策注入是受信任代码扩展点，不是抵抗恶意调用者的可信证明。阶段一不把可注入策略扩展为通用插件系统。

## 5. 数据和功能处理原则

- 继续以 meta.json 和 Markdown 为事实来源，避免另建核心专用数据库或第二份状态。
- 保留需求、方案、审查和交付版本之间的关联，不能因为 API 更简洁而移除有效性检查。
- 不把“验证步骤完成”改成“所有测试通过”。现有 passed / failed / unverified 与严重风险接受规则单独测试，不在重构中暗改产品政策。
- 快速通道、feature / bug、独立 review、tech / release / wiki 的现有差异保留；需要改变业务语义时单独列出决定，不与模块搬迁混合。
- 历史迁移和兼容代码逐项识别；仅删除本次新设计明确不再支持的路径及引用，不顺带清理无关旧代码。
- 若格式发生不兼容变化，明确格式标识和拒绝行为；不给旧数据写默认值以制造“恢复成功”。不自动清空旧目录。
- 修复过程中确需吸收 project-agent 的核心改动时，记录问题和测试依据；Pi 会话与执行器仍留在阶段一范围外。

## 6. 工作包与提交顺序

建议开发分支：`codex/extract-workflow-core`。文档可以先进入主干，实现从当时主干创建分支。

| 工作包 | 实施内容 | 输出与退出检查 |
| --- | --- | --- |
| A：基线与依赖 | 记录 commit；跑现有测试；盘点脚本、核心、安装器及跨 Skill 引用；核对参考项目差异 | 功能清单、依赖清单、基线结果、需吸收的修复列表 |
| B：核心边界 | 移动 / 拆分必要模块；集中领域和存储依赖；提取脚本中的 handoff 业务逻辑 | 核心不反向依赖脚本；相关领域测试通过 |
| C：内部入口 | 实现 createWorkflow、操作表、revision 参数、错误与结构化状态；装配文档 policy | 无 CLI 进程也能运行完整流程；缺少 policy 明确失败 |
| D：Skills 接入 | 调整 run / artifact / requirement / review-handoff 及真实消费者；更新模板、引用和展示 | 所有生命周期入口走统一接口；既有 Skills 功能清单逐项核对 |
| E：安装与集成 | 更新安装复制与包清单；添加内部示例；验证装包后运行及双入口接续 | 实际安装目录无缺文件或开发目录依赖；同一 run 可交替推进 |
| F：收尾 | 全量测试、触发评估、打包测试；更新架构文档和完成状态 | 验收清单全通过，记录已知限制及后续任务 |

每个工作包保持可审查提交。先跑基线以识别已有失败；阶段一期间新增失败必须解决，不能仅以“基线也有失败”排除与本次改动相关的回归。首轮依赖盘点后再估算工期，不先承诺固定天数。

## 7. 验证设计

### 7.1 双入口集成场景

使用同一临时 Git 项目、同一分支和同一文档 policy：

1. 通过 Skills 脚本绑定需求并创建 M 规模 feature 运行。
2. 内部 API 读取同一 run，完成必要前置步骤和需求 / 方案产物操作。
3. 通过脚本记录当前方案确认并推进实现，API 观察同一 revision 和批准关联。
4. 在 fixture 中修改代码，登记如实的验证声明和结构化审查结果，完成报告。
5. 两入口交替记录交付选择与产物收尾，最终完成同一 run。
6. 在独立用例中插入失效条件，检查两个入口的领域错误 code 一致。

集成测试里的模拟验证和审查结果是 fixture，用于检查流程，不宣称代表真实测试执行或独立模型审查。该测试证明入口互操作，不等于真实宿主间交接已完成。

### 7.2 必须覆盖的失败与恢复场景

| 场景 | 预期 |
| --- | --- |
| 两调用方持有同一 revision，先后写入 | 第一次成功，第二次冲突；不得丢失第一次结果 |
| 无方案或缺少所需批准进入实现 | 拒绝，状态不被部分推进 |
| 需求 / 方案内容修改 | 旧方案关联或批准不能满足下游门禁 |
| 验证 / 审查后修改代码或基线 | 旧证据失效，不能完成交付 |
| 报告修改后使用旧交付决定 | 拒绝，要求针对当前报告重新决策 |
| 审查覆盖缺失、结果输入不匹配 | 按现有覆盖和关联规则拒绝，不补造已审项 |
| 存在严重问题但缺少逐项风险接受 | 交付门禁拒绝 |
| 无模板 policy 或内容校验失败 | 不发布正式产物，不绕过文档校验 |
| 产物写入 / meta 更新之间中断 | 可恢复或中止；不覆盖第三方改动，不重复归档 |
| 损坏状态、锁冲突、文件缺失 | 明确报错，不静默创建成功状态 |
| import / 构造 / 状态读取 | 不创建 run，不修改状态，不向控制台输出 |

### 7.3 现有测试与安装验证

优先复用 `test-run.mjs`、`test-flow-gates.mjs`、`test-requirement-document.mjs`、`test-clarification-artifact.mjs`、`test-tech-document.mjs` 和 `tests/helpers/run-flow.mjs` 的真实场景。按新接口调整测试入口，不靠删除断言让重构通过。

重点回归 `test-install.mjs`、`test-package.mjs`、`test-links.mjs`、`test-skills-meta.mjs`，以及读取工作流数据的 view / report / document-sources / artifacts 测试。新增少量有实际价值的双入口、错误契约和依赖边界测试，避免为每个转发函数编写重复单测。

收尾执行当前仓库命令：

```bash
npm test
npm run test:package
npm run eval:triggers
```

包验证必须覆盖实际 tarball 的安装结果：在临时业务仓库通过安装后的 Skills 脚本调用核心，不允许测试仅在源码树下成功。模板 / DocNexus 外部交互使用项目既有受控 fixture，明确其覆盖边界；不要为测试访问真实业务系统。

## 8. 主要风险与处理

| 风险 | 处理 |
| --- | --- |
| 移动文件后 profile / 模板相对路径失效 | 同时验证源码位置、打包位置、安装位置以及 copy / 链接模式 |
| 新门面存在，脚本仍绕过它写状态 | 全仓扫描调用与 meta 写入点，并用双入口测试验证 |
| 脚本迁入核心时带入 DocNexus / 宿主依赖 | 将模板策略置于外围，核心依赖规则纳入检查 |
| 抽取时更改业务门禁或丢失异常路径 | 用现有领域测试约束，新增行为单独提交并记录 |
| 重构膨胀为框架建设 | 保持单包、文件存储和少量模块；不提前加入外部协议或 Adapter |

## 9. 完成定义与后续交接

- [ ] 当前 Skills 功能范围、核心依赖与必要变化有记录。
- [ ] 内部程序入口完整覆盖范围内操作，不依赖 Agent 会话或 CLI 子进程。
- [ ] Skills 的生命周期脚本与内部程序复用同一规则和存储。
- [ ] 无复制的 run-gates、快照规则和产物版本逻辑。
- [ ] 双入口同一 run 的集成场景及失败路径通过。
- [ ] 安装后的 Skills、包内容、流程测试和触发评估通过。
- [ ] 数据格式变化及拒绝行为明确；没有旧数据迁移和隐式清理。
- [ ] 文档更新区分已实现能力与后续目标，没有强制管控或实测证据的虚假承诺。
- [ ] 实施报告列出变更、验证结果、限制和第二阶段接入点。

第一阶段交付物是可用的新架构、内部调用示例、测试和文档。第二阶段从该接口发展 CLI JSON、验证执行器和 MCP；不在本阶段顺手接入 Pi 或启动真实业务流程。
