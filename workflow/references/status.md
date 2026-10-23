# `/workflow status` 输出

先运行 `node <skills>/workflow/scripts/resolve.mjs status` 和 `node <skills>/workflow/scripts/artifacts.mjs`（当前分支的产物进度），`artifacts.mjs` 的 `execution` 给出当前运行、历史、阶段、已完成步骤、waiting_for、reason 和完成时间；没有运行时说明暂无可恢复状态，不根据文档齐全推断已完成。前者按上表判定画像、wiki 配置、DocNexus（含缺失模板）、代码图谱、数据库连接（只给连接名、driver、是否只读，不含凭据），再据此填写下表。wiki MCP 脚本探测不到，需你自己看当前环境有没有 wiki 相关工具。

```
# Workflow 状态

| 能力 | 状态 | 说明 / 如何启用 |
|---|---|---|
| 项目画像 | ✅ / ⚠️ 部分字段为空 | <空字段>；运行 /workflow profile |
| wiki | ✅ / ❌ | 填写 md-to-wiki/wiki-config.json 或接入 wiki MCP |
| DocNexus | ✅ / ❌ | 重跑 npx @rowansenne/workflow-run 并加 --with-docnexus；已接入但缺模板时列出缺的模板并提示 `npx @rowansenne/workflow-run seed-templates`；未接入时说明默认模板只读、不能定制，技术方案 / 上线方案要先接入（`templates_need_docnexus`）；`stale_project_templates` 非空时提示这些项目模板已不再生效 |
| 数据库 | ✅ / ❌ | 重跑 `npx @rowansenne/workflow-run` 补配 |
| 代码图谱 | ✅ / ⚠️ 已装未建索引 / ❌ | 重跑 npx @rowansenne/workflow-run 并加 --with-codegraph；已装 codegraph 但没有 .codegraph/ 时提示用户自己运行 codegraph init |

## 当前分支 <分支>
运行：<id / 暂无记录> ｜ 状态：<进行中 / 等待用户 / 受阻 / 已完成 / 已取消> ｜ 当前阶段：<stage>
已完成步骤：<steps 中 completed 的名称> ｜ 完成时间：<completed_at / —>
等待 / 阻塞：<waiting_for / reason / 无>
| 环节 | 产物 | wiki |
|---|---|---|
| 方案 / 交付说明 / 审查报告 / 技术方案 / 上线方案 | <path 或「—」> | <pageId vN 或「未发布」> |

下一步：<artifacts.mjs 的 next>

想看这套工作流的效果（审查发现与修复率、需求澄清、沉淀与复用）：/workflow report
```

探测只读文件、只看命令是否存在，**不输出任何凭据内容**（密码、token 一律不回显）。
