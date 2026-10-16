# CodeGraph：用代码图谱读代码

[CodeGraph](https://github.com/colbymchenry/codegraph) 把项目预先解析成本地的代码知识图谱（符号、调用边、继承 / 实现、Spring 等框架的路由），查询一次就拿到相关源码、调用路径和影响面，不用一个个文件 grep、Read。可用性看 `node <skills>/workflow/scripts/resolve.mjs status` 的 `codegraph.ok`（本项目有 `.codegraph/` 索引且 `codegraph` 命令可用）。不可用时照常用 grep / 读文件，不阻塞流程。

## 优先用 code-graph skill 的脚本

影响面、入口、MQ、定时任务、表这几类问题，先用 `node <skills>/code-graph/scripts/cg.mjs`（见 `<skills>/code-graph/SKILL.md`）：它直接调 CodeGraph 的库，一次给出改动符号 → 受影响的接口 / MQ 消费者 / 定时任务 / 测试 / 表 / 配置 key，并补上 CodeGraph 看不到的 MQ topic、定时任务和 MyBatis XML 里的表。

| 场景 | 命令 |
|---|---|
| 分支改动的影响面 | `cg.mjs impact --diff <main>...<dev>`（`<dev>` 为当前检出） |
| 未提交改动的影响面 | `cg.mjs impact --base <main>` |
| 一个方法从哪些入口进来 | `cg.mjs entry <Class.method>` |
| topic / 定时任务 / 表 | `cg.mjs mq` / `jobs` / `tables`（只扫源码，没有索引也能用） |

`cg.mjs` 退出码 2（没有索引、找不到库、Node < 22.5）时，改用下面的 CodeGraph 原生工具或 grep。

## 读代码：CodeGraph 原生工具

- **有 MCP 工具时**（Claude Code / Codex 经 `--with-codegraph` 写了配置）：用 `codegraph_explore`，一次调用返回相关符号的源码（带行号）、调用路径和影响面摘要。问题里点名类名 / 方法名 / 文件，结果更准。
- **没有 MCP 工具时**（doubao、qwen、子 agent，或 MCP 没加载）：在项目根用同名 CLI，输出相同：

| 要做的事 | 命令 |
|---|---|
| 了解一块功能 / 一条链路怎么走 | `codegraph explore "<问题，带上类名、接口路径、业务名词>"` |
| 读一个符号的源码和它的调用方 | `codegraph node <Class.method 或文件>` |
| 谁调用了它 | `codegraph callers <symbol> --json` |
| 它调用了谁 | `codegraph callees <symbol> --json` |
| 改它会影响哪些代码 | `codegraph impact <symbol> --depth 2 --json`（同名多个定义时加 `--file <路径>`） |
| 改了哪些文件 → 该跑哪些测试 | `git diff --name-only <base>...HEAD \| codegraph affected --stdin --json` |
| 按名字找符号 | `codegraph query <name> --json` |

## 用法约定

- **结论仍要有出处**：引用图谱返回的「文件:行号」和源码，和自己读文件的要求一样。返回结果顶部有 `⚠️` 过期提示（文件刚改过、索引还没同步）时，直接读那个文件。
- **图谱看不到的地方要另外查**：静态分析看不到运行时才确定的调用——Spring 多实现的选择、AOP、反射、配置驱动的路由。CodeGraph 能把 MyBatis XML 语句关联到 Mapper 接口、识别 `@Value` 配置 key 和 Spring 路由；MQ topic 的收发、定时任务入口、XML 语句涉及的表由 `cg.mjs` 补上（`mq` / `jobs` / `tables`，也包含在 `impact` 里）。图谱里「没有调用方」**不等于没人用**，在影响面里仍按「未确认」处理，除非 grep 也确认没有。
- **不替用户建索引**：没有 `.codegraph/` 时不要运行 `codegraph init` / `index`，是否建索引由用户决定；在交付或报告里注明「未使用代码图谱」即可。
- **只读**：skill 只用查询类命令，不运行 `install`、`uninstall`、`uninit`、`telemetry`、`upgrade`。

## 各 skill 用在哪

| skill | 环节 | 用法 |
|---|---|---|
| dev | F2 现状调研 | `explore` 从入口沿调用链读到持久层；找同类实现作参照 |
| dev | F3 需求澄清 | 推荐答案依据的「现状事实」从图谱取，引用文件:行号 |
| dev | F5 实现前 | 改公共方法 / 接口签名前 `cg.mjs entry <符号>`，把会被波及的入口和调用方列进改动范围 |
| dev | F6 验证 | `cg.mjs impact --base <main>` 的 `tests` 先跑（`profile.test_single`），再跑全量 |
| project-review | 第 3 步分批 | `cg.mjs impact --diff` 的入口和 `sql` 帮助排 P0 / P1 |
| project-review | 第 5 步影响面 | `cg.mjs impact --diff` 列受影响的接口 / 消费者 / 定时任务 / 表；Spring 注入、AOP、反射照常 grep |
| create-tech-md-doc | 影响范围 / 接口 / 中间件类章节 | `cg.mjs impact --diff` 的入口、`sql`、`config_keys` 归并到影响范围、接口、中间件变更 |
| create-release-md-doc | 中间件上线 / 上线后验证 / 监控类章节 | `cg.mjs impact --diff` 的 `sql` / `config_keys` 对照中间件上线，入口用于上线后验证和监控 |
