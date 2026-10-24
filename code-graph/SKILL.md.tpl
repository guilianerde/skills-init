---
name: code-graph
description: "Answer structural questions about this project's source code from a pre-built code graph (CodeGraph index in .codegraph/): blast radius of a branch diff or of one method (which HTTP routes, MQ consumers, scheduled jobs, tests, SQL tables and config keys are reached), who calls a method, where an MQ topic is produced and consumed, which scheduled jobs exist, which MyBatis statements touch a table. Use when the user asks 改这个会影响哪些接口 / 这个分支的影响面 / 谁调用了这个方法 / 这个方法从哪些入口进来 / 这个 topic 谁在发谁在消费 / 有哪些定时任务 / 这张表在哪些 SQL 里用到 / 影响面分析 / blast radius / who calls X / impact of this change. Also used by dev, project-review and the doc skills for impact analysis. Read-only. Not for changing code (dev), full code review (project-review) or querying table data (database-query)."
---

# Code Graph

**开工能力**：先运行 `node <skills>/workflow/scripts/resolve.mjs status`，按 `<skills>/workflow/references/capabilities.md` 选择本轮能力与模板；同一项目链路复用已有快照，失败统一按该规则处理。

在 [CodeGraph](https://github.com/colbymchenry/codegraph) 代码图谱之上回答「代码结构」类问题：影响面、调用方、入口、MQ、定时任务、SQL 涉及的表。脚本 `scripts/cg.mjs` 直接调用 CodeGraph 的库，并补上它看不到的 Java / Spring 关联。只读：不建索引、不改代码。

## 命令

| 问题 | 命令 |
|---|---|
| 这个分支改动的影响面 | `cg.mjs impact --diff <main>...<dev>`（`<dev>` 须是当前检出的分支；否则先切过去） |
| 我还没提交的改动影响哪些地方 | `cg.mjs impact --base <main>`（分叉点到工作区，含未提交和未跟踪的新文件） |
| 这个方法从哪些入口进来 | `cg.mjs entry <Class.method> [--file <路径片段>]` |
| 这个 topic 谁发谁消费 | `cg.mjs mq [--topic <名>]` |
| 有哪些定时任务 | `cg.mjs jobs` |
| 这张表在哪些 SQL 里 | `cg.mjs tables [--table <表>]` |
| 读一块功能的源码与调用链 | MCP 工具 `codegraph_explore`，或 `codegraph explore "<问题>"` |

`impact` 输出：

- `changed`：改动的方法 / 配置常量 / XML 语句
- `entry_points`：受影响的入口
  - `routes`：HTTP 接口
  - `mq_consumers`：MQ 消费者（含 topic）
  - `jobs`：定时任务
- `affected`：受影响的其他代码，按文件列出
- `tests`：受影响和改动过的测试
- `sql`：改动代码向下调用到的 MyBatis 语句，以及它们涉及的表
- `config_keys`：改动的 `@Value` 配置 key
- `removed_files`：删除的文件
- `warnings` / `limits`：提示和分析的局限

`--depth` 控制向上追几层调用方，默认 3。

## 怎么用结果回答

1. **按入口归纳**：先说受影响的接口、消费者、定时任务（这是测试和上线要回归的），再说表和配置，最后列受影响的代码文件。每条带 `文件:行号`。
2. **说清楚看不到的部分**：静态分析看不到 Spring 多实现的选择、AOP、反射、配置驱动的路由；删除的方法不在索引里（看 `removed_files` 和 diff，用 grep 找残留调用）。`entry_points` 为空**不等于**没有影响，要写「图谱未找到入口，需人工确认」。
3. **topic 是变量时**：`mq` 的 `literal: false` 表示 topic 写成了常量 / 配置，按名字 grep 出真实值再归并。
4. `warnings` 里有「不是当前检出的提交」「索引落后」时，把它告诉用户，结论标「可能不完整」。

## Rules

- 只读：不运行 `codegraph init` / `index` / `uninit` / `install` / `uninstall` / `telemetry`；`cg.mjs` 只在索引落后于工作区时调用 `codegraph sync` 做增量同步。
- 结论必须能落到 `文件:行号`；图谱给不出的不要编。
- 不输出源码以外的敏感信息（配置值、密钥）；`config_keys` 只列 key。

## 终端命令

本 skill 给出的 `node …`、`git …` 命令在 bash、zsh、PowerShell 里写法一样，原样运行即可。需要自己写其他终端命令时，先看本机的系统和终端：`node <skills>/workflow/scripts/resolve.mjs env`（安装时记录，一次对话查一次就够；`resolve.mjs profile` / `status` 的输出里也带着 `env`）。按输出的 `os`、`shell`、`note` 写命令，不要再用 `uname`、`$PSVersionTable`、`ver` 之类去探测。
