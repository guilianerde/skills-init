---
name: database-query
description: "Query the project database via SQL and report results. Use when the user asks to run SQL, query tables, look up records, count rows, check statistics, verify data, debug data issues, or explore the database schema (e.g. 帮我查库 / 跑个SQL / 查一下这个表 / 统计数据 / 看看有没有这笔记录 / 查一下测试库 / query the database / run this SQL). Supports several named connections (e.g. dev / test / prod) with read-only enforced at the database session level. Read config.json in this skill directory for connection details; never ask the user to retype credentials. Not for explaining or just writing SQL the user will run elsewhere, and not for changing application code (dev)."
---

# Database Query

查询本项目数据库并结构化返回结果。默认只读；只读连接上**任何**写操作都不执行。

## 连接配置（config.json）

本 skill 目录下的 `config.json` 由 skills-init 生成，可以手动增加连接。格式见 `references/config.example.json`：

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

## 只读的落实方式

只读连接必须在数据库会话层面开启只读，而不是只靠自觉：

| 通道 | 做法 |
|---|---|
| mysql 客户端 | `MYSQL_PWD=... mysql -h <host> -P <port> -u <user> <db> --init-command="SET SESSION TRANSACTION READ ONLY" -e "<SQL>"` |
| psql | `PGPASSWORD=... PGOPTIONS='-c default_transaction_read_only=on' psql -h <host> -p <port> -U <user> -d <db> -c "<SQL>"` |
| JDBC 临时查询类 | `conn.setReadOnly(true)`；MySQL 另外执行 `SET SESSION TRANSACTION READ ONLY` |

数据库账号本身最好就是只读账号（如 `app_ro`）；会话只读是第二道保险。

## Workflow

1. **确认需求**：查什么、哪个连接 / 库 / 表、期望的字段与过滤条件。含糊时先列出可用的表再让用户确认。
2. **读配置**：读 `config.json`，确定连接；有 `references/schema.md` 一并读取（表结构速查）。
3. **选查询通道**（按可用性）：本机有 `mysql` / `psql` 客户端 → 命令行执行；Java 工程 → 用项目已有 JDBC 驱动写临时查询类，用完即删；都不可用 → 说明无法直连，给出用户可手动执行的 SQL。
4. **先探测再查询**：不熟悉的表先 `DESCRIBE` / `SHOW CREATE TABLE`；大表先加 `LIMIT`（默认 100 行），必要时 `EXPLAIN`。
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
- 用户明确要求导出时写入 `tmp/skills/database-query/result-<YYYYMMDD-HHmmss>.csv`（已被 gitignore），并告知路径。
