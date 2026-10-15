<!--
  template.md — create-release-md-doc skill 的文档模板
  结构来源：wiki.weicai.com.cn Confluence 上线方案模板 pageId=152531169（6 模块）
  参考样例：pageId=156293627 Joy换包-上线方案（填充详尽）
  始终填充模块：1/2/4/5/6
  条件填充模块：3（灰度方案）— 有 --prd 时从 PRD 填充，无 --prd 时留骨架占位
-->

# 【上线方案】<在此填写需求标题>

> **自动生成** by `create-release-md-doc` skill | 生成时间：{{生成时间}}
> 对比分支：`{{devBranch}}` ←→ `{{mainBranch}}`（主分支为基线）
> diff 概览：{{files}} files changed, {{insertions}} insertions(+), {{deletions}} deletions(-)
> PRD 参考：{{pageId 或 URL 或「无」}}
> 技术方案引用：{{path 或「无」}}
> GitNexus 增强：{{已启用 / 已跳过（索引 stale 或不可用）}}
> 填充模块：1/2/4/5/6 +（有 PRD 时）3
> ⚠️ 灰度/回滚策略基于 diff 推断，需人工校对后补充。

---

## 一、上线服务 *

| 服务名 | 环境 | 仓库 | 主分支 | 开发分支 | 上线方式 |
|--------|------|------|--------|----------|----------|
| {{服务名}} | {{环境}} | {{git remote 仓库地址}} | {{mainBranch}} | {{devBranch}} | {{常规发布/灰度}} |

参数说明：
- 服务名：Diamond 生产环境服务名
- 环境：Diamond 服务 Region（阿里云、华为云、阿里云墨西哥、华为云-墨西哥、华为云-菲律宾）
- 仓库：ssh git 链接，如 `git@gitlab.weicai.com.cn:foreign/xxx.git`
- 主分支：仓库主分支（main / master）
- 开发分支：当前 dev 分支名
- 上线方式：常规发布 / 灰度发布

改动范围：{{从 diff 各层命中的模块/包名汇总，如 APP 首页 / 贷超列表 / 风控回调 / CMS 配置}}

上线顺序：{{DDL 先行→ Nacos 配置补齐→ 服务发布 master→ 其他动作；从 DDL/config 存在推断；无则"常规发布"}}

## 二、中间件上线

### 2.1 DDL 变更（如有）

{{从 SQL 脚本 diff 或 --tech 模块6 原样保留}}

```sql
-- 新建/修改表（从 diff 中的 .sql 文件或 tech_context 提取）
{{CREATE TABLE / ALTER TABLE 语句}}
```

新增实体字段（从 Entity diff 或 --tech 模块6 提取）：
| 表名 | 字段名 | 类型 | 注释 |
|------|--------|------|------|
| {{table}} | {{field}} | {{type}} | {{comment}} |

### 2.2 Nacos 配置新增（如有）

{{从配置 diff + 代码中 RedisKeyConstants 推断}}
| 配置项 | 用途 | 值 |
|--------|------|------|
| {{key}} | {{用途}} | {{值}} |

### 2.3 db_name（数仓评审）

{{#if tech_context_db_name}}
> 来自技术方案引用（{{tech_context path}}，需数仓核对）
```
db_name：{{tech_context.db_name}}
table_name：
- {{tech_context.table_name 列表}}
是否需要评审：是/否
```
{{else}}
> 从 diff 推断（SQL/datasource/Entity @TableName），不确定处标"待人工确认"
```
db_name：{{从 SQL USE 语句 / application.yml datasource url / 表名前缀推断，不确定标"待人工确认"}}
table_name：
- {{从 SQL CREATE TABLE / ALTER TABLE / Entity @TableName 提取}}
是否需要评审：是/否
```
{{/if}}

### 2.4 依赖变更（如有）

{{从 pom.xml diff 提取}}
- 新增依赖：`{{groupId}}:{{artifactId}}:{{version}}`

## 三、灰度方案

{{#if prd_context}}
（来自 PRD：{{prd_context.pageUrl}}）
{{prd_context.grayRelease 灰度/功能开关描述}}
{{else}}
> **【待人工补充】**
> 灰度策略或"无灰度，常规发布"
> （未传入 --prd，diff 无法推断灰度意图，需人工填写）
{{/if}}

## 四、上线后技术验证方案 *

#### 4.1 接口验证

| 用例 | 请求 | 预期 |
|------|------|------|
| `{{path}}` | {{POST/GET}} | {{从 Controller diff 或 --tech 模块4 推断返回/行为}} |

{{#if gitnexus_callers}}
#### 4.2 受影响入口验证（GitNexus impact d=1）

以下调用方受本次改动影响，上线后需重点验证：
{{#each gitnexus_callers}}
- {{this.symbol}}（{{this.location}}）
{{/each}}
{{/if}}

{{#if prd_context}}
#### 4.3 业务场景验证（来自 PRD）

{{#each prd_context.verifyScenarios}}
- {{this.name}}：{{this.desc}}
{{/each}}
{{/if}}

## 五、监控方案 *

| 监控项 | 口径 |
|--------|------|
| {{error 日志}} | {{diff 类名/方法名}} |
| {{Job 异常}} | {{Job 类名}} |
| {{Kafka 消费失败}} | {{topic 名}} |

日志关键字：`{{diff 类名/方法名}}`

## 六、回滚/止损方案

- DDL 回滚：{{从 DDL 推断，如"新增字段可直接 DROP"；ALTER MODIFY 需备份}}
- 配置回滚：{{从 Nacos 配置推断，如"删除新增 key"}}
- 服务回滚：回滚到上一镜像版本

{{#if prd_context}}

#### 6.x PRD 对齐缺口（来源 PRD 校验，Step 2c）

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
  - 无 --prd：模块三（灰度）标记"待人工补充"
  - 有 --prd：模块三由 PRD 填充（PRD 未提及的仍留空），模块六追加对齐缺口校验
  - 有 --tech：模块一/二/四复用技术方案结构化事实，跳过对应层 diff
  - 其余模块内容来自代码 diff 推断，执行上线前请人工校对灰度/回滚策略
-->
