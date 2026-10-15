# PRD 拉取（--prd）

前提：wiki GATE 通过（`md-to-wiki/wiki-config.json` 中 `enabled=true` 且 `wiki.base_url` 非空，或环境有 wiki MCP 工具）。任一步失败都**回退纯 diff 流程**，元信息写「PRD 增强已跳过」，绝不因此中止文档生成。

1. **解析 pageId**：纯数字直接用；URL 用 `[?&]pageId=(\d+)` 提取；提取不出 → 提示用户，回退。
2. **拉取页面**：
   - MCP：`get_page({pageId, expand: "body.storage,version"})`（Claude Code 中通常为 `mcp__wiki-mcp__get_page`）；
   - REST：`GET {base_url}/rest/api/content/{pageId}?expand=body.storage`，token 从 `wiki-config.json` 读取，不在输出中回显。
3. **HTML → 可读文本**：剥离 storage 标签，保留标题层级、表格、列表、段落。
4. **抽取 `prd_context`**：
   - `title`：需求标题
   - `background`：业务背景摘要
   - `features`：功能点列表 `{name, desc}`
   - `tables`：提及的数据表名
   - `pageUrl`：原文链接
5. 只从 PRD 文本中抽事实；PRD 没写的字段留空。

## PRD 对齐校验

PRD 功能点与 diff 实现做语义对齐，在模块 8 输出两张清单：

- **对齐缺口**：PRD 有、代码里找不到实现的功能点；
- **实现超出 PRD**：代码里有、PRD 没提到的行为。

匹配不确定的不算缺口，标「待人工核对」。
