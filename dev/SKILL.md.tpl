---
name: dev
description: "Implement a feature or fix a bug in this project end to end: understand the requirement, study existing code, clarify open decisions with the user in rounds, plan at the right size, implement in small verified steps, run tests, have an independent subagent review and write a report, then let the user choose fixes or delivery with config/SQL checklists. Use when the user asks to develop, implement, add, change or fix something in the codebase — including concrete refactors that touch several classes (swap a type such as Date → LocalDateTime, rename, replace an API) followed by running tests — or invokes /dev 需求 or /dev --bug 现象. Trigger phrases: 帮我开发 / 实现这个需求 / 加个接口 / 改一下这个逻辑 / 把 X 改成 Y / 重构一下 / 改完跑一下测试 / 修这个 bug / 排查并修复 / 线上报错了帮我修 / implement this feature / fix this bug. Not for pure code review (project-review), SQL lookups (database-query) or doc generation (create-tech-md-doc / create-release-md-doc)."
---

# Dev

把需求或缺陷推进到可交付。`/dev <需求 | PRD>` 为功能开发，`/dev --bug <现象>` 为缺陷修复；自然语言按同样意图路由。
进入每个阶段前，读取下面指向的 reference 对应小节；不在开工时一次加载全部方法说明。

## 门禁

- 开工先运行 `node <skills>/workflow/scripts/resolve.mjs status`；DocNexus 必装，不可用先修复。可选增强复用 `<skills>/workflow/references/capabilities.md` 的本轮快照。
- 先确定工作分支、已有改动的归属与需求名；切分支重新查询绑定，不替用户丢弃已有改动。
- 规模由 agent 判定并说明，不询问规模确认；M / L 的需求理解和方案须用户确认后再实现，权限 / 资金至少按 M。
- S 快速通道须用户明确同意，且 ≤3 文件、无配置 / SQL / 对外接口 / 表结构 / 权限 / 资金变更，且没有已确认的业务决定；具体资格见 F4。
- 快速通道仍编译、测试、当前会话审查，但不 bind、不建运行、不落需求 / 方案 / 审查 / 交付文档；超限或用户要求落盘先停，回 F3（bug 回 B3）补需求文档，再进入方案。
- 完整流程每轮审查落 `review.md`，交报告后等待明确选择修复或交付；选择交付前不创建或更新 `delivery.md`。
- 修复后必须验证、复审并再次等选择；严重遗留风险须说明并取得明确接受，不能把一般的“交付”当作接受风险。
- 交付选择不授权提交、推送、发布或知识写入；没有值得沉淀的知识不询问，有则先取得授权。

## Step 0 — 前置检查（两种模式共用）

先读 [preflight.md](references/preflight.md)：运行 `resolve.mjs profile`、`git status --short`，确定工作分支后运行 `requirement.mjs which`；确认画像、改动归属、需求名、审查方式与构建 / 相关测试基线。结果带入本次上下文，给不出需求名或说不清任务时停下。
上述 workflow 脚本缩写均用 `node <skills>/workflow/scripts/<脚本>` 在项目根执行；终端写法沿用能力快照的 env。

## 完整流程的运行状态

确定工作分支后先 `run.mjs show`；恢复时核对 context、代码与证据，不能把“继续”当作交付选择。
非快速通道在 F3 / B3 收尾、首次落盘需求文档前 bind，再 `run.mjs start --kind feature|bug --size <规模> --input <checkpoint.json>`，补记真实完成的前置步骤；首个文档为 `requirement.md`。
每步完成、等待、阻塞和结束会话前 save；修复回 F5 / B4，交付进 F8 / B5。具体协议读 `<skills>/workflow/references/runs.md` 与 [execution.md](../workflow/references/execution.md)。
交付、自检、摘要与反馈处理后，末步标 completed，再 `run.mjs complete`，保存 completed（已完成）和 completed_at；已完成运行不覆盖。

## 功能开发流程

### F1 — 理解需求

读 [planning.md 的 F1](references/planning.md)；运行 `node <skills>/workflow/scripts/knowledge.mjs dev --match <模块> --query "<需求>"`，按需拉 PRD，形成需求要点、验收标准与未定决定。

### F2 — 现状调研

读 [planning.md 的 F2](references/planning.md)；按本轮能力沿调用链读代码，涉及表时用 `tables.mjs --files <文件>` 定位；事实与证据进入方案依据。
涉及远程参数或开关且已安装 nacos-config 时，按 `<skills>/nacos-config/SKILL.md` 按需读取并标明来源；无法读取时注明「未核对远程配置」，不把代码默认值当成远程实际值。

### F3 — 需求澄清

读 [clarify.md](references/clarify.md) 与 [planning.md 的 F3](references/planning.md)；事实自己查、决定交用户。澄清后按 F4 标准判定规模与快速通道；完整流程用 `artifact.mjs finalize --kind requirement` 收尾 `requirement.md`，独立保存目标、范围、验收与决定。实现中新决定先回本步更新需求文档。

### F4 — 方案（落盘只看是否快速通道，写法按规模）

读 [planning.md 的 F4](references/planning.md)，复用 F3 已选通道；完整流程基于已收尾需求用 `artifact.mjs finalize --kind plan` 收尾 `plan.md`。方案引用需求文档及版本，只写实现设计、实施与验证计划；S / M 简版、L 完整版，M / L 确认后记录 approval，再进入实现。

### F5 — 实现

读 [implementation.md 的 F5](references/implementation.md)；完整流程先通过方案版本门禁，再小步修改、运行 `profile.build`，公共签名先看影响面；改动、配置清单与 SQL 脚本进入交付依据。

### F6 — 验证

读 [implementation.md 的 F6](references/implementation.md)；完整流程执行前用 `run.mjs snapshot --id <id>` 取快照、执行后 save validation；两种通道都执行相关测试、`profile.test` 与 lint，记录“验收项 → 测试或操作 → 结果”，已有失败与未验证项如实保留。

### F7 — 审查、报告与用户选择

先读 [delivery.md 的 F7](references/delivery.md)，完整流程用 `review-handoff.mjs --id <id>` 生成交接材料，按 project-review 第 1～7 步审查；优先独立子 agent，无则当前会话并如实署名。子 agent 返回草稿与结构化结果，主 agent 用 `artifact.mjs finalize --kind review` 收尾，交用户、等修复或交付选择；内部审查不另起运行、不单独沉淀或记反馈。快速通道只在当前会话审查。

### F8 — 交付

读 [delivery.md 的 F8](references/delivery.md)；完整流程记录绑定本轮代码和报告的交付选择后，用 `artifact.mjs finalize --kind delivery` 收尾 `delivery.md` 并汇总，快速通道仅对话交付。反馈用 `feedback.mjs add`；沉淀分类用 `resolve.mjs category dev`，详细授权、元信息与后续操作按该文执行。

## 缺陷修复流程（`--bug`）

### B1 — 收集现象

读 [bug.md 的 B1](references/bug.md)；整理现象、预期、触发条件、日志与影响范围，形成复现输入。

### B2 — 复现

读 [bug.md 的 B2](references/bug.md)；优先失败测试，否则提供可执行复现步骤；复现不了先说明尝试，不猜着改。

### B3 — 定位根因

读 [bug.md 的 B3](references/bug.md)；定位根因、形成证据并查同类风险。收尾时判定通道，完整流程先生成独立 requirement.md、完成 B3，再进入修复方案。

### B4 — 修复与验证

先读 [bug.md 的 B4](references/bug.md) 和 planning.md 的 F4；完整流程在原方案草稿追加修复方案、更新文档头，用 `artifact.mjs finalize --kind plan` 收尾；M / L 确认后记录 approval、implement 再修复，复现测试由红变绿。

### B5 — 审查与交付

读 [bug.md 的 B5](references/bug.md)，再按 F7 / F8；完整交付记录根因证据、修复方式、理由与同类风险排查，快速通道在对话中给出这些内容。

## Artifact Location

正式产物按 `<skills>/workflow/references/requirements.md` 归入 `workflow-run/docs/requirements/<需求>/<项目>/`，首次落盘前 bind；写入与归档细则见 [delivery.md 的 Artifact Location](references/delivery.md) 与 execution.md。正式产物统一 finalize，用输出的 cite 引用；中断先 resume。
普通聊天的辅助文件默认放 `workflow-run/other/`，不绑定需求、不登记运行；源码、已有文件和用户指定路径沿用原规则。

## Rules

- 不直接写库、不改凭据文件；SQL 只生成脚本。安装新依赖、提交、推送、改写历史、删除分支须有用户授权。
- 不改无关代码；现有代码结论引用真实文件和行号，测试没跑不能说通过。
- 用户改变需求回 F3，只澄清变化部分并更新验收标准。
