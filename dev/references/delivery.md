# 审查与交付

进入 F7 / F8 或缺陷修复 B5 前读取对应小节；首次正式落盘前读取 Artifact Location。

### F7 — 审查、报告与用户选择

**S 快速通道不走本节**：在当前会话按 project-review 的标准清单自查，不写方案、不落 `review.md`、不绑定需求、不交报告等选择；审查结论写进 F8 的对话交付。碰到快速通道的退出条件时，再按下面的完整流程走。

- 按 `project-review` skill 审本次改动，用户未指定深度时按 project-review 的「标准」审查。范围用 `node <skills>/workflow/scripts/review-scope.mjs --base <main_branch>`：分支已有的提交、未提交的改动和未跟踪的新文件一起列出。Step 0 确认不属于本需求的文件用 `--exclude <文件,文件>` 排除，它们不计入本次结论（见 Step 0「工作区状态与工作分支」）；之后 project-review 的 `rules`、`locate.mjs` 都带同样的参数。
- **优先由独立子 agent 审查**：派一个未参与本轮实现的子 agent，执行 project-review 的第 1～7 步（含复核和落盘报告）。只交接项目根、skills 路径、分支 / 基线、排除范围、审查深度（默认标准）、需求与验收标准、已确认决定、方案路径、验证命令与结果、上次报告路径；不要传实现者的自审结论或预设问题，让它自己读当前代码判断。审查期间主 agent 不再修改被审代码。子 agent 只审查、写审查产物，不修代码、不生成交付说明、不提交。
- **没有子 agent 时在当前会话审查**：按 project-review 第 1～7 步自己走完并落盘 `review.md`，报告的「审查者」写当前 agent（未派子 agent）；问题表、复核、报告、等用户选择都不省。不要写成独立审查，也不要跳过审查直接进 F8。
- **每轮必须落盘 `review.md`**：按 Artifact Location 先绑定需求，再按 project-review 第 7 步生成报告、运行 lint 和 sync。问题表、影响面、未覆盖项都要保留；没有发现也生成报告。只跳过 project-review 第 8 步沉淀与第 9 步反馈，沉淀和反馈留给 dev F8 统一处理；报告的元信息固定写「未询问（由 dev 交付统一处理）」。F8 只更新交付说明的沉淀状态，不将内部审查报告同步为交付的沉淀结果，避免把一次询问或沉淀重复计数。本轮尚无交付说明，不能把缺少 `delivery.md` 当成漏项；旧交付说明只能作为历史参考，当前需求与验证以本次交接为准。
- **先交报告，再等选择**：主 agent 读取报告，将报告内容与路径交给用户，明确询问「修复报告中的问题，还是按当前结果交付？」并等待本轮明确答复。没有发现时也要等用户选择交付；答复含糊或未答复时留在 F7。此时**不创建、不覆盖 `delivery.md`，不提前进入提交、PR 或沉淀环节**。
  - **修复问题**：按用户选定的问题回到 F5 修复、F6 验证，再由未参与修复的子 agent（没有子 agent 时在当前会话）重新走 F7；复审更新 `review.md`，旧版按产物规则归档，逐条核对「已修复 / 仍存在 / 不再适用」。再次交报告、等待选择，不因已修复就自动交付。用户自己修复后也走 F6 → F7，不能只凭口头说已修复关闭问题。
  - **交付**：确认报告对应当前代码；审查后代码有变动就先回 F6 → F7。仍有已复核的 CRITICAL / HIGH 时，明确建议先修复，说明具体风险并让用户确认是否仍按当前结果交付；不能将一般的「交付」视为接受未说明的严重风险。用户明确接受遗留风险后才进 F8，如实记录遗留问题与未验证项，不得把带问题交付写成「审查通过」或「建议合并」。MEDIUM / LOW 的处理结果也写进交付说明（快速通道写在对话里）。

### F8 — 交付

**完整流程的进入条件**：F7 的审查报告已完成并交给用户（独立子 agent 或当前会话审查均可），且用户明确选择「交付」。修复后仍需完成验证与复审、重新取得交付选择；此前不创建或更新 `delivery.md`。选择交付不等于授权提交、推送、发布或沉淀。S 快速通道不经过这个条件、也不生成报告，见下面的「快速通道交付」。

独立文档仓库中 F7 的报告提交提示延后到本步：完整流程交付完成后运行 `requirement.mjs pending`，按 `<skills>/workflow/references/requirements.md`「文档仓库的提交」询问；不让审查环节提前询问或执行提交。

**快速通道交付**（见 F4「S 规模快速通道」）：一次对话交付，不绑定需求、不落任何产物文件——方案、`review.md`、交付说明都不写，不跑 lint、不问 DocNexus 沉淀（运行反馈仍照常记一行），交付里注明「DocNexus：未询问（快速通道不问沉淀）」。给：结果一句话、改动文件、验证（验收项 → 测试 / 操作 → 结果，构建 / 测试命令与结果，开工前已有的失败，未验证项如实写）、当前会话审查的结论与遗留问题；按完整流程第 4 步记录运行反馈；然后只问提交（建议的 commit message）。用户说「落盘交付说明」或之后要出上线方案时，先绑定需求，回到 F4 补方案、F7 补审查报告（`review.md`），取得交付选择后，才按下面的完整流程生成交付说明、判断沉淀。

完整流程：

1. **落盘交付说明**：模板路径用 `node <skills>/workflow/scripts/resolve.mjs template dev delivery-template.md` 取，写到 `requirement.mjs path delivery` 给出的路径（见 Artifact Location）。元信息行的「对比分支」写当前分支和 `profile.main_branch`，`artifacts.mjs`、project-review、上线方案靠它找到这份交付；「参考产物」写最新审查报告，有方案（`plan.md`）时也写方案路径。「审查」节记录报告结论、修复与复审结果、用户选择交付及接受的遗留风险。尚未发起沉淀询问时，元信息先写「未询问」，再按第 5 步更新。小改动每节一两行即可，不适用的节写「无」，但验证结果必须如实。
2. **自检**：运行 `node <skills>/workflow/scripts/lint-doc.mjs <交付路径> --skill dev --template delivery-template.md`，有「错误」先修正。
3. **对话里给摘要**：结果、验证（含未验证项）、最新审查报告路径与结论、遗留问题和用户接受的风险、配置 / SQL 有无、交付文件路径；不必把全文贴进对话。
4. **记录运行反馈**（不问用户）：按 `<skills>/workflow/references/feedback.md` 运行 `node <skills>/workflow/scripts/feedback.mjs add --skill dev --model <模型名> --mode <feature|bug> --size <S|M|L> --fast <yes|no> --rounds <提问轮数> --corrections <用户纠正理解的次数> --acceptance <已验证>/<总数> --baseline-failures <n>`，有跳过的步骤、不清楚或做不到的规则、用户的抱怨时再加 `--skipped` / `--unclear` / `--feedback`。只写过程，不写代码和业务名词；报错就提一句，不影响交付。
5. **询问下一步**，不要自行执行：
   - 提交：给出建议的 commit message 和要 add 的文件（只含本需求的改动，Step 0 确认无关的不 add；建议把方案、审查报告和交付说明一起提交，随分支保留），用户同意后再 `git commit`；**不 push**，除非用户明确要求。
   - PR / MR：用户要提 PR / MR 时，运行 `node <skills>/workflow/scripts/pr-desc.mjs`（缺省当前分支、基线 `profile.main_branch`），它把本分支的交付说明、审查报告、技术方案、上线方案汇总成描述（没有交付说明时退回用提交记录和改动文件），把输出给用户；用 `gh pr create` / `glab mr create` 创建要用户明确同意。
   - 文档：运行 `node <skills>/workflow/scripts/artifacts.mjs` 看本分支已有哪些产物（方案、交付说明、审查报告、技术方案、上线方案及 wiki 发布记录），按输出的 `next` 建议下一步：M / L 规模缺技术方案时建议 `create-tech-md-doc`，要上线时建议 `create-release-md-doc`（会自动引用本分支的技术方案和交付说明）。
   - **沉淀到 DocNexus**：先判断本次交付有没有**特别值得记录**的内容——已确认的决定、新约定、踩到的坑、缺陷根因、配置 / 表结构变化；标准是「下次做同类需求时，它能不能少踩一次坑或少做一次决定」，分支、产物路径这类工作流信息不算。
     - 没有 → **不提沉淀**：元信息行写「无需沉淀」，交付摘要里一句话带过（如「只是改了文案，没有值得沉淀的知识」），不追问。
     - 有 → 明确问用户「要不要启动 DocNexus 流程，把本次交付沉淀到 DocNexus？」，并列出建议沉淀的条目；发起询问时将交付说明的元信息改成「未沉淀」，成功入库后再写知识路径，避免将已询问但尚未入库算成「未询问」。
       - 用户同意 → 以交付说明为来源，按 DocNexus 入口 skill `docnexus` 的 capture 流程写入；正文只写知识，不写分支、路径；有 facts 时按 `<skills>/workflow/references/docnexus.md`「沉淀的来源」的格式写 provenance；分类用 `node <skills>/workflow/scripts/resolve.mjs category dev` 的结果作为调用方显式分类封存（见 `<skills>/workflow/references/docnexus.md`「写入 DocNexus 的分类」）。只沉淀确认过的事实，不沉淀「未验证」「待确认」的内容；知识库已有同主题的沉淀时更新那一篇（带 `--base-version`），不重复新建。写入成功后把交付说明的「DocNexus」元信息行改成 `workflow-run/docnexus/library/<path>`，并回报给用户。
       - 用户不同意 → 交付说明的元信息行改成「未沉淀」，不再追问。
     - 元信息更新后运行 `requirement.mjs sync <交付路径>`；F7 内部审查报告的「未询问」不随此结论改变。

## Artifact Location

产物按需求归档在 `workflow-run/docs/requirements/<需求名>/<项目名>/`，规则见 `<skills>/workflow/references/requirements.md`：

- **需求名**：Step 0 已运行 `requirement.mjs which` 并问定名字。第一次落盘前运行 `requirement.mjs bind --name "<需求名>"`（用户明确同意按分支名生成时不带 `--name`）；S 快速通道不 bind、不落盘。缺陷修复同样处理（可以选择挂到原需求下）。
- **路径**：交付说明用 `requirement.mjs path delivery`，方案（非快速通道一律落，S / M 写简版）用 `requirement.mjs path plan`，写到输出的 `path`；文件名固定，已有旧版时直接写新版，上一版由脚本归档（输出的 `previous`）。缺陷修复在 B4 把根因与修复方式**追加**到同一个 `plan.md`（不另建文件）。
- 写完运行 `requirement.mjs sync <path>` 更新 `meta.json`；输出里 `archived` 非空（上一版已归档到 `workflow-run/tmp/old-artifacts/`）时告诉用户归档了哪些文件，请用户确认不再需要后自己删除；输出里 `commit` 非空（独立文档仓库模式）时按 `<skills>/workflow/references/requirements.md`「文档仓库的提交」处理。文档里引用其他产物（「参考产物」等）写 `requirement.mjs path` 输出的 `cite`。
