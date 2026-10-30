# 完整流程的运行状态

状态和需求绑定、产物索引统一保存在 `workflow-run/docs/requirements/<需求>/<项目>/meta.json` 的 `runs` 对象中，以运行 id 区分。每次运行有自己的分支、kind、规模、阶段、步骤状态、上下文、历史、revision 和完成时间；同一需求跨分支不会共用一个全局阶段。

本文是用户显式启动工作流后的状态协议，不是普通分析、代码修改或 Git 操作的入口。dev 仅由 `/dev` / `$dev`、点选 skill 或明确要求 dev / 完整开发工作流启动；新会话读取旧 runs 不构成恢复授权。已授权同一任务可按保存阶段续接；用户只要求分析或提交代码时，仅处理该请求，不重启流程或自行 save / complete。

**快速通道不 start、不 save、不 bind**，仍然只写既有运行反馈。`show` 只读，无绑定或旧需求没有 runs 时返回空列表，不创建目录，不根据文档存在推断“已完成”。

## 命令与状态

在业务项目根运行（`<skills>` 是当前安装目录）：

```bash
node <skills>/workflow/scripts/run.mjs show
node <skills>/workflow/scripts/run.mjs show --id <运行id>
node <skills>/workflow/scripts/run.mjs start --kind feature --size M --input workflow-run/tmp/checkpoint.json
node <skills>/workflow/scripts/run.mjs save --id <运行id> --expect-revision <revision> --input workflow-run/tmp/checkpoint.json
node <skills>/workflow/scripts/run.mjs complete --id <运行id> --expect-revision <revision> --input workflow-run/tmp/checkpoint.json
node <skills>/workflow/scripts/run.mjs cancel --id <运行id> --expect-revision <revision> --input workflow-run/tmp/checkpoint.json
```

`--input` 读 JSON，`--input -` 也可读 stdin；不需要新 checkpoint 时可以省略。`--root` 指定业务项目根，`--branch` 默认当前分支；start 的 `--dir <需求目录>` 可明确指定已有产物所属需求，并校验该需求确实绑定此分支。代码开发／审查要先切换并核对工作分支，不能伪造验证结果；wiki 发布可明确使用来源产物的归属分支，不代表该分支代码已验证。输出 JSON，失败退出 1 且不写入半份状态。

| 对象 | 状态 |
|---|---|
| 运行 | `running` 进行中、`waiting_user` 等待用户、`blocked` 受阻、`completed` **已完成**、`cancelled` 已取消 |
| 每个步骤 | `pending` 未开始、`in_progress` 进行中、`completed` **已完成**、`skipped` 已跳过（必须说明 reason） |

`completed_at` 保存运行／步骤的完成时间。取消不算完成。完成或取消后原记录不可改，之后的新工作创建新运行；重复 start 同一需求、同分支、同 kind 的未结束运行会返回 `resumed: true`，不覆盖上下文。若用户明确开始新任务，应绑定新需求，或先确认取消旧运行，不能把旧运行的进度覆盖为新任务。

| kind | 步骤 | 首次创建时机 |
|---|---|---|
| `feature` | Step0、F1～F8 | 需要业务清单时在 F2 初判规模、选择完整流程并 bind，先发布 clarification.md；无需清单时在 F3 收尾 requirement.md 前创建 |
| `bug` | Step0、B1～B5 | B3 首次落盘前初判规模、选择完整流程并 bind；有清单先写 clarification.md，否则先写 requirement.md |
| `review` | R1～R7（project-review 第 1～7 步） | 独立审查需要落盘且绑定需求后；dev 内部审查不另开运行 |
| `tech` | T0～T4（技术方案 Step 0～4） | 确定需求和分支、绑定后 |
| `release` | L0～L4（上线方案 Step 0～4） | 确定需求和分支、绑定后 |
| `wiki` | W0～W2（发布 Step 0～2） | 已有需求产物的 wiki 发布；单独发布其他 Markdown 不强制绑定需求 |

“已完成”表示**本次运行范围已交付**，不是整个需求已经上线。dev 完成后，用户选择的技术方案、上线方案、wiki 发布是同一个 meta.json 中的新运行，不把已完成的 dev 改回未完成。提交、推送和知识沉淀仍按既有授权规则处理，不因 completed 自动执行；这些可选后续动作不阻止已完成的技能交付标记完成。

关键门禁、代码快照、自动审查交接和正式文档收尾见 [execution.md](execution.md)。完整流程从首个业务场景清单或需求文档开始记录；清单在 F2 / B3 逐轮更新并保存 waiting_user；业务明确并完成调研后，feature 进入 F3 技术澄清，再收尾需求。方案绑定需求 hash／版本，方案确认绑定方案版本，验证和审查绑定代码快照，交付选择绑定本轮报告。

## 写 checkpoint

完整 dev 开始记录前已经完成的前置步骤要补入第一份 checkpoint，不能提前标完成。首次发布业务清单时 stage 为 F2，只补记 Step0、F1，F2 保持 in_progress；下面示例是无需清单、F3 准备收尾需求文档时：

```json
{
  "stage": "F3",
  "status": "running",
  "steps": {
    "Step0": { "status": "completed" },
    "F1": { "status": "completed" },
    "F2": { "status": "completed" }
  },
  "context": {
    "summary": "本次要实现的行为",
    "acceptance": ["可验证的验收项"],
    "decisions": ["用户确认的业务决定"],
    "scope": ["本次范围及排除项"],
    "remaining": ["下一步要做的事"],
    "baseline": "基线命令、结果和已有失败"
  }
}
```

每完成一个步骤、发生阻塞、准备等待用户，或结束本轮会话前，save 一次；`context` 按顶层字段合并，列表字段更新时提供完整列表，不写密码、token。每一步可记录 `evidence`（命令、结果、产物路径、未验证原因）和 `note`；这些是已观察到的结果，不得用计划冒充。

F3 / B3 只能在需求文档 finalize 后完成；requirement.md 是需求事实来源，context 摘要与它保持一致。需求文档及方案各自独立版本、归档和展示；改需求须重新收尾依赖它的方案。历史文档不自动拆分，旧开发运行恢复时回到 F3 / B3 核实并补齐，不能用旧方案冒充需求文档。

报告必须先由 artifact.mjs finalize 收尾并登记审查证据；报告已交给用户、等待修复或交付时：

```json
{
  "stage": "F7",
  "status": "waiting_user",
  "waiting_for": "修复报告中的问题或交付",
  "steps": { "F7": { "status": "completed", "evidence": ["review.md 已落盘并自检，报告已交给用户"] } },
  "context": { "remaining": ["等待用户选择修复或交付"] }
}
```

前面的 F4～F6 必须已按实际进度保存，不能为凑齐示例而直接标完成。bug 的 B5 同时包含审查与交付，报告完成等待选择时 B5 仍为 in_progress，最后交付才标完成。

- 用户选修复：save `stage: F5`、`status: running`、`decision: {"action":"fix","confirmed":true}`；bug 回 B4。回到前面的阶段会自动重置该阶段及后续的完成标记、清除旧交付选择，旧 checkpoint 保留在 history；修复、验证和复审后再次等待选择。业务场景变化先回 F2 更新清单，再到 F3 重新收尾需求；仅技术约束变化回 F3，规模变化同时写 size。
- 用户明确选交付：按 execution.md 核对本轮证据，save `stage: F8`、`status: running`、`decision: {"action":"deliver","confirmed":true}`；bug 留在 B5。只记录用户实际确认的选择，遗留风险写 context。
- 等方案确认：`status: waiting_user`，waiting_for 说明待确认方案；方案已写不代表用户已同意。
- 环境等阻塞：`status: blocked`、reason 说明原因，保留步骤与 remaining；解除后 save running。
- 取消：用 cancel，input 提供 reason，不能用 complete 把取消记成完成。

交付产物、自检、摘要和反馈已处理后，把最后步骤标 completed，再运行 complete。complete 要求所有步骤 completed 或有原因的 skipped；完整 dev 的方案、实现、验证、审查、交付核心步骤在 save 时就不能跳过，用户必须已选择交付，并有本运行已收尾、内容仍匹配且属于当前分支的 requirement.md、plan.md、review.md、delivery.md，以及有效代码与审查证据。独立审查也核对代码快照与报告收尾凭据，其他文档运行检查当前分支的对应文件。验证步骤完成可以包含如实记录的“未验证”，不等于所有测试都通过。

complete 不接受待用户确认或 blocked 的运行。还在处理本次已承诺的交付事项时不能提前完成；可选下一步不属于本次运行范围。状态写入具有 revision 检查和短时元信息写锁；版本冲突时重新 show，核对并合并进度，不盲目重试覆盖。写入用 workflow-run/tmp/locks/ 下的短时锁目录（不落在需求目录、不会随产物提交），目录名为元信息相对路径的 SHA-256，避免长中文路径超过文件名限制。每次写入持有唯一的 PID／UUID 标记；只回收超过 30 秒且进程已退出的旧标记，非空锁目录不能删除，释放时也只删除自己的标记。mkdir 后尚未写入标记就崩溃的空目录，过期后同样自动恢复。

## 新会话恢复

1. 先确认业务项目根和当前工作分支，再 show；若提示 pending_finalization，先按 execution.md 恢复／取消收尾。多个运行时按用户的任务选 id，不能把其他分支的状态直接套过来。
2. 读取 context、各步骤状态、waiting_for、reason、history 和关联文档，核对 git 改动、已有产物与证据是否仍适用。记录不是当前代码仍然正确的保证。
3. 从保存的阶段继续，已完成的有效步骤不重复执行。waiting_user 时先取得对应答复；不能将“继续”直接当成“交付”或接受风险。show 的 freshness 会提示代码证据是否仍有效；代码已变化而验证／报告失效时，回退到实现或验证阶段并 save，再验证与复审。
4. completed 运行只展示已完成及时间，不自动重启；需要新的工作时 start 新记录。旧需求没有 runs 时明确说明暂无可恢复状态，按文档和代码重建，经核对后再记录，不自动假定已完成。

`artifacts.mjs` 的 execution 和 `/workflow status` 使用同一份状态；有未结束运行时 next 优先显示等待、阻塞或当前阶段，不越过修复／交付选择推荐后续动作。`/workflow view` 即使尚无 Markdown 也展示已有运行，包含“已完成”标识和完成时间。
