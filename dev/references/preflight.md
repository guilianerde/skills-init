# 开工与运行状态

进入 Step 0 或恢复运行前读取；只读当前事项对应小节。完整状态协议复用 `<skills>/workflow/references/runs.md`；关键阶段进入方式与正式产物收尾按 `<skills>/workflow/references/execution.md`。

## 完整流程的运行状态

按 `<skills>/workflow/references/runs.md` 保存和恢复进度，状态统一在需求的 `meta.json`，不另建状态文件。确定工作分支后先 `run.mjs show`；有 pending_finalization 先按 execution.md 恢复／取消收尾，用户要求继续时读取对应运行的 context、已完成步骤与等待事项，核对代码和证据后从保存的阶段恢复，不重走有效的已完成步骤。不能把“继续”当成用户选择交付。

新任务需要业务清单时，先按 F4 标准初判规模并选择完整流程，bind、start（feature stage F2，仅补记 Step0、F1），在 F3 前发布 clarification.md；等待产品反馈时保持 F2 in_progress、运行为 waiting_user。业务明确并完成 F2 调研后进入 F3 技术澄清。无需清单时，完整流程在 F3 收尾需求前 bind、start，仅补记真实完成的 Step0、F1、F2。bug 从 B3 创建，仅补记 Step0、B1、B2，在 B3 内先核对业务再澄清技术。业务与技术约束均明确后才 finalize requirement.md 并完成 F3 / B3。快速通道不 start、不 save。

每个步骤完成、等待用户、遇到阻塞和结束本轮会话前 save，明确标记步骤 completed 并记录证据。方案待确认时运行为 waiting_user；F7 报告交给用户后也保存 waiting_user 和“修复或交付”，不能仅因报告存在就继续。用户选修复时记录确认的 fix 并回 F5（bug 回 B4），自动重置后续完成标记；选交付时记录确认的 deliver 并进 F8（bug 留 B5）。规模变化同时更新 size。

完整交付说明、自检、摘要和反馈完成后，将 F8（bug 为 B5）标 completed，再执行 `run.mjs complete`，保存运行的 **completed（已完成）与 completed_at**；可选后续动作不阻塞本次已完成的交付，也不自动获得执行授权。已完成运行不再覆盖，新工作使用新的运行记录。dev 内部的审查子 agent 只返回报告和证据，由主 agent 更新同一运行，不能另起 review 运行或并发覆盖状态。

## Step 0 — 前置检查（两种模式共用）

1. **项目画像**：运行 `node <skills>/workflow/scripts/resolve.mjs profile`，读输出的 `profile`、`empty`（空字段列表）与 `toolchain`（开发环境配置，见 `workflow` skill）。本 skill 用到 `main_branch`、`build`、`test`、`test_single`（`{target}` 替换为测试类或文件）、`lint`、`config_center`、`notes`。
   - 需要的字段为空 → 按 `<skills>/workflow/references/profile.md`「填写与更新」的步骤推断，经用户确认后写回；用户不确认就只在本次使用，不落盘。
   - **开发环境配置**：`toolchain.configured` 为 true 时，编译 / 测试按它跑（JDK 用 `java_home`、Maven 用 `maven.settings` / `maven.repository`，写命令时把对应的 `env_vars`（如 `JAVA_HOME`）带上，例如 `JAVA_HOME=<值> <profile.build>`）。构建或测试失败且像是环境问题（找不到 java、依赖下载不下来、版本不对）时，先运行 `node <skills>/workflow/scripts/resolve.mjs env --check`：字段 `exists: false` 或带 `unset_vars` 就是环境没配对，把 `resolved` 和 `current`（本机实际值）一起给用户看，问清楚再继续，**不要自己改画像**。配过但本机对不上时属于个人差异，按 `references/profile.md` 写进 `profile.local.json`。
2. **工作区状态与工作分支**：`git status --short` 与当前分支。
   - 有未提交改动或未跟踪文件 → 列出这些文件，**问用户哪些属于本需求**（例如用户先手写了一部分，让你接着做）；可以和后面的澄清问题一起问。不要替用户 stash / 丢弃。
     - 属于本需求的：和你之后的改动同等对待，影响面、相关测试、审查、交付说明「改动」节都纳入。
     - 不属于的：照常在测试里跑到（测试跑的是整个工作区），但不算本次改动——审查在这些文件里发现的问题写进「范围外发现」，交付说明单独列出，提交时不 add。同一个文件里两边都改了的，告诉用户，审查只按本需求那部分下结论。
   - 当前在主分支（`profile.main_branch`）上 → 建议先建特性分支，用户同意后再建。
3. **需求名**：确定本次工作分支后，运行 `node <skills>/workflow/scripts/requirement.mjs which`。
   - 后续新建或切换分支时，重新运行 `requirement.mjs which`；不要沿用旧分支的 `bound` 结果或自动读到的需求名。用户明确确认继续同一需求时，才将该名字用于新分支。
   - 当前工作分支已绑定 → 直接用，不再问。
   - 本次对话里用户（或 `/workflow` 入口）已经给过名字、只是还没绑定 → 直接用这个名字，不再问。
   - 没绑定 → **现在就问用户这个需求叫什么**（默认值用输出的 `suggested_name`；用户说「按分支名」也行）。**用户给不出名字、或说不清这次要做什么时停在这里，不进入 F1**，已开始的改动保持原样，不替用户猜。名字在第一次落盘时按 Artifact Location bind；S 快速通道只问不 bind、不落盘。
4. **审查方式**：确认当前环境能否派独立子 agent（`resolve.mjs status` 探测不到这个能力）。能派 → F7 用独立子 agent；不能派 → F7 在当前会话按 project-review 自查，报告「审查者」写当前 agent，不阻塞流程。
5. **基线**：动代码前运行一次 `profile.build`，再跑和本需求相关的测试（`profile.test_single` 或相关模块，不必全量），记下已经失败的测试和编译错误。之后只对新增的失败负责：已有失败不顺手修，写进交付说明「开工前已有的失败」。跑不了就记「未跑基线」和原因。

## 终端命令

本 skill 给出的 `node …`、`git …` 命令在 bash、zsh、PowerShell 里写法一样，原样运行即可。需要自己写其他终端命令时，先看本机的系统和终端：`node <skills>/workflow/scripts/resolve.mjs env`（安装时记录，一次对话查一次就够；`resolve.mjs profile` / `status` 的输出里也带着 `env`）。按输出的 `os`、`shell`、`note` 写命令，不要再用 `uname`、`$PSVersionTable`、`ver` 之类去探测。
