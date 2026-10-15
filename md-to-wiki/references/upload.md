# 上传通道细节

## 通道 A — wiki MCP 工具

环境已配置 Confluence MCP 时使用（Claude Code 中工具名通常为 `mcp__wiki-mcp__*`，其他环境按各自命名）。

1. 连接状态：`get_connection_status`，未连接 → 停，提示先配置 MCP 连接。
2. 读取页面：`get_page({pageId, expand: "version"})`，记录 `title`、`version.number`、`space.key`。
3. 更新页面：

   ```
   update_page({
     pageId: "<pageId>",
     title: "<原标题 或 --title>",
     body: <XHTML 全文>,
     version: <读到的 version.number>
   })
   ```

4. 验证：再次 `get_page`，确认 `version.number` 已 +1。

## 通道 B — Confluence REST API

环境没有 wiki MCP 工具、但 `wiki-config.json` 已填 `base_url` / `api_token` 时，用 Node（≥ 18 自带 `fetch`）写一个临时脚本调用，token 在脚本里从 `wiki-config.json` 读取：

```
GET {base_url}/rest/api/content/{pageId}?expand=version,space
Authorization: Bearer {api_token}
```

```
PUT {base_url}/rest/api/content/{pageId}?expand=version
Authorization: Bearer {api_token}
Content-Type: application/json

{
  "id": "{pageId}", "type": "page",
  "title": "<标题>",
  "space": {"key": "<GET 结果中的 space.key>"},
  "version": {"number": <当前 version.number + 1>},
  "body": {"storage": {"value": "<XHTML 全文>", "representation": "storage"}}
}
```

- token 从 `wiki-config.json` 读取，不要在对话、日志或命令行参数中明文输出。
- 失败时如实报告 HTTP 状态码与响应体，不要假装成功。401 / 403 → 凭据或权限问题，停。

## 验证与反馈

- 确认新 `version.number` = 上传前 + 1，`version.when` 已更新；没涨 → 写入可能失败，查返回信息。
- 回复用户：页面标题、URL、新版本号、更新时间。
- 临时 XHTML 文件可删除（留着也行，`tmp/` 已被 gitignore）。
