# 外部能力集成

[返回首页](../README.md) · [安装与升级](installation.md) · [工作流与命令](workflows.md) · [团队共享、产物与模板](team-guide.md) · [维护、测试与发布](development.md)

## Nacos 配置读取（nacos-config）

独立 skill，默认随全量安装，也可用 `npx @rowansenne/workflow-run --skills nacos-config --envs codex --yes --skip-db` 单独安装。可直接请求「读取测试环境 Nacos 的 order-test.yaml，查看 order.timeout」，开发和审查也可按需调用。

```text
node .agents/skills/nacos-config/scripts/config.mjs inspect
node .agents/skills/nacos-config/scripts/config.mjs get --file src/main/resources/bootstrap.yml --file src/main/resources/application-test.yml --data-id order-test.yaml --key order.timeout
```

首次读取 YAML 如缺少依赖，运行 `npm install --prefix .agents/skills/nacos-config --ignore-scripts --no-package-lock`。支持 application / bootstrap 的 YAML、properties、环境变量及本地属性占位符；多环境不自动猜选。也可配置本机 `nacos-config/config.json` 多连接并用 `--conn test` 选择，该文件和本 skill 的依赖目录由安装器加入 gitignore，重装保留配置。密码 / token 使用环境变量，不接受命令行明文凭据。

真实目录与 Claude / Qwen / WorkBuddy 的默认软链接入口均可运行。多个 profile 可传 `--profile test,local`，匹配任一条件文档并按文件 / 文档顺序覆盖；包含多个 `@` 的普通密码可用。Oracle Thin / OCI 连接串包含内嵌凭据时整值脱敏，详细规则见连接说明。

按明确的 Namespace / Group / Data ID 获取单个配置，支持 Nacos 1.x / 2.x 兼容 API（默认 `1`）、2.x API（`--api-version 2`）和 3.x Client API（`--api-version 3`），输出脱敏属性和读取来源。只允许配置 GET 与登录 POST，不发布、不删除、不自动写入数据库连接；不模拟 Spring 完整的配置合并与运行时最终值。连接格式与协议说明见 [nacos-config/references/connection.md](../nacos-config/references/connection.md)。

## DocNexus 文档库（必装）

接入支持 `--output-dir` 的 DocNexus format 7，在**业务项目根**执行安装和初始化：

```bash
npm install --prefix ./.docnexus --save-exact @rowansenne/docnexus
./.docnexus/node_modules/.bin/docnexus init --output-dir workflow-run --agent none
```

`workflow-run` 自动补齐 DocNexus 接入，并链接所选 Agent 的 skills、写入项目说明、导入文档模板。

### 运行环境与知识输出

```text
<业务项目>/
├── .docnexus/                       # npm 运行环境与内部状态
│   ├── package.json / package-lock.json
│   ├── project.json                 # format_version=7，output_dir=workflow-run
│   ├── node_modules/                # CLI 和依赖
│   ├── skills/ / schemas/
│   └── drafts/ / store/ / .runtime/
└── workflow-run/
    ├── docnexus/                    # 知识输出，内部不安装 npm
    │   ├── CONCEPTS.md / concepts/
    │   └── library/ / records/ / impacts/
    ├── docs/requirements/           # 工作流产物
    ├── other/                       # 普通聊天生成的辅助文件，按需创建
    └── tmp/
```

所有 DocNexus 命令均从业务项目根运行，CLI 返回的路径直接用于读取和引用，不添加或删除前缀：

```bash
node .agents/skills/workflow/scripts/docnexus.mjs status
node .agents/skills/workflow/scripts/docnexus.mjs view
node .agents/skills/workflow/scripts/docnexus.mjs usage export > workflow-run/docnexus-usage.json
```

`status` 返回 `workspace_path`、`library_path`、`internal_directory`。知识输出固定为 `workflow-run/docnexus/`；草稿与辅助脚本位于 `.docnexus/`。模板保存在 `workflow-run/docnexus/library/templates/<skill>/`。

| 环境 | DocNexus skill 入口 | 项目说明 |
| --- | --- | --- |
| claude | `.claude/skills/` → `.docnexus/skills/` | `CLAUDE.md` |
| codex / doubao | `.agents/skills/` → `.docnexus/skills/` | `AGENTS.md` |
| workbuddy | `.codebuddy/skills/` → `.docnexus/skills/` | `AGENTS.md` |
| qwen | `.qwen/skills/` → `.docnexus/skills/` | `QWEN.md` |

升级 / 重装刷新入口与说明，不改手写段落。知识写入仍走 DocNexus 的授权与 capture 流程。普通 `uninstall` 移除 Agent 入口和说明，保留 `.docnexus/` 运行环境与知识输出。

`.docnexus/.gitignore` 由 DocNexus 维护，忽略运行依赖、索引、草稿和内置资源；`.docnexus/project.json`、npm 清单和锁文件应随代码提交。知识输出随 `workflow-run/` 提交；独立文档仓库模式下只在文档仓库提交知识，本项目仍保存自己的 `.docnexus/` 配置和运行环境。

### 破坏性更新：旧布局强制清理

本次不兼容旧 DocNexus，不迁移、不备份旧知识。`init` / `upgrade` 在安装前强制删除：

- 旧版 `workflow-run/docnexus/`（含旧 `project.json`、npm / skills / store 等内部文件的布局）；
- 嵌套的 `workflow-run/.docnexus/` 及 `workflow-run/tmp/duplicate-docnexus/` 旧备份；
- 能识别的根目录旧 `docnexus/` 安装、旧 Agent 链接与不兼容的内部项目状态。

新版知识输出不含这些旧内部文件，后续重装 / 升级会保留新版 `library/`、`records/` 等知识。工作流的需求文档、其他临时文件和普通同名业务目录保留。清理失败会停止；npm / init 失败返回非零。

已安装项目重新接入：

```bash
npx @rowansenne/workflow-run upgrade --with-docnexus
```

新项目用 `npx @rowansenne/workflow-run`，自动安装必需的 DocNexus。默认从 npm 安装最新版（`@rowansenne/docnexus@latest`），接入和升级都取最新版；离线或本地验证可设 `DOCNEXUS_PKG=/path/to/package-or-source` 指定安装来源（此时不再追加 `@latest`），必须使用支持 format 7 和 `--output-dir` 的版本。

## CodeGraph 代码图谱与 code-graph skill（可选）

[CodeGraph](https://github.com/colbymchenry/codegraph)（MIT，100% 本地）把项目预先解析成代码知识图谱。图谱里有：
- 符号、调用边、继承 / 实现（含接口到实现的调用）；
- Spring 路由；
- MyBatis XML 语句与 Mapper 接口的对应；
- `@Value` 配置 key。

本项目的集成分两层：

- **CodeGraph 本身（外部依赖）**：解析与图谱由上游维护。全局装一份，各项目各建索引 `.codegraph/`；Claude Code / Codex 还能直接用它的 MCP 工具 `codegraph_explore` 读代码。
- **code-graph skill（自己的封装）**：`code-graph/scripts/cg.mjs` 调用 CodeGraph 的库（`CodeGraph.openSync` / `getNodesInFile` / `getCallers` / `getCallees`），面向本工作流做查询，并补上 CodeGraph 看不到的 Java / Spring 关联：

| 命令 | 作用 |
|---|---|
| `cg.mjs impact --diff <main>...<dev>` / `--base <main>` | 从 diff 找到改动的方法、配置常量、XML 语句，向上追调用方（默认 3 层），一次给出：受影响的 **HTTP 接口**、**MQ 消费者**（含 topic）、**定时任务**；受影响的代码文件；受影响和改动过的**测试**；向下调用到的 **SQL 语句与表**；改动的**配置 key**；删除的文件 |
| `cg.mjs entry <Class.method>` | 一个方法向上能到达哪些入口（接口、消费者、定时任务），以及哪些测试覆盖它 |
| `cg.mjs mq [--topic t]` | topic 的消费方（`@KafkaListener`、`@RabbitListener`、`@RocketMQMessageListener`、`@JmsListener`、`@StreamListener`）与生产方（`*Template.send/convertAndSend/syncSend…`） |
| `cg.mjs jobs` | `@Scheduled`、`@XxlJob` 定时任务入口 |
| `cg.mjs tables [--table t]` | MyBatis XML 语句（namespace.id）涉及的表 |
| `cg.mjs status` | 索引与库是否可用 |

`mq`、`jobs`、`tables` 只扫源码，没有索引也能用。`impact`、`entry` 需要 `.codegraph/` 索引和 CodeGraph 的库（Node >= 22.5）；开工快照区分 script / cli / source，Skill 按共享规则选择一次，不逐步试错。

dev、project-review、技术方案、上线方案都在对应环节调用它：
- **dev**：改公共方法前看入口；验证时先跑受影响的测试；交付说明里写受影响的接口 / 表 / 配置。
- **project-review**：「影响面」按入口归纳。
- **技术方案、上线方案**：影响范围、中间件上线、回归验证参考 `impact` 的结果。

用法约定见 `workflow/references/codegraph.md`。

### 安装：`--with-codegraph`

加 `--with-codegraph` 时，装完 skills 后额外执行：

1. 找不到 `codegraph` 命令时执行 `npm i -g @colbymchenry/codegraph@1`。全局装 CLI 和库（平台包约 300MB，所以不在每个项目里各装一份）；code-graph skill 按 1.x 的库接口编写。
2. 所选环境里有 claude / codex 时，执行 `codegraph install --target=<claude,codex> --location=local --yes`，把 MCP 配置写进本项目：
   - claude：`.mcp.json`、`.claude/settings.json`（自动放行 `codegraph_explore`）、`.claude/CLAUDE.md`；
   - codex：`.codex/config.toml`、`AGENTS.md`；Codex 只在受信任的项目里加载项目级配置。
   - doubao、qwen、workbuddy 不在 CodeGraph 支持的 agent 里，在这些环境用 code-graph skill 和 `codegraph` CLI。
3. 执行 `codegraph init <项目根> --yes` 建索引，生成 `.codegraph/`（本地 SQLite），并把它加入 `.gitignore`。之后 agent 使用期间自动增量同步；`cg.mjs` 发现索引落后于工作区时也会先 `codegraph sync`。

* 能力探测：`resolve.mjs status` 的 `codegraph`（`ok` = 有 `.codegraph/` 且 `codegraph` 命令可用）。`/workflow status` 和 `doctor` 都会显示。
* 没有 `.codegraph/` 时，skills **不会自己建索引**，只在交付或报告里注明「未使用代码图谱」。要不要建索引由你决定。
* 本工具和 `cg.mjs` 调用 codegraph 时都带 `DO_NOT_TRACK=1`。但 CodeGraph 自身默认上报匿名使用统计（不含代码、路径、符号名），`--yes` 不会询问；需要关闭时运行 `codegraph telemetry off`。
* 静态分析的局限：Spring 多实现的选择、AOP、反射、配置驱动的路由看不到；图谱里「没有调用方」不等于没人用。
* 卸载：`codegraph uninstall` 移除 agent 配置和 CLI，`codegraph uninit` 删除本项目的索引。

## wiki 能力说明（连接空着不启动）


* `md-to-wiki` 带 **GATE**：执行前先读 `wiki-config.json`，若文件缺失 / `enabled` 非 true /

  `base_url` 为空 → **立即停止**，提示用户补配，不做任何转换与上传。

* `create-tech-md-doc` / `create-release-md-doc` 的 `--prd`**&#x20;增强**同样受 GATE 约束：

  未配置时自动回退纯 diff 流程（文档生成主流程不受影响）。

* 启用方式（三选一）：

1. 填写 `md-to-wiki/wiki-config.json`：`enabled: true` + `base_url`（如

   `https://wiki.example.com`）+ `api_token`（Confluence PAT）；

2. 环境接入 Confluence MCP（如 Claude Code 的 `wiki-mcp`），SKILL.md 会优先走 MCP 通道；

3. 同时保留 `remote_url` 字段记录远程 MCP 地址（可选）。

* 上传通道自动选择：环境有 wiki MCP 工具 → 用工具；否则用 `wiki-config.json` 的 REST 参数

  调 Confluence REST API。
