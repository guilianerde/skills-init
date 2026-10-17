# `/workflow status` 输出

先运行 `node <skills>/workflow/scripts/resolve.mjs status` 和 `node <skills>/workflow/scripts/artifacts.mjs`（当前分支的产物进度），前者按上表判定画像、wiki 配置、DocNexus（含缺失模板）、代码图谱、数据库连接（只给连接名、driver、是否只读，不含凭据），再据此填写下表。wiki MCP 脚本探测不到，需你自己看当前环境有没有 wiki 相关工具。

```
# Workflow 状态

| 能力 | 状态 | 说明 / 如何启用 |
|---|---|---|
| 项目画像 | ✅ / ⚠️ 部分字段为空 | <空字段>；运行 /workflow profile |
| wiki | ✅ / ❌ | 填写 md-to-wiki/wiki-config.json 或接入 wiki MCP |
| DocNexus | ✅ / ❌ | 重跑 workflow-run 并加 --with-docnexus；已接入但缺模板时列出缺的模板并提示 `workflow-run seed-templates` |
| 数据库 | ✅ / ❌ | 重跑 `npx @rowansenne/workflow-run` 补配 |
| 代码图谱 | ✅ / ⚠️ 已装未建索引 / ❌ | 重跑 workflow-run 并加 --with-codegraph；已装 codegraph 但没有 .codegraph/ 时提示用户自己运行 codegraph init |

## 当前分支 <分支>
| 环节 | 产物 | wiki |
|---|---|---|
| 开发方案 / 交付说明 / 审查报告 / 技术方案 / 上线方案 | <path 或「—」> | <pageId vN 或「未发布」> |

下一步：<artifacts.mjs 的 next>

想看这套工作流的效果（审查发现与修复率、需求澄清、沉淀与复用）：/workflow report
```

探测只读文件、只看命令是否存在，**不输出任何凭据内容**（密码、token 一律不回显）。
