# 报告、运行状态与后续

独立审查开工时只读运行状态；dev 内部调用先读调用约定；进入第 7～9 步时再读报告与后续操作。

## 运行状态

独立运行且确定要落盘完整报告时，先确定目标分支与需求名、绑定需求，按 `<skills>/workflow/references/runs.md` 用 kind `review` 创建／恢复运行，R1～R7 对应 SKILL.md 第 1～7 步；每步完成、等待用户或受阻时保存。报告落盘、自检并交给用户后，将 R7 标 completed 并 complete，记录“已完成”和完成时间。可选沉淀、反馈与后续动作按原规则处理。灵活模式只在对话里审查时不创建运行；dev 内部调用也不另起运行，由 dev 主 agent 用 finalize 把报告和证据记录到 F7／B5。正式 review 的交接快照与收尾命令见 `<skills>/workflow/references/execution.md`。

## dev 内部调用

优先由未参与本轮实现的子 agent 执行第 1～7 步；没有子 agent 时由当前会话的 dev 执行同样的步骤，报告「审查者」写当前 agent，不写成独立审查。完整流程必须落盘报告（零发现也写），不使用下文「灵活模式」免落盘；S 快速通道不落盘，不适用本节。跳过第 8～9 步，沉淀与反馈由 dev 交付时统一处理。只审代码、写 tmp 报告草稿和结构化结果，交回 dev 主 agent finalize；不修改业务代码、不生成 `delivery.md`、不提交。元信息写「未询问（由 dev 交付统一处理）」，不将 F8 的交付沉淀结果复制到内部审查报告；缺少本轮交付说明是正常时序，需求、已确认决定和验证结果以 dev 交接为准，旧交付说明只作历史参考。报告完成后交回主 agent，由主 agent 询问用户修复或交付。

## 第 7 步 — 输出报告（dev 完整流程的自审同样执行本步，只跳过第 8～9 步）

尚未发起沉淀询问时，报告元信息先写「未询问」。按报告模板输出（`node <skills>/workflow/scripts/resolve.mjs template project-review report.md` 取 `path`），按 `<skills>/workflow/references/execution.md`「自动审查交接」生成交接 JSON，返回报告草稿与 packet.result_schema 对应的结果；范围逐文件登记。独立 review 用本运行 finalize；dev 内部由主 agent finalize，同样验证报告仍对应当前代码、方案和验收。落盘规则见 Artifact Location。

## 第 8 步 — 沉淀到 DocNexus（需用户授权）

交付报告后先判断本次发现里有没有**特别值得记录**的内容：同类问题再次出现（知识库里已有类似沉淀，或本次多处出现）、新确立的编码约定、容易踩的坑。没有 → 不提沉淀，报告的「DocNexus」元信息行写「无需沉淀」；有 → 明确问用户「要不要启动 DocNexus 流程，把本次审查沉淀到 DocNexus？」，并列出建议沉淀的内容；发起询问时将报告元信息改成「未沉淀」，入库成功后再写知识路径。
   - 用户同意 → 按 DocNexus 入口 skill `docnexus` 的 capture 流程写入；正文只写知识，不写分支、路径；有 facts 时按 `<skills>/workflow/references/docnexus.md`「沉淀的来源」的格式写 provenance；分类用 `node <skills>/workflow/scripts/resolve.mjs category project-review` 的结果作为调用方显式分类封存（见 `<skills>/workflow/references/docnexus.md`「写入 DocNexus 的分类」）。只沉淀问题模式和约定，不沉淀某次审查的逐条清单，也不沉淀「⚠ 待确认」的发现；知识库已有同类沉淀时更新那一篇（带 `--base-version`），不要重复新建。写入成功后把报告的「DocNexus」元信息行改成 `workflow-run/docnexus/library/<path>`（多篇用「、」分隔），并回报给用户。
   - 用户不同意 → 元信息行保持「未沉淀」。
   - 元信息更新后运行 `requirement.mjs sync <报告路径>`。

## 第 9 步 — 记录运行反馈（不问用户）

按 `<skills>/workflow/references/feedback.md` 运行 `node <skills>/workflow/scripts/feedback.mjs add --skill project-review --model <模型名> --mode review --depth <快审|标准|深审> --rounds <提问轮数> --corrections <用户纠正审查范围的次数> --findings <C>/<H>/<M>/<L>`，有跳过的步骤、不清楚或做不到的规则、用户的抱怨时再加 `--skipped` / `--unclear` / `--feedback`。只写过程，不写代码和业务名词；报错就提一句，不影响交付。

## Output Template

报告结构以第 7 步取到的报告模板为准：元信息（审查范围、对比分支、审查方式、参考产物、DocNexus）、结论摘要、与上次审查对比（复审时）、严重问题（带触发条件与复核列）、一般问题、优化建议、需求对照（有方案时）、配置清单（如有）、影响面、未覆盖与待确认。某一节没有内容写「无」，不要删标题。

> 灵活模式：单文件 / 小改动只在对话里回复时，可以直接列 findings，不必套完整模板；但每个结论必须指向真实文件+行号并引用代码，不得用"应该/大概"下结论，CRITICAL / HIGH 仍要复核。落盘的报告一律用模板。

## Artifact Location

本节只适用于工作流生成的审查报告。用户只是让看一眼、问个问题，或让写一份不进入需求归档的分析、草稿时，产物默认放项目根的 `workflow-run/other/`（需要时创建，可按主题建子目录），不 `bind`、不调 `run.mjs`，也不写需求 `meta.json`；用户明确指定路径时以用户为准。走本 skill 正式流程产出的审查报告仍按下面的规则归档。

审查报告按需求归档在 `workflow-run/docs/requirements/<需求名>/<项目名>/`，规则见 `<skills>/workflow/references/requirements.md`：

- 正式审查在目标分支工作区进行，绑定并创建 review 运行后，用 `review-handoff.mjs --id <id>` 固定代码快照和范围；各步保存实际进度，需求／范围变化后重新审查。其他分支的只读灵活审查仍按 diff 命令执行，不创建运行。
- 报告先写 tmp 草稿，另写结构化结果（findings、coverage）；按 execution.md 用 `artifact.mjs finalize --kind review --packet <交接JSON> --result <结果JSON>` 收尾，输出 path / cite / previous。dev 内部只交回草稿与结果，不由子 agent 更新 meta。
- 正式报告同时完整交给用户，内容与落盘文件一致；独立 review 将 R7 标 completed 后 complete，dev 内部由主 agent 保存 waiting_user 等选择。
- 事实核对仍用 `lint-doc.mjs <草稿> --skill project-review --facts`；错误先修正，无法核实的标待确认。finalize 另校验模板、分支、代码快照与覆盖登记。
- previous 非空时说明旧版已归档，不能替用户删除；独立文档仓库按 requirements.md 运行 pending 后提示提交，dev 内部延后到 F8。已完成报告的沉淀／wiki 元信息更新仍用 sync。

## 终端命令

本 skill 给出的 `node …`、`git …` 命令在 bash、zsh、PowerShell 里写法一样，原样运行即可。需要自己写其他终端命令时，先看本机的系统和终端：`node <skills>/workflow/scripts/resolve.mjs env`（安装时记录，一次对话查一次就够；`resolve.mjs profile` / `status` 的输出里也带着 `env`）。按输出的 `os`、`shell`、`note` 写命令，不要再用 `uname`、`$PSVersionTable`、`ver` 之类去探测。
