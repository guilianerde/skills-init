# 运行反馈

每次 skill 跑完，用 `workflow/scripts/feedback.mjs add` 追加一行过程记录，写到 `workflow-run/feedback/<git 用户名>.jsonl`（每人一个文件，随 `workflow-run/` 提交）。团队攒两三周后用 `npx @rowansenne/workflow-run feedback` 汇总，作为精简 SKILL.md 的依据：哪些步骤常被跳过、哪些规则读不懂或做不到、提问是不是太多。装了新版本（`init` / `upgrade`）时会清掉本项目旧版本的记录，从新版本重新收集。

## 规则

- **不问用户、不打断**：交付时静默记录，不为了记录多问一句，也不请用户打分。
- **只写过程，不写内容**：不写代码、类名、方法名、表名、接口路径、业务名词、客户信息。这个文件会被发给维护 skill 的人。
- **如实**：跳过了就写跳过，问了几轮就写几轮；不美化。拿不准的数字不写那个参数。
- **失败不影响交付**：命令报错就在对话里提一句，不重试、不排查。
- **一次运行记一行**：dev 内部调用 project-review 自审时只由 dev 记，project-review 不另记。

## 参数

所有参数都是 `--名称 值`，值里有空格时加双引号；`--skipped`、`--unclear`、`--feedback` 可重复。

| 参数 | 值 | 说明 |
|---|---|---|
| `--skill` | `dev` / `project-review` | 必填 |
| `--model` | 你的模型名，如 `claude-opus-5-5`、`qwen3-coder` | 不知道就写所在的工具名 |
| `--mode` | `feature` / `bug` / `review` | dev 的功能开发 / 缺陷修复；审查写 `review` |
| `--size` | `S` / `M` / `L` | dev 的规模 |
| `--fast` | `yes` / `no` | dev 是否走了快速通道 |
| `--depth` | `快审` / `标准` / `深审` | project-review 的深度 |
| `--rounds` | 整数 | 向用户提问的轮数（澄清、确认方案都算；只问提交那一下不算） |
| `--corrections` | 整数 | 用户纠正你对需求 / 审查范围理解的次数 |
| `--acceptance` | `已验证/总数`，如 `3/4` | dev 交付说明「验证」表里的验收项 |
| `--baseline-failures` | 整数 | dev Step 0 基线里已有的失败数 |
| `--findings` | `C/H/M/L`，如 `0/1/2/0` | project-review 各级别发现条数（复核后） |
| `--skipped` | `<步骤>: <原因>`，如 `F6: 缺 Redis，集成测试没跑` | 本该做却没做的步骤，每步一条 |
| `--unclear` | `<章节>: <哪条规则、怎么不清楚>`，如 `F4: S 和快速通道的条件重复，不确定要不要都满足` | **最有用的一项**：读不懂、互相矛盾、在这个项目做不到、或你觉得多余的规则；没有就不写 |
| `--feedback` | 一句话 | 用户主动说的抱怨或建议的大意（如「问得太多」「交付说明太长」）；用户没说就不写 |

`<步骤>` / `<章节>` 用 SKILL.md 里的编号（`Step 0`、`F3`、`B2`，project-review 写 `第 3 步`），汇总时按它归类。
