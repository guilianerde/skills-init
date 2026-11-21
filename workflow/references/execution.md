# 关键门禁、代码证据与产物收尾

完整流程进入方案、实现、验证、审查或交付时读对应小节。快速通道不调用本文的运行与落盘命令。所有命令在业务项目根运行，`<skills>` 为安装目录；JSON 输入文件放 `workflow-run/tmp/`。

## 需求、方案与实现门禁

需要清单时，在 F2 / B3 初判规模、选择完整流程并 bind、start，先发布业务场景清单；无需清单时，澄清后判规模与通道，完整流程在收尾需求文档前 bind、start。快速通道仍不 bind。scope 保存审查基线和明确排除范围，缺省取需求 base／画像 main_branch 与 review.exclude：

```json
{"scope":{"base":"main","exclude":["unrelated/**"]}}
```

完整流程的文档先写草稿，再统一收尾；不要直接覆盖正式文件后用 reindex 代替收尾。模板由调用方用 `resolve.mjs template <skill> <id>` 读取，按 [templates.md](templates.md) 的「文档模板的两部分」填充正文。首次生成清单时用 dev 的 clarification-template.md，后续各轮把上一版正式清单复制到 tmp 更新，再发布：

```sh
node <skills>/workflow/scripts/artifact.mjs finalize --id <id> --expect-revision <revision> --kind clarification --draft workflow-run/tmp/clarification.md --input workflow-run/tmp/checkpoint.json
```

等待业务反馈的 checkpoint 可写 `{"status":"waiting_user","waiting_for":"产品核对业务场景清单","steps":{"F2":{"status":"in_progress"}}}`（bug 改为 B3），context 记录清单引用和待反馈事项。clarification 仅在 F2 / B3 发布，不能借发布清单将该阶段标 completed；业务项解决后发布「业务已明确」的清单，完成 F2 调研，另行 save F2 completed、stage F3。F3 澄清技术约束；发现新业务问题回 F2 更新清单。业务与技术约束均明确后，在 F3 / B3 收尾需求文档：

```sh
node <skills>/workflow/scripts/artifact.mjs finalize --id <id> --expect-revision <revision> --kind requirement --draft workflow-run/tmp/requirement.md --input workflow-run/tmp/checkpoint.json
```

需求文档保存背景目标、范围边界、AC 验收标准、已确认决定与待确认问题。功能收尾 checkpoint 标 F3 completed、status waiting_user、waiting_for「确认正式 requirement.md」。发文件链接和版本，等用户明确确认后，才用 save `{"stage":"F4","status":"running","requirement_approval":{"confirmed":true}}` 进入 F4 起草方案。程序把确认绑定到当前需求 hash 和版本；需求重新收尾且内容变化后须重新确认。缺陷修复在需求收尾时标 B3 completed，按 B3 / B4 规则继续。

plan.md 头部引用需求文档 cite 与版本，只写实现设计、技术风险、实施步骤和验证计划；验证引用 AC 编号，不复制业务需求。方案收尾自动绑定需求 hash / 版本：

```sh
node <skills>/workflow/scripts/artifact.mjs finalize --id <id> --expect-revision <revision> --kind plan --draft workflow-run/tmp/plan.md --input workflow-run/tmp/checkpoint.json
```

功能方案收尾的 checkpoint 可写 `{"steps":{"F4":{"status":"completed"}}}`。bug 的 B4 还包含实现、验证，方案收尾时不能标完成，checkpoint 可省略。已有方案在草稿中保留正文并追加修复方案，更新当前分支和日期。

M / L 先取得用户对方案草稿的实际确认，正式收尾后用 save 记录 `approval: {"confirmed":true}`，程序绑定当前 plan.md 的 hash／版本。审核后的定稿仍在用户确认的范围、行为、技术取舍和风险边界内时，按原答复登记，发一条审查和修改摘要即可。已收尾方案更新后旧凭据失效，须按当前版本重新登记。S 完整流程仍须收尾方案，但无需该确认记录。进入实现：

- feature：save `{"stage":"F5","status":"running","approval":{"confirmed":true}}`（S 可省 approval）。
- bug：在 B4 save `{"status":"running","approval":{"confirmed":true},"implement":true}`；之后才改代码。

未收尾方案、M / L 未确认、核心步骤 skipped 都会被拒绝。程序校验确认记录与版本，不能替代 agent 核实用户是否真的授权。

业务清单内容变化时撤销本轮 requirement / plan 凭据，清除旧方案确认、实现、验证、审查与交付选择，并重置后续步骤；正式文件和历史版本保留供查阅，相同清单内容重新发布不触发该失效处理。即便需求和方案正文不变，也必须分别重新 finalize；M / L 在新方案上核对用户确认的决定是否仍适用，并重新登记当前版本的确认。

需求变化回 F3（bug 回 B3），只澄清变化和受影响的内容，再 finalize requirement；程序清除旧方案确认、实现、验证、审查和交付选择。即使方案正文不变，也要在 F4 / B4 重新收尾以绑定新需求版本。M / L 只向用户确认新增或改变且尚未决定的取舍。只改实现方式则仅更新 plan。手动改需求正文而未收尾也会使后续证据校验失败。

## 审查方式选择

每到允许派子 agent 的审查点，主 agent 先说明本轮范围（需求、方案、代码、修订复审、分角度查找或发现复核），让用户明确选择 **子 agent 审查 / 当前 agent 审查 / 跳过审查**。有运行时保存 waiting_user，等答复后继续。不可派遣时说明子 agent 选项当前不可用，仍由用户决定自查、跳过或等待。已明确选择的本轮范围可以直接执行；一次询问可包含多个明确列出的审查点。已有流程授权或对其他轮次的选择不能用来推定本轮选择。子 agent 遇到未确认的下级审查点，把范围交主 agent 询问。

选择跳过时明确记录「未审查」及跳过的范围。验证、正式需求确认及交付选择仍分别执行。对结果 JSON，由主 agent 按实际答复记录 `mode: "independent" | "self" | "skipped"` 和 `confirmed: true`；审查者只提供实际审查内容。

## 需求与方案审查

M / L 在 F3 / B3 澄清需求决定，在 F4 / B4 确认方案草稿。运行有文档审查策略时，两份文档各自在相关决定明确后询问本轮审查方式，按选择处理再正式收尾。F3 正式落盘后请用户确认正式版本。S 和没有该字段的升级前运行无需新增文档审查。新运行从 S 升为 M / L 后，如已有未审查的需求或方案，回对应阶段补审。

1. **先讨论草稿。** 草稿写到 tmp，给用户草稿链接或重点摘要。收到明确修改意见就直接更新，回复改了哪些内容。只询问真正未决的取舍；继续讨论期间不送审、不收尾。已有明确答复覆盖的范围、行为和技术决定直接复用；单条修改意见只确认该项，仍需确认的内容集中在同一轮。需要等待时按 [runs.md](runs.md#写-checkpoint) 保存草稿路径、已确认决定及待答问题。
2. **决定明确后询问审查方式。** 用户选定本轮方式后，将等待中的运行恢复为 `running`，生成交接。交接记录当前草稿正文及已登记的业务澄清或需求依据。

   ```sh
   node <skills>/workflow/scripts/review-handoff.mjs --id <id> --kind <requirement|plan> --draft <草稿.md>
   ```

3. **审查按已确认的决定开展。** 选子 agent 时把交接 `path`、适用的原始材料及用户决定的来源交给未参与起草的子 agent；选当前 agent 时用相同材料自查。审查者按 `packet.result_schema` 返回结论、位置、依据、影响和阻塞标记。
   - 需求审查核对范围、场景、规则、技术约束和可验证的验收标准。缺陷修复还要核对现象、根因证据和预期行为。
   - 方案审查以交接中的已定稿需求为依据，核对各验收项的实现与验证安排，以及适用的兼容性、权限、数据和回滚风险。
   - 阻塞项的 `evidence` 指向具体的验收项、已确认决定或可查证的约束，`impact` 写明实际冲突、不可验证的验收项或会引入的风险。架构偏好、可选优化和新增功能填 `blocking: false`，按需采纳或关闭。如果建议被误标为阻塞，主 agent 提供对应的范围或决定，请审查者核实并更正结论。审查者发现需要改变用户决定的真实冲突时，写明影响，由用户或产品决定取舍。
4. **修订后复核差异。** 在既定决定内直接修复；如有新取舍，一次说明受影响的范围和建议，等待答复后修改。草稿或依据变化时生成绑定当前版本的新 packet。将上一轮同一文档的 packet 和结果（若基线是已收尾版本，也可用该版本正文、依据和审查记录）、正文及依据的差异、待关闭阻塞项和受影响的 AC 或章节一起交给审查者。按用户对本轮复审的选择执行；若选择子 agent，优先复用原审查者，复核这些内容和相邻约束；基线缺失或无法界定影响时扩大范围。新结果使用当前 packet 的 `inputs`，在 `summary` 注明基线、复核范围及关闭的阻塞项；`findings` 如实保留仍适用的发现。
5. **登记选择。** 独立审查和自查填写实际审查者。用户选跳过时以当前 packet 登记 `mode: "skipped"`、`confirmed: true`、明确写明跳过的 summary 和空 findings。程序校验标记及文档内容，主 agent 如实记录用户答复。
6. **完成审查或登记跳过后收尾。** 将最终结果保存为 tmp 下的 JSON。执行 `artifact.mjs finalize` 时额外传 `--packet <交接JSON路径> --result <结果JSON路径>`。收尾会拒绝缺失、过期或仍有阻塞项的结果。审查后涉及新的取舍时先取得决定。F3 收尾后另请用户确认正式版本；M / L 方案收尾后按前文记录当前版本的 `approval`。F7 / B5 的代码审查按下文执行。

## 验证证据

feature 首次实现完成后 save F5 completed，进入 F6。已经进入过 F6 的运行回到 F5 或之前阶段返工时，完成 F5 后先 save F5 completed，程序保留 F5 并置为 waiting_user。把改动摘要交给用户，确认推进后再 save `{"stage":"F6","advance":{"confirmed":true}}`。修改方案先按 F4 规则收尾并确认，再到 F5 实现。bug 在 B4 验证。**测试／操作执行前**生成快照：

```sh
node <skills>/workflow/scripts/run.mjs snapshot --id <id>
```

保留输出的 `snapshot` 对象，再执行构建、相关／全量测试、lint 与验收操作。执行后 save：

```json
{
  "validation": {
    "snapshot": {"说明":"替换为执行前输出的完整 snapshot 对象，不是此示例"},
    "checks": [
      {"command":"实际执行的测试命令或验收操作","result":"passed"},
      {"command":"无法执行的集成验证","result":"unverified","reason":"缺少测试环境"}
    ]
  },
  "steps": {"F6":{"status":"completed"}}
}
```

result 只接受 passed / failed / unverified；失败或未验证须 reason，不能用计划冒充结果。bug 将 F6 改为 B4，保存后进入 B5。feature 保存 F6 completed 时程序保留 F6 并置为 waiting_user。向用户交付本轮验证结果，等用户明确确认推进，再 save `{"stage":"F7","advance":{"confirmed":true}}`。程序重新校验当前代码快照与验证证据，阶段确认与 F7 的审查方式选择分别记录。若执行期间代码变化，旧快照不能登记，需重新生成快照并验证。

快照包含实际工作分支、基线提交、合并基点、HEAD，以及工作区跟踪／未跟踪文件的内容、删除、执行权限和符号链接；暂存本身不改变内容摘要。子模块／嵌套仓库须固定在干净提交，不能用 dirty 标记代替具体代码证据。除明确排除范围外，也覆盖未改动的项目文件，防止调用方／配置变更使证据过期。忽略 Git 忽略的未跟踪文件，以及 workflow-run、已安装 skills、DocNexus 和 CodeGraph 内部文件，避免写报告使自身失效。不能用 `--branch` 给另一实际 checkout 作证。

## 自动审查交接

开工 status 输出保留在本轮 `workflow-run/tmp/capabilities.json`，同链路复用，不写需求 meta。进入 F7 / B5 后先询问本轮审查方式，用户选择后生成：

```sh
node <skills>/workflow/scripts/review-handoff.mjs --id <id> --depth 标准 --capabilities workflow-run/tmp/capabilities.json
```

输出 `path` 是交接 JSON，位于 tmp/review/<运行id>/。自动汇总项目／skills 路径、实际基线、排除范围、风险分批、requirement_document（需求文档路径、hash 与版本）、续接事实摘要、方案、验证命令与结果、上次报告及代码快照。验收与业务范围以对应需求文档为准，context 只作缓存摘要。没有能力文件时省略参数，主 agent 补交本轮能力快照；不重新探测。只传事实，不传实现者的自审结论。

选子 agent 或当前 agent 时按 project-review 第 1～7 步审查，由主 agent 收尾并更新同一运行。选跳过时按模板写跳过记录，审查方式和结论标明「用户选择跳过审查，未审查」，结果的 findings 和 coverage.reviewed 均为空，coverage.uncovered 列出全部审查范围；交付说明同步注明未审查。**审查期间不修改被审代码**。JSON 结果结构以 packet.result_schema 为准，run_id / code / inputs 原样回传，以绑定本轮运行、代码版本和交接内容；范围外发现标 scope: outside，不计入本次交付的严重问题门禁。零发现 findings 为空数组，scope.review 中每个文件必须进入 coverage.reviewed 或 uncovered，不能漏报未审文件。

```sh
node <skills>/workflow/scripts/artifact.mjs finalize --id <id> --expect-revision <revision> --kind review --draft workflow-run/tmp/review.md --packet <交接JSON路径> --result workflow-run/tmp/review-result.json --input workflow-run/tmp/checkpoint.json
```

feature 可在 checkpoint 标 F7 completed；bug 的 B5 此时仍 in_progress。主 agent 取得报告后交给用户，save waiting_user 等待修复或交付。跳过审查也须取得明确的交付选择。收尾要求交接仍对应当前代码、需求事实、方案和验证；仅进度保存不会让交接失效，改变验收／范围等实质内容须重新审查。

独立正式 review 也生成交接材料，R1～R6 记录实际进度，R7 用同一入口收尾 review，再交报告、complete；不要求 dev 的验证或方案。当前协议的代码证据基于实际工作区，正式审查请在目标分支 checkout 中运行；其他分支的只读灵活审查仍可用原 diff 命令，不创建运行。

## 交付门禁

用户明确选择交付后，feature save F8 running、bug 在 B5 save running，并写 `decision: {"action":"deliver","confirmed":true}`。程序自动绑定本轮报告 hash、版本与代码摘要。存在已复核 CRITICAL / HIGH 时，先说明风险、取得逐项接受，再在 decision.accepted_risks 中列出对应 findings 的 id；普通的“交付”不代表接受未说明风险。

只有该选择仍有效，才允许 `artifact.mjs finalize --kind delivery --draft ...`。审查后代码／基线变化或报告被修改，旧选择不能继续用；回适用的实现或验证阶段，按本节的确认点推进到复审并再次取得交付选择；bug 回 B4。修复回退会清除旧验证、审查与交付选择；方案改变则还须重新确认。

交付摘要和反馈处理后，末步标 completed，再 complete，保存“已完成”与时间。可选提交、发布、知识沉淀仍沿用原授权边界，且在完成标记后处理；若本次运行完成前修改正式正文，需重新收尾，不能只 reindex 后用旧收尾凭据 complete。

## 统一收尾与中断恢复

finalize 先用知识库当前模板 lint 精确的草稿内容，再校验运行 revision、阶段、分支和证据；通过后归档旧版、发布正式文件、更新版本／索引、登记运行证据。checkpoint 只能更新当前产物所属步骤、等待状态和上下文，不能夹带下游阶段或用户确认。输出正式 path、cite、previous、version、lint、run；自检警告和待填写项要告知用户，引用用 cite，归档遵循 requirements.md，不能替用户删除。

正式文档先写 tmp 草稿；旧 `requirement.mjs path` 入口已删除，不能通过直接覆盖正式文件绕过收尾中断保护。tech / release 分别在 T4 / L4 用 kind tech / release 收尾，使用各自的知识模板。Wiki 发布记录直接从 Markdown 读取。更新知识沉淀元信息后显式 reindex，仅刷新派生索引。

技术方案将生成时间、对比分支、diff 概览、PRD 参考和模板来源放在文件头的 `<!-- workflow-run: … -->` 多行注释中（格式见 create-tech-md-doc，整个块在前 20 行内），不要求正文显示元信息引用块。分支校验仍读取注释中的 `对比分支：`，索引日期读取其中的 `生成时间：`；旧文档的可见元信息继续兼容。注释随正式文件一起归档并参与 hash 校验，Wiki 转换时移除；`meta.json` 仍按现有逻辑记录绑定、索引和运行，不自动接收全部注释字段。

两个文件无法一次原子提交，待办保存在同一个 meta.json 的 pending_finalization，草稿副本在 tmp/finalize/。中断期间其他元信息写入会被拒绝，show 的 next 提示恢复：

```sh
node <skills>/workflow/scripts/artifact.mjs resume --id <id>
```

命令会读取当前 pending 的目标 revision 和 operationId，再通过核心入口在锁内复核；读取后若待办已被替换，旧请求会明确失败，不会误处理新事务。恢复会再次核对代码与正文，已发布的相同文件不重复升版本；原 finalize 命令重试也不会重复推进状态。恢复发现代码变化或正式文件被其他操作改动时，停下保留待办，不覆盖。需要放弃本次收尾时用 `artifact.mjs abort --id <id>`：只在文件仍是本操作原版／新版时恢复原版并清除待办；发生外部冲突则先人工核对。之后回退、重新验证／审查。临时副本保留在 tmp，不删除用户文件。
