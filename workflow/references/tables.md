# 确定涉及哪些表并核对实际表结构（dev / project-review 共用）

改动或需求碰到数据库时，表名、字段、索引、数据量都是**事实**，自己查，不问用户，也不凭实体类或 DDL 脚本推测线上的样子。先找出涉及哪些表，再只读拉取实际表结构核对。

## 1. 找出涉及哪些表

```
node <skills>/workflow/scripts/tables.mjs --diff <基线>...<dev分支>   # 分支对比
node <skills>/workflow/scripts/tables.mjs [--base <基线>]            # 当前工作区（含未提交），缺省基线取画像 main_branch
node <skills>/workflow/scripts/tables.mjs --files <实体.java>,<Mapper.xml>   # 还没有改动（调研阶段）时，传读到的实体 / Mapper
```

输出每张表的来源（文件:行、`@TableName` / `@Table` / Mapper XML / SQL 字符串 / DDL）：

- `ddl: true`：改动里有建表、改表、删表、建索引，要重点核对；
- `inferred: true`：实体没写表名，按类名转下划线推断的，核对时确认真名（全局表前缀、`@TableName` 的 `keepGlobalPrefix` 等）；
- `in_schema_md`：`database-query/references/schema.md` 里有没有这张表（`null` 表示没有 schema.md）；
- `next`：下一步拉表结构的命令。

脚本按规则扫描，动态表名（`${}` 拼接、分表后缀）、注解以外的 ORM 映射、存储过程认不出来；CodeGraph 可用时再用 `node <skills>/code-graph/scripts/cg.mjs tables [--table <表>]` 看这张表还被哪些 MyBatis 语句用到（不需要索引）。

## 2. 拉取实际表结构（数据库已配置时）

`resolve.mjs status` 的 `database.ok` 为 true 时，运行上一步 `next` 给出的命令：

```
node <skills>/database-query/scripts/query.mjs --schema --tables <表1>,<表2> --indexes [--conn <连接>]
```

只读会话，输出字段（类型、可空、键、默认值、注释）、索引（唯一与否、列顺序）、估算行数，并列出**库里不存在的表**。用它核对：

| 要确认的 | 看什么 |
|---|---|
| 代码 / SQL 引用的字段真实存在、类型与 Java 字段一致 | 字段表 |
| 新查询条件 / 排序 / 关联有索引支撑（联合索引看最左前缀） | 索引表 |
| DDL 会不会锁大表、要不要 Online DDL 或低峰执行 | 估算行数（几十万行以上就要写进上线注意事项） |
| 新增 `NOT NULL` 列的默认值、已有数据如何回填 | 字段表 + 行数 |
| 新建的表确实还不存在、改的表确实存在 | 「库里不存在的表」 |

- 连的是哪个环境由 `config.json` 决定（通常是开发 / 测试库），和线上可能不一致：结论写「已与 <连接名> 核对」。
- 不要查业务数据来判断表结构；需要看数据分布（例如回填影响多少行）时用 `SELECT COUNT(*) ... WHERE ...`，大表先确认有索引条件。
- `--write` 会改 `schema.md`，只在用户要求更新表结构速查时用。
- 退出码 3（本机没有 mysql / psql 客户端）或连接失败：按下一节退回。

## 3. 没有数据库连接时

`database.ok` 为 false 或查询失败：读 `database-query/references/schema.md`（有就用，注意它是导出时的快照，看文件里的导出日期）、项目里的 DDL / 迁移脚本（Flyway、Liquibase 等），并把「未与实际库核对」写进产出：dev 写进交付说明的 SQL 节与未验证项，project-review 写进「未覆盖与待确认」。可以把要执行的 `SHOW CREATE TABLE <表>` / `SHOW INDEX FROM <表>` 给用户，请用户执行后贴回结果。
