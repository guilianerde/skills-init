# 第一阶段：Skills 与内部程序入口共用核心

状态：已实现。真实目标 Claude 模型的 trigger eval 已按 [Issue #8](https://github.com/guilianerde/skills-init/issues/8) 标记为 `deferred` 后续处理。日期：2026-11-16。实现结果见[第一阶段实施报告](workflow-core-phase-one-report.md)。

修订：2026-11-17，根据设计质检补齐项目配置隔离、pending 操作身份、finalize 成功重放和非 run 写操作契约；对应验收项已同步更新。

同日决策：按 [Issue #3](https://github.com/guilianerde/skills-init/issues/3) 和用户确认，删除旧直写流程，不再将 nextPath / sync 作为兼容接口纳入核心。以下 4.5 节为最终决策。

[整体目标方案](workflow-control-roadmap.md) · [当前架构](development.md) · [当前执行约定](../workflow/references/execution.md)

## 1. 目标与范围

以当前仓库为主干，完成公共核心抽取，使现有 Skills 脚本和一个内部 Node.js 入口调用同一套领域实现。第一阶段必须跑通完整流程，不能只添加一个导出文件后宣告完成。

旧流程已无用户，不承担其兼容义务。阶段一主动删除旧直写流程、旧命令、旧导出、迁移分支及仅服务这些路径的文档和测试，不提供转发壳、双写或弃用过渡。Skills 作为新核心的接入方式保留，旧流程元素不因曾被 Skills 调用而成为保留条件。新流程仍需要的锁、快照、证据和收尾恢复逻辑可以复用，不为了重构而全部重写。

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

`root` 必须是明确的绝对项目路径。项目配置从目标 root 下的项目配置位置解析，不得优先读取或自动回退到核心模块所在项目的 profile。入口可以先将命令行路径转成绝对路径；核心实例不能依赖后续的 process.cwd() 变化。

配置解析采用同一规则：`workflow-run/profile-source.json` 的显式选择优先；没有显式选择时，优先使用目标项目规范安装位置 `.agents/skills/workflow/`；只有规范位置不存在时，才检查目标项目其他已支持的安装位置。多个候选若指向同一真实目录，或不同拷贝中的 `profile.json` / `profile.local.json` 内容完全相同，视作同一配置；若是不同配置且无法唯一选择，明确报告歧义，不任取一个。`requirement.mjs config --profile-source` 只能选择目标 root 内受支持的安装目录，`auto` 清除显式选择。无配置时按现有各操作的缺省值或必填条件处理，不读取别的项目配置，也不在查询中创建配置。保留团队 profile 与本机覆盖项各自现有的合并语义。

画像、工具链和文档 policy 的项目资源都绑定目标 root；包内 skill.json 等静态规则可以随代码分发，但不能因此从包所在项目读取业务配置。第一阶段只增加受支持安装目录内的显式来源选择，不接受任意配置文件位置。源码入口、打包入口与安装后脚本针对同一 root 必须解析出同一配置来源。

内部接口是受信任程序入口，不是安全边界；调用者能直接访问本机数据这一事实不因接口命名改变。它不认证批准人，也不禁止模型通过其他途径改文件。

### 4.1 操作表

下列名称作为阶段一目标契约，实施时若调整须同步文档、Skills 和测试。

| 分组 | 方法 | 语义 |
| --- | --- | --- |
| requirements | `bind`、`which` | 绑定及查询需求，保留现有目录与项目语义 |
| maintenance | `reindex` | 显式刷新派生索引；不写正式正文、不归档、不提升版本、不推进运行或生成证据 |
| runs | `start`、`status`、`get` | 创建和查询；多 run 时由明确 id 选择 |
| runs | `save`、`complete`、`cancel` | 统一状态变更与完成门禁 |
| snapshots | `capture` | 获取某运行对应的代码快照 |
| artifacts | `finalize`、`resume`、`abort` | 校验、发布、索引和中断处理 |
| reviews | `prepare` | 生成代码 / 文档审查交接材料 |

批准、验证记录和交付决定在阶段一通过现有 checkpoint / finalize 语义进入核心；不新增一套 Human API，也不声称这些声明已经过身份或执行认证。后续正式协议阶段再拆分操作面。

### 4.2 参数与结果

- `root` 明确业务项目根，`branch` 明确操作分支；入口可通过只读 Git 查询帮助解析，写入仍检查真实分支条件。
- 已有运行的写操作显式携带 `id` 和 `expectedRevision`；新建运行、需求绑定与索引维护按 4.5 节各自条件处理，不强套 run revision。不要在 API 内重新读取最新 revision 后静默绕过冲突。
- revision 检查由具体领域操作在锁内执行，不在入口统一提前拒绝；finalize 的成功重放例外见 4.4 节。普通更新或不同 finalize 请求仍必须拒绝旧 revision。
- 状态查询返回 run、revision、证据有效性和结构化待办 / 阻塞；存在 pending_finalization 时明确返回其 `operationId`、所属 run、基准 revision 和产物种类。人类提示、脚本命令及中文文案由入口层生成。
- 方法返回普通可序列化对象。领域失败抛出含 `code`、`message`、必要 `details` 的统一错误；先覆盖实际需要的错误，不建立庞大分类框架。
- 至少区分输入错误、run 不存在、revision 冲突、pending 操作不匹配、阶段不允许、门禁失败、证据失效、待恢复收尾和存储错误。保留底层原因，不把未知 I/O 错误伪装成门禁拒绝。
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

### 4.4 收尾重试与 pending 操作身份

保留当前 finalize 对相同请求的成功重放支持。请求标识由运行、原始 expectedRevision、产物种类、实际发布正文摘要、checkpoint 及审查输入 / 结果等影响操作的字段确定；两个入口必须使用相同的标准化规则，不能各算一份请求标识。

- 在锁内先识别该请求是否已有成功结果。只有记录确实匹配、当前正式产物仍匹配成功记录且没有冲突 pending 时，返回 `alreadyFinalized`；不重复校验发布、不追加历史、不增加 revision 或重复归档。此返回只证明原操作已经完成，不重新赋予当前代码有效的交付证据。
- 没有匹配成功记录时执行正常 revision 与门禁检查；不同内容或不同操作不能借成功重放绕过旧 revision 检查。成功记录不匹配或产物后来改变时明确返回冲突，不自动刷新 revision 再写入。
- 同请求对应的 pending 可继续处理既有操作，不能新建一笔。阶段一只保留现有收尾重放能力，不建设持久化的通用幂等请求服务，也不承诺无限期保存历史响应。
- 每次新建 pending 都生成唯一 `operationId`。`resume/abort` 必须显式提供 `{ branch, id, expectedRevision, operationId }`，在同一需求锁内核对运行、当前 revision、pending 基准 revision 及操作 ID，然后才处理文件。
- `runs.status()` 对 pending 返回顶层 `runRevision`，并返回 `pending.operationId`、`pending.runId`、`pending.kind`、`pending.baseRevision` 和 `pending.runRevision`。参数 `expectedRevision` 固定等于 `runRevision` / `pending.runRevision`；pending 的 `baseRevision` 只用于内核核对它仍等于已保存运行的 revision，不作为调用方传入值。
- pending 存在时，`current` 保留 meta 中已提交的运行快照，可能仍是 `baseRevision`；调用方必须读取顶层 `runRevision` 发起 resume/abort。resume 成功后提交 pending 预先计算的目标 revision；abort 不提交该目标运行，保留已保存的 base revision。
- 示例：`status` 返回 `runRevision: 9`、`pending.baseRevision: 8` 时，调用 `resume({ id, expectedRevision: 9, operationId })`。传 8 返回 `REVISION_CONFLICT`；operationId 不存在或已替换返回 `PENDING_OPERATION_MISMATCH`。
- 若 pending 已消失或被另一笔替换，返回明确错误，不自动选择“当前那笔”。无论 abort 是否改变 run revision，都不能重复使用已取消操作的 ID。失败返回可包含当前状态，调用方核实后另发请求，不能自动改绑新 operationId。
- 恢复继续执行已有的正文 hash、文件冲突和领域门禁检查；操作 ID 匹配不能代替证据校验。

这解决两类不同问题：成功响应丢失后安全重试，以及旧恢复 / 中止请求不能误处理后来创建的操作。

### 4.5 删除旧直写链，限定索引维护

删除公开 `requirement.mjs path`、`nextPath()`、旧 `sync` 命令及其版本 bump 语义。所有受控的正式产物创建、正文替换、版本提升和归档统一进入 `artifacts.finalize`；`resume/abort` 只处理其产生的待完成事务，不构成另一条发布路径。不保留“非 run 文档可以直接覆盖后 sync”的例外，需要正式发布时创建相应类型的运行。

从 sync 提取必要的纯索引计算逻辑供核心内部复用；提供明确的 `maintenance.reindex` 与对应 `requirement.mjs reindex [--all]` 维护命令。它只刷新 `artifacts/latest` 等派生展示索引及必要的索引更新时间：已有权威版本不能提升，无法确认版本的文件报告为未登记，不默认补成有效版本。不得修改正文、归档、绑定、runs、run revision、批准及证据，也不能接受 bump 参数。

`reindex` 的最终字段白名单固定为 `artifacts`、`latest`、`indexed_at`。其中 `indexed_at` 只在 `artifacts` 或 `latest` 实际变化、或旧数据还没有该字段时更新；`updated` 表示正文更新时间，不能被 reindex 覆盖。无法确认权威版本的固定文件名在 `artifacts` 中持久标记 `version: null, registered: false`，仍可见但不算有效版本；同一项以 `unregistered` 返回。成功结果包含 `ok`、`dir`、`changed`、兼容字段 `artifacts`（数量）、`artifact_count`、`latest`、`versions`、`unregistered`；`--all` 返回逐需求 `results`，受阻项保留 `error` / `code`，其他需求继续处理。损坏 JSON、pending 冲突和缺失需求直接失败，不写入派生索引。

`which` 改为只读查询，不再隐式调用写入型 sync；需要最新文件信息时计算只读视图。bind 的写入、finalize 的索引登记以及 Wiki / DocNexus 发布元信息变更后的索引刷新，都改用明确的内部索引能力或维护入口。发布元信息工具保留自身用途，但不能借刷新索引修补正文 hash、提升版本或重新生成收尾凭据；不一致仍按门禁失效规则处理。

需求级操作可能发生在 run 创建前，按需求目录元信息锁保护，不虚构 run ID 或 revision。

| 写入类别 | 接口 | 条件与保护 |
| --- | --- | --- |
| 已有 run 更新 | runs.save / complete / cancel、artifacts.finalize | run ID 与 expectedRevision；统一需求锁；finalize 按 4.4 的重放例外处理 |
| pending 恢复 / 中止 | artifacts.resume / abort | run ID、expectedRevision 和 operationId 全部匹配，锁内检查 |
| 创建运行 | runs.start | 校验需求、分支及现有活动运行，在锁内创建或按现有规则返回运行，不覆盖旧状态 |
| 需求绑定 | requirements.bind | 允许尚无 run；锁内读取当前需求元信息后合并绑定，拒绝非法目标及 pending 冲突，不用调用方旧快照覆盖其他字段 |
| 索引维护 | maintenance.reindex | 锁内读取当前状态和产物，拒绝 pending 冲突，只刷新明确允许的派生索引字段；其余元信息保持不变 |

reindex 后若正文与运行收尾凭据不符，状态 / 门禁检查仍应识别为失效。维护调用遇到 pending 必须拒绝；`--all` 逐需求加锁，报告成功和受阻项，不声称跨目录原子性。finalize / resume 在已有锁和事务内调用纯索引计算函数，不递归调用公共 reindex，也不通过维护入口绕过 pending 保护。

阶段一不新增需求级 revision 协议。上述操作必须锁内读取最新值并限定变更字段；锁保护受控调用之间的竞争，不承诺阻止外部编辑器直接改正文。`list`、`pending` 保留为 Skills 外围只读查询，`config` 保留为 Skills 外围配置入口；三者不进入核心生命周期，也不得写 run、产物索引或证据。`workflow/scripts/requirement.mjs` 不再转导出 `bind / which / reindex / reindexRequirement`。

删除清单必须覆盖实现、CLI 分支、导出、Skills 指引、模板、安装器引用与仅用于旧行为的测试。替换消费者后删除失去用途的 helper；保留新流程仍需要的归档能力。程序不自动删除业务工作区 `workflow-run/tmp/old-artifacts/` 中的历史文件；删除旧代码与清空历史数据是两件事。

### 4.6 发布与兼容决定

维护者和用户已确认旧流程没有使用者，允许在阶段一移除 `path / nextPath / sync bump`、旧导出、迁移和兼容壳，不做双写、弃用期或自动迁移。包含本阶段的下一版本按项目当前的 pre-1.0 规则发布为 `0.36.0`，发布说明必须显式列出破坏性命令变化；本阶段内部 Node API 只供同包调用，不承诺成为第二阶段的外部稳定协议。

已有 `workflow-run/docs/requirements/`、历史归档和正文不会被自动删除或改写。旧运行仍按当前门禁读取；因命令或格式不再支持而无法继续的数据明确拒绝并提示人工处理，不能写成虚假的恢复成功。真正发版、更新 package 版本和发布 npm 包仍需单独执行发布流程，本次文档和执行只记录决策，不把本分支自动视为已发布。

## 5. 数据和功能处理原则

- 继续以 meta.json 和 Markdown 为事实来源，避免另建核心专用数据库或第二份状态。
- 保留需求、方案、审查和交付版本之间的关联，不能因为 API 更简洁而移除有效性检查。
- 不把“验证步骤完成”改成“所有测试通过”。现有 passed / failed / unverified 与严重风险接受规则单独测试，不在重构中暗改产品政策。
- 快速通道、feature / bug、独立 review、tech / release / wiki 的现有差异保留；需要改变业务语义时单独列出决定，不与模块搬迁混合。
- 旧流程迁移、兼容转发及废弃写入分支纳入显式删除清单，调用方一次性改用新路径；不保留过渡期。与本次流程重构无关的功能不顺带删除。
- 若格式发生不兼容变化，明确格式标识和拒绝行为；不给旧数据写默认值以制造“恢复成功”。不自动清空旧目录。
- 修复过程中确需吸收 project-agent 的核心改动时，记录问题和测试依据；Pi 会话与执行器仍留在阶段一范围外。

## 6. 工作包与提交顺序

建议开发分支：`codex/extract-workflow-core`。文档可以先进入主干，实现从当时主干创建分支。

| 工作包 | 实施内容 | 输出与退出检查 |
| --- | --- | --- |
| A：基线与依赖 | 记录 commit；跑现有测试；盘点脚本、核心、安装器及跨 Skill 引用；核对参考项目差异 | 新流程能力清单、旧流程删除与消费者替换清单、基线结果、需吸收的修复列表 |
| B：核心边界 | 移动 / 拆分必要模块；集中领域和存储依赖；提取脚本中的 handoff 业务逻辑 | 核心不反向依赖脚本；相关领域测试通过 |
| C：内部入口 | 实现 createWorkflow、按 root 配置解析、完整操作表、revision / operationId、收尾重放、错误与结构化状态；装配文档 policy | 无 CLI 进程也能运行完整流程；跨项目配置隔离；缺少 policy 明确失败 |
| D：Skills 接入与旧链删除 | 调整 run / artifact / requirement / review-handoff 及消费者；删除 path / nextPath / sync bump、兼容迁移和旧说明；接入受限 reindex | 正式正文只经 finalize 发布；旧调用和导出清零；新流程 Skills 能力可用 |
| E：安装与集成 | 更新安装复制与包清单；添加内部示例；验证装包后运行、双入口接续、配置来源及非 run 维护 | 实际安装目录无缺文件或开发目录依赖；同一 run 可交替推进；配置来源一致 |
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
6. 模拟 finalize 成功但响应丢失，从另一入口用同一原请求重试，返回已完成结果，revision、历史、版本及归档不重复变化。
7. 在独立用例中插入失效条件，检查两个入口的领域错误 code 一致。

集成测试里的模拟验证和审查结果是 fixture，用于检查流程，不宣称代表真实测试执行或独立模型审查。该测试证明入口互操作，不等于真实宿主间交接已完成。

### 7.2 必须覆盖的失败与恢复场景

| 场景 | 预期 |
| --- | --- |
| 两调用方持有同一 revision，先后进行不同更新 | 第一次成功，第二次冲突；不得丢失第一次结果 |
| 同一进程为两个 root 创建实例，项目配置刻意不同 | 基线、审查排除项、产物项目名和配置写入位置各自隔离；不回退到模块所在项目 |
| 源码入口、打包入口及安装脚本操作同一 root | 配置来源与解析值一致；目标项目无配置或存在歧义时按契约处理 |
| finalize 成功响应丢失，原请求携带旧 revision 重放 | 匹配记录时返回 alreadyFinalized，不重复状态变更；改变正文 / 输入后的旧请求仍冲突 |
| pending A 被中止后，以相同 run revision 创建 B，再收到 A 的恢复 / 中止请求 | operationId 不匹配，拒绝旧请求；B 的文件、pending 和 run 保持不变 |
| run 尚未创建时执行 bind / reindex | 不要求 run ID；按需求级锁及条件处理，不隐式创建 run 或有效产物凭据 |
| reindex 重复调用、与状态保存交错 | 派生索引稳定；versions、runs、revision、证据与正文不被改写，不丢失进度 |
| 有 pending 时执行 bind / reindex | 拒绝冲突写入，要求先处理指定 pending 操作；批量维护如实报告受阻项 |
| 修改正式正文或放入未登记文件后执行 reindex | 不提升版本、不创建有效凭据；既有凭据失效仍被检测，新文件显示未登记 |
| 调用旧 path / sync 命令或旧 nextPath 导出 | 入口已不存在，不能通过别名 / 转发继续旧流程；未写文件 |
| 检查生产调用链与 Skills 指引 | 没有旧 path / nextPath / sync bump 调用，所有正式正文发布汇入 finalize |
| which / 状态查询及发布元信息刷新 | 查询只读；元信息刷新使用限定索引逻辑，不补造正文收尾凭据 |
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

优先复用 `test-run.mjs`、`test-flow-gates.mjs`、`test-requirement-document.mjs`、`test-clarification-artifact.mjs`、`test-tech-document.mjs` 和 `tests/helpers/run-flow.mjs` 中新流程仍需要的场景。删除仅断言旧直写或兼容行为的测试，改以“旧入口不存在、正式发布经过 finalize、reindex 不改变权威状态”的架构与行为测试覆盖；不能为通过重构而删除仍有效的门禁断言。

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

- [x] 新流程 Skills 能力、核心依赖、旧流程删除清单与消费者替换有记录。
- [x] 内部程序入口完整覆盖范围内操作，不依赖 Agent 会话或 CLI 子进程。
- [x] Skills 的生命周期脚本与内部程序复用同一规则和存储，并通过真实模板策略与安装包测试验证。
- [x] 无复制的 run-gates、快照规则和产物版本逻辑。
- [x] 双入口同一 run 的集成场景及失败路径通过。
- [x] 两个 root 的配置隔离、多环境 profile 内容等价/显式选择，以及不同入口对同一 root 的配置一致性通过。
- [x] pending 的 operationId 防误操作与 finalize 成功重放分别验证通过。
- [x] path / nextPath / sync bump、旧流程兼容迁移及其生产调用已删除，正式正文发布统一走 finalize。
- [x] bind 与受限 reindex 的写入归属、锁及证据失效测试通过，which 为只读查询。
- [x] 安装后的 Skills、包内容和流程测试通过。
- [ ] `eval:triggers` 在真实 Anthropic Claude 环境的 46 条验收已作为 `deferred` 后续事项保留（#8）；当前网关模型结果不能冒充目标模型。评估器已完成严格模型身份校验，恢复处理条件已写入 Issue。
- [x] 数据格式变化及拒绝行为明确；没有旧数据迁移和隐式清理。
- [x] 文档更新区分已实现能力与后续目标，没有强制管控或实测证据的虚假承诺。
- [x] 实施报告列出变更、验证结果、限制和第二阶段接入点。

第一阶段交付物是可用的新架构、内部调用示例、测试和文档。第二阶段从该接口发展 CLI JSON、验证执行器和 MCP；不在本阶段顺手接入 Pi 或启动真实业务流程。
