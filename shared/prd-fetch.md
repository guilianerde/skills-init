# PRD 拉取（通用）

> 共享文件：源文件在 workflow-run 仓库的 `shared/`，安装时拷进每个声明了它的 skill 的 `references/`。各 skill 需要从 PRD 抽取的额外字段写在各自的文档里。

任一步失败都**只回退**（不用 PRD 继续），在产出中写明「PRD 增强已跳过」，绝不因此中止主流程。

1. **wiki 是否可用**：运行 `node <skills>/workflow/scripts/resolve.mjs status`，看 `wiki.ok`；或者当前环境有 wiki MCP 工具（如 `mcp__wiki-mcp__get_page`）。两者都没有 → 回退。不要直接读 `wiki-config.json`，凭据只由 md-to-wiki 的脚本使用。
2. **解析 pageId**：纯数字直接用；URL 用 `[?&]pageId=(\d+)` 或 `/pages/(\d+)` 提取；提取不出 → 请用户提供 pageId，或回退。
3. **拉取页面**（按可用性）：
   - MCP：`get_page({pageId, expand: "body.storage,version"})`；
   - REST：`node <skills>/md-to-wiki/scripts/upload.mjs get <pageId|url> --text`，输出 JSON 中的 `title`、`url`、`text`（已去掉 storage 标签、保留标题层级 / 列表 / 表格的纯文本）。没有安装 md-to-wiki（脚本不存在）→ 只能用 MCP，否则回退。
4. **抽取通用 `prd_context`**：
   - `title`：需求标题
   - `background`：业务背景摘要（不堆砌原文）
   - `features`：功能点列表 `{name, desc}`
   - `tables`：提及的数据表名
   - `pageUrl`：原文链接
5. 只从 PRD 文本中抽事实；PRD 没写的字段留空，不要补写。
