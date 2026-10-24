---
name: database-query
description: "Query the project database via SQL and report results. Use when the user asks to run SQL, query tables, look up records, count rows, check statistics, verify data, debug data issues, or explore the database schema (e.g. 帮我查库 / 跑个SQL / 查一下这个表 / 统计数据 / 看看有没有这笔记录 / 查一下测试库 / query the database / run this SQL). Supports several named connections (e.g. dev / test / prod) with read-only enforced at the database session level. Read config.json in this skill directory for connection details; never ask the user to retype credentials. Not for explaining or just writing SQL the user will run elsewhere, and not for changing application code (dev)."
---

# Database Query

**开工能力**：先运行 `node <skills>/workflow/scripts/resolve.mjs status`，按 `<skills>/workflow/references/capabilities.md` 选择本轮能力与模板；同一项目链路复用已有快照，失败统一按该规则处理。

查询本项目数据库并结构化返回结果。默认只读；只读连接上**任何**写操作都不执行。

## 连接配置（config.json）

本 skill 目录下的 `config.json` 由 workflow-run 生成，可以手动增加连接。格式见 `references/config.example.json`：

```json
{
  "default_connection": "dev",
  "connections": {
    "dev":  { "driver": "mysql", "host": "...", "port": 3306, "database": "app", "user": "app_ro", "password_env": "APP_DEV_DB_PASSWORD", "readonly": true },
    "prod": { "driver": "mysql", "host": "...", "port": 3306, "database": "app", "user": "app_ro", "password_env": "APP_PROD_DB_PASSWORD", "readonly": true }
  }
}
```

1. **选连接**：用户点名了（「查测试库」「用 prod」）→ 用对应连接；没点名 → `default_connection`，没有该字段时用 `default`。点名的连接不存在 → 列出已有连接名让用户选，不要猜。
2. **取密码**（按优先级）：`password_env` 指向的环境变量 → 环境变量 `DB_PASSWORD` → `password` 字段。都没有 → 请用户设置环境变量，不要让用户在对话里贴密码。
3. **只读判定**：`readonly` 为 `true` 或**缺省**都按只读处理；只有显式 `"readonly": false` 的连接才允许写操作。
4. 不在对话、日志、命令行参数中明文输出密码：mysql 用 `MYSQL_PWD` 环境变量，psql 用 `PGPASSWORD`。
5. 连接失败如实报告错误；不要修改 `config.json` 里的凭据来「修」连接问题。

## 执行脚本（首选）

```
node <skills>/database-query/scripts/query.mjs [--conn <名称>] [--limit 200] [--timeout 30] [--format md|tsv|json] "<SQL>"
node <skills>/database-query/scripts/query.mjs --list        # 列出连接（不含凭据）
node <skills>/database-query/scripts/query.mjs --schema [--tables a,b] [--write]   # 导出表结构；--write 写入 references/schema.md，先经用户确认
node <skills>/database-query/scripts/query.mjs --schema --tables a,b --indexes     # 另外列出索引、估算行数和库里不存在的表（dev / project-review 核对改动涉及的表时用）
```

`<skills>` 是本 skill 所在的 skills 目录（如 `.agents/skills`）。上面「连接配置」的 1～4 条规则由脚本落实，不要自己拼 mysql / psql 命令：

- **选连接与取密码**：按上面的优先级处理，密码只通过 `MYSQL_PWD` / `PGPASSWORD` 传给客户端，不出现在命令行和输出里。
- **会话层只读**：mysql 加 `--init-command="SET SESSION TRANSACTION READ ONLY"`，psql 加 `PGOPTIONS='-c default_transaction_read_only=on'`。
- **语句拦截**：只读连接上，非 `SELECT` / `SHOW` / `DESCRIBE` / `EXPLAIN` / `WITH` 的语句、多条语句、数据修改型 CTE、`FOR UPDATE`、`INTO OUTFILE` 直接拒绝（退出码 2）。可写连接上的写语句必须加 `--write`，**只在用户明确同意后**才加。
- **自动 LIMIT**：`SELECT` / `WITH` 没写 `LIMIT` 时补 `--limit`（默认 200），超出会标注已截断。
- **超时**：默认 30 秒，PostgreSQL 同时设置 `statement_timeout`。
- **脱敏**：手机号、证件号、银行卡、邮箱等列打码，密码 / token / secret 类列显示 `******`。`config.json` 顶层或连接上可加 `mask_columns`（正则数组）追加列。`--no-mask` 只在用户明确要求看原值时使用。

退出码 3 表示 driver 不是 mysql / postgresql，或本机没有对应客户端。这时退回 JDBC：用项目已有驱动写临时查询类，`conn.setReadOnly(true)`（MySQL 另外执行 `SET SESSION TRANSACTION READ ONLY`），自己遵守上面的拦截、LIMIT、脱敏规则，用完即删。也可以直接给出 SQL，请用户手动执行。

数据库账号本身最好就是只读账号（如 `app_ro`）；会话只读是第二道保险。

## Workflow

1. **确认需求**：查什么、哪个连接 / 库 / 表、期望的字段与过滤条件。含糊时先列出可用的表再让用户确认。
2. **读配置**：读 `config.json`，确定连接；有 `references/schema.md` 一并读取（表结构速查）。
3. **执行**：用 `scripts/query.mjs`；退出码 3 时按上节退回 JDBC 或给出 SQL。
4. **先探测再查询**：不熟悉的表先 `DESCRIBE` / `SHOW CREATE TABLE`；大表依赖脚本自动补的 LIMIT 或自己写更小的 LIMIT，必要时 `EXPLAIN`。
5. **执行并输出**：按输出模板，注明使用的连接名。

## Rules

- **只读连接**：只执行 `SELECT` / `SHOW` / `DESCRIBE` / `EXPLAIN` / `WITH ... SELECT`。用户要求写操作时，说明当前连接是只读的；如需执行，请用户自己在 `config.json` 中配置一个 `"readonly": false` 的连接并点名使用。**不要**为了执行写操作临时修改 `readonly`。
- **可写连接**：`INSERT / UPDATE / DELETE / DDL` 前先说清影响（涉及表、预估行数、能否回滚），得到用户明确同意后执行；连接名像生产（`prod`、`production`、`online`）时再确认一次。
- **大表**：不确定的查询先加 `LIMIT`；不做无界 `SELECT *` 全表扫描（先 `count` 估算）。
- **敏感数据**：手机号、身份证、银行卡等字段脱敏展示（如 `138****1234`）；不回显密码类字段。
- **时区 / 编码**：日期按库内存储口径输出并注明时区。
- **不编造结果**：查询失败或返回空时如实说明。

## Output Template

```
# 查询结果 — <SQL 用途简述>

连接：<连接名>（<只读 / 可写>）

## SQL
```sql
<实际执行的 SQL>
```
执行耗时：<x> ms ｜ 返回行数：<n>

## 结果
| 列1 | 列2 | ... |
|-----|-----|-----|

## 说明
<口径、脱敏情况、未覆盖项、下一步建议>
```

> 单条 / 少量结果可以简化输出；但 SQL、连接名、行数、关键值必须真实可核对。

## Artifact Location

- 查询结果默认只在对话内输出，不落盘。
- 用户明确要求导出时写入 `workflow-run/tmp/database-query/result-<YYYYMMDD-HHmmss>.csv`（已被 gitignore），并告知路径。

## 终端命令

本 skill 给出的 `node …`、`git …` 命令在 bash、zsh、PowerShell 里写法一样，原样运行即可。需要自己写其他终端命令时，先看本机的系统和终端：`node <skills>/workflow/scripts/resolve.mjs env`（安装时记录，一次对话查一次就够；`resolve.mjs profile` / `status` 的输出里也带着 `env`；没装 workflow skill 时没有这条命令，按你所在的环境写）。按输出的 `os`、`shell`、`note` 写命令，不要再用 `uname`、`$PSVersionTable`、`ver` 之类去探测。
