---
name: database-query
description: "Query the project database via SQL and report results. Use when the user asks to run SQL, query tables, look up records, count rows, check statistics, verify data, debug data issues, or explore the database schema (e.g. 帮我查库 / 跑个SQL / 查一下这个表 / 统计数据 / 看看有没有这笔记录 / query the database / run this SQL). Read config.json in this skill directory for connection details; never ask the user to retype credentials. Not for explaining or just writing SQL the user will run elsewhere, and not for changing application code (dev)."
---

# Database Query

查询本项目数据库并结构化返回结果。以**只读查询**为默认原则，任何写操作必须经用户明确确认。

## 连接信息

- 连接配置位于本 skill 目录下的 `config.json`（init 时生成）。使用前先读取它，获取 host / port / database / user / password。
- 密码允许被环境变量 `DB_PASSWORD` 覆盖；不得在对话或日志中明文输出密码。
- 连接失败时如实报告错误，不要臆测原因；不要修改 `config.json` 里的凭据来"修"连接问题。

## Workflow

1. **确认需求**：要查什么、哪个库/表、期望的字段与过滤条件。含糊时先列出可用的表再让用户确认。
2. **读取配置**：读 `config.json`；如有 `references/schema.md` 一并读取（表结构速查）。
3. **选择查询通道**（按可用性优先级）：
   - 环境自带 `mysql` / `psql` 等客户端：直接命令行执行；
   - Java/Maven 工程：用项目已有 JDBC 驱动（如 mysql-connector）写临时查询类运行，用完即删；
   - 以上都不可用时：明确说明当前环境无法直连数据库，给出用户可手动执行的 SQL。
4. **先探测再查询**：首次查不熟悉的表先 `DESCRIBE <table>` / `SHOW CREATE TABLE`，确认字段名与类型；大数据量查询先加 `LIMIT`（默认 100 行），必要时 `EXPLAIN` 检查。
5. **执行并输出**：见输出模板。SQL 语句、耗时、行数一并给出。

## Rules

- **只读优先**：`SELECT` / `SHOW` / `DESCRIBE` / `EXPLAIN`。`INSERT / UPDATE / DELETE / DDL` 等写操作必须：先说清影响（涉及表、行数预估、是否可回滚），得到用户明确同意后执行。
- **生产库谨慎**：不确定的查询先加 `LIMIT`；严禁 `SELECT *` 全表无界扫描（大表先 count 估算）。
- **敏感数据**：涉及手机号、身份证、银行卡等字段时脱敏展示（如 `138****1234`）；查询结果默认不回显密码类字段。
- **时区/编码**：注意库连接时区与显示编码，日期字段按库内存储口径输出并说明。
- **不编造结果**：查询失败或返回空时如实说明，不得虚构数据行。

## Output Template

```
# 查询结果 — <SQL 用途简述>

## SQL
```sql
<实际执行的 SQL>
```
执行耗时：<x> ms ｜ 返回行数：<n>

## 结果
| 列1 | 列2 | ... |
|-----|-----|-----|
| ... | ... | ... |

## 说明
<口径、脱敏情况、未覆盖项、下一步建议>
```

> 单条/少量结果可合并为简洁输出；但 SQL、行数、关键值必须真实可核对。

## Artifact Location

- 查询结果**默认在对话内输出，不落盘**。
- 仅当用户明确要求导出（"导出 CSV / 保存结果"）时，写入项目统一临时产物目录：
  ```
  tmp/skills/database-query/result-<YYYYMMDD-HHmmss>.csv
  ```
- 该目录已被 gitignore，不入库；导出后告知用户文件路径。
