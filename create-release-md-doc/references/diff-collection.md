# diff 分层采集与事实抽取

## 基线

- 一律用三点 `git diff <main>...<dev>`：比较 dev 相对两分支合并基点（merge-base）的改动。两点 `<main>..<dev>` 等价于直接比较两个分支末端，主干前进后会把主干的新提交以「反向删除」混进文档。
- 统计行：`git diff <main>...<dev> --shortstat`，写进文档元信息。

## 分层过滤（每层独立，可并行）

先用 `--name-only` 列文件，再按需读具体 diff，避免整份 diff 灌进上下文。下表以 Java/Spring 工程为默认；其他技术栈按实际目录调整（如 Go 的 `internal/handler`、前端的 `src/api`）。

| 层 | 命令（路径过滤） | 用途 | 喂给模块 |
|---|---|---|---|
| 1. 接口入口 | `git diff <main>...<dev> --name-only -- '**/controller/**'` | 接口验证 | 四 上线后技术验证 |
| 2. 业务逻辑 | `-- '**/service/**'`（排除 `*Test*`） | 业务影响 | 一 改动范围 |
| 3. SQL 脚本 | `-- '*.sql' '**/db/**' '**/migration/**'` | DDL | 二 中间件上线 |
| 4. 配置 | `-- '**/application*.yml' '*.properties' 'bootstrap*.yml'` | 配置中心 / 开关 | 二 |
| 5. 构建文件 | `-- 'pom.xml' '**/pom.xml' 'build.gradle*' 'package.json' 'go.mod'` | 依赖 | 二 |
| 6. 定时任务 | `-- '**/job/**' '**/*Job.java'`；`profile.job_annotation` 非空时按该注解识别 | 定时任务 | 五 监控方案 |
| 7. 消息 | 在 diff 中 grep `@KafkaListener`、`KafkaTemplate`、`Topic` 等 | topic 监控 | 五 |

- 排除：`src/test/**`、`**/generated/**`、`**/target/**`、`*.md`、`*.txt`（用户明确要求除外）。
- 巨量兜底：单层 > 200 个文件 → 只取 `--stat` + 每个文件 diff 前 80 行摘要，文档标注「⚠️ 已摘要化」；单层 > 500 且无法再过滤 → 停，请用户缩小范围。

## 复用技术方案（--tech）

传入 `--tech <path>` 时先解析该技术方案：模块 4 接口表、模块 5 服务表、模块 6 DDL、模块 7 表名 → `tech_context`。对应层直接复用 `tech_context`，跳过该层 diff 采集；技术方案里标「待补充」的项仍按 diff 采集。

## 事实抽取规则

- **接口**：路径 + 方法，用于生成上线后验证用例。
- **改动范围**：受影响的模块 / 包名汇总。
- **实体新增字段**：字段名 + 类型 + 列映射注解（如 `@TableField`）。
- **DDL**：`CREATE / ALTER TABLE` 原样保留；表名进 2.3（`profile.data_review` 为 true 时）。
- **db_name 推断**（按优先级）：① SQL `USE <db>`；② datasource url 中的库名；③ 表名前缀（标「待人工确认」）。
- **消息**：topic + 方向 + payload 字段。
- **配置**：新增 key + 值；`profile.config_center` 非空时注明需在该配置中心下发。
- 只写 diff 中可见的事实，看不到的写「待补充」，不要编造业务语义。
