<!--
  template.md — create-tech-md-doc skill 的文档模板
  结构来源：团队 Confluence 技术方案模板（8 模块）
  项目相关字段（发布平台 / 环境 / 配置中心 / 定时任务注解 / 数据评审）取自 workflow/profile.json，未配置的部分按「待填写」输出
  始终填充模块：2/3/4/5/6/8
  条件填充模块：1（需求背景）、7（数据链路）— 有 --prd 时从 PRD 填充，无 --prd 时模块1留空待人工、模块7从 diff 推断
  标题层级：一、开发部分 = h1（#），子模块 = h2（##），对齐 Confluence 样例
-->

# 【技术方案】<在此填写需求标题>

> **自动生成** by `create-tech-md-doc` skill | 生成时间：{{生成时间}}
> 对比分支：`{{devBranch}}` ←→ `{{mainBranch}}`（主分支为基线）
> diff 概览：{{files}} files changed, {{insertions}} insertions(+), {{deletions}} deletions(-)
> PRD 参考：{{pageId 或 URL 或「无」}}
> 填充模块：2/3/4/5/6/8 +（有 PRD 时）1/7（无 PRD 时模块 1 需求背景需人工补充，模块 7 数据链路从 diff 推断）
> ⚠️ 内容基于代码 diff 推断，业务语义/PRD 链接需人工校对后补充。

---

# 一、开发部分

## 1. 需求背景 *

{{#if prd_context}}
（来自 PRD：{{prd_context.pageUrl}}）
- 需求标题：{{prd_context.title}}
- 业务背景：{{prd_context.background 摘要，不堆砌原文}}
- 功能点摘要：
{{#each prd_context.features}}
  - {{this.name}}：{{this.desc}}
{{/each}}
{{else}}
> **【留空 — 待人工补充】**
> 关联需求（PRD 链接）：
> 需求单链接：
> （未传入 --prd，diff 无法推断业务背景，需人工填写）
{{/if}}

## 2. 影响范围 *

{{从 diff 各层命中的模块/包名汇总，列出受影响的功能域}}
示例格式：
- 首页 / 列表接口 / 回调处理 / 后台配置
- 涉及包路径：`com.example.app.controller.xxx`、`com.example.app.service.xxx`

## 3. 详细方案 *

（流程，时序，上下游交互）

{{按 diff 中 Service 层的新增/修改方法组织，说明业务流程}}
- 新增/修改的 Service 方法及其职责（从方法名+注释推断，不臆造）
- 调用关系（上下游）
- 关键时序步骤
{{#if prd_context}}
- 业务语义补充（来源 PRD）：{{prd_context.features 与 diff 对应的功能点说明}}
{{/if}}

## 4. 接口文档 *

(HTTP接口/kafka协议/埋点协议)
(下游依赖接口文档)

### 4.1 HTTP 接口

| 接口 | 方法 | 描述 | 变更说明 |
|------|------|------|----------|
| `{{path}}` | POST/GET | {{描述}} | {{从 Controller diff 提取的入参/出参/字段变更}} |

### 4.2 字段变更示例（如有）

{{从 DTO/VO diff 提取新增字段，生成 JSON 示例}}
```json
// {{接口路径}} 新增/变更字段
{
    "{{fieldName}}": {{推断类型示例值}}
}
```

### 4.3 下游依赖接口（如有）

> 【待补充】diff 无法推断下游依赖，需人工填写本次调用的新增下游接口文档。

### 4.4 Kafka 协议（如有）

| Topic | 方向 | 描述 | payload 关键字段 |
|-------|------|------|------------------|
| `{{topic}}` | 生产/消费 | {{描述}} | {{字段}} |

## 5. 涉及服务 *

> （必填）

| 服务名 | 环境 | 仓库 | 主分支 | 开发分支 |
|--------|------|------|--------|----------|
| {{从 git remote 推断的服务名}} | {{环境}} | {{git remote 仓库地址}} | {{mainBranch}} | {{devBranch}} |

参数说明（发布平台与可选环境取自 `workflow/profile.json` 的 `deploy`；未配置时按「待填写」输出）：
- 服务名：{{profile.deploy.platform}} 上的生产环境服务名
- 环境：可选值 {{profile.deploy.regions，逗号分隔；为空写「待填写」}}
- 仓库：git remote 地址（`git remote get-url origin`）
- 主分支：仓库主分支（profile.main_branch，或 main / master）
- 开发分支：当前 dev 分支名

## 6. 中间件变更

(db、redis、定时任务、其他中间件变更方案)

### 6.1 DB 变更

{{从 SQL 脚本 diff + Entity 新增字段提取，DDL 原样保留}}

```sql
-- 新建/修改表（从 diff 中的 .sql 文件提取）
{{CREATE TABLE / ALTER TABLE 语句}}
```

新增实体字段（从 Entity diff 提取）：
| 表名 | 字段名 | 类型 | 注释 |
|------|--------|------|------|
| {{table}} | {{field}} | {{type}} | {{comment}} |

### 6.2 Redis 变更（如有）

{{从配置 diff + 代码中的缓存 key 常量 / 前缀定义推断}}
- 新增 key：`{{key}}`，用途：{{用途}}

### 6.3 定时任务变更（如有）

{{从 job/** 包 diff 提取；profile.job_annotation 非空时按该注解（如 @XxlJob / @Scheduled）识别任务类}}
- 新增/修改任务：{{类名}} - {{cron/描述}}

### 6.4 依赖变更（如有）

{{从构建文件 diff 提取：pom.xml / build.gradle / package.json / go.mod 等}}
- 新增依赖：`{{groupId}}:{{artifactId}}:{{version}}`

## 7. 数据链路

<!-- 仅当 profile.data_review 为 true 时填写 db_name / table_name 评审块；为 false 或未配置时本模块只列涉及的表即可 -->

{{#if prd_context}}
{{#if prd_context.tables}}
> PRD 提及的数据表（来自 {{prd_context.pageUrl}}，需数据团队核对）

```
db_name：{{从 SQL/datasource 推断，PRD 提及则优先}}
table_name：
- {{prd_context.tables 列表，从 PRD 提及}}
是否需要评审：是/否
```
{{else}}
> **【待人工补充】**
> PRD 未提及具体表名，需人工填写。
> 数据评审信息：请填写本次需求修改的数据库名、表名

```
db_name：{{从 SQL USE 语句 / application.yml datasource url / 表名前缀推断，不确定标"待人工确认"}}
table_name：
- {{从 SQL CREATE TABLE / ALTER TABLE / Entity @TableName 提取}}
是否需要评审：是/否
```
{{/if}}
{{else}}
> 数据评审信息：请填写本次需求修改的数据库名、表名
> 无 --prd 时 db_name 从 diff 推断（SQL/datasource/Entity @TableName），不确定处标"待人工确认"

```
db_name：{{从 SQL USE 语句 / application.yml datasource url / 表名前缀推断，不确定标"待人工确认"}}
table_name：
- {{从 SQL CREATE TABLE / ALTER TABLE / Entity @TableName 提取}}
是否需要评审：是/否
```
{{/if}}

## 8. 兼容问题&方案

(历史数据、历史页面)

{{从 diff 推断兼容性风险}}
- 新增字段是否 NOT NULL / 是否有默认值 → 历史数据填充策略
- 接口是否新增必填参数 → 旧客户端是否兼容
- 是否删除/重命名字段 → 调用方是否已同步
- 配置项变更 → 是否需要灰度/回滚方案
{{#if prd_context}}

### 8.x PRD 对齐缺口（来源 PRD 校验，Step 2b）

⚠️ **对齐缺口**（PRD 提及但 diff 未实现，请核对是否漏实现/在别的分支）：
{{#each alignment_gaps}}
- {{this.prd_feature}} → diff 无对应实现
{{/each}}
{{#unless alignment_gaps}}
- （无）PRD 功能点与 diff 实现均对齐
{{/unless}}

📌 **实现超出 PRD**（diff 实现了但 PRD 未覆盖，请核对 PRD 是否遗漏）：
{{#each extra_impls}}
- {{this.code_symbol}} → PRD 无对应描述
{{/each}}
{{#unless extra_impls}}
- （无）diff 实现均在 PRD 覆盖范围内
{{/unless}}
{{/if}}

---

<!--
  文档生成完毕
  - 无 --prd：模块 1 标记"待人工补充"；模块 7 从 diff 推断 db_name/table_name（不再纯留空）
  - 有 --prd：模块 1/7 由 PRD 填充（PRD 未提及的字段仍留空/从 diff 推断），模块 8 追加对齐缺口校验
  - 模块 4 新增 4.2 字段变更示例（从 DTO diff 生成）+ 4.3 下游依赖接口占位
  - 标题层级对齐 Confluence 样例：一、开发部分 = h1，子模块 = h2
  - 其余模块内容来自代码 diff 推断，提交评审前请人工校对业务语义
-->
