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
5. 写回发布记录：`node <skillDir>/scripts/upload.mjs record <mdPath> <pageId> --version <新版本号> --url <页面 URL>`（只改 Markdown 第一行的注释，不访问 wiki）。

## 通道 B — Confluence REST API（脚本）

环境没有 wiki MCP 工具、但 `wiki-config.json` 已填 `base_url` / `api_token` 时，用本 skill 的 `scripts/upload.mjs`，不要自己拼 curl / fetch：

```bash
node <skillDir>/scripts/upload.mjs info <pageId|url>
node <skillDir>/scripts/upload.mjs get <pageId|url> [--text]      # 读正文；其他 skill 拉 PRD 也用它
node <skillDir>/scripts/upload.mjs put <html> <pageId|url> --expect-version <n> [--title <标题>] [--record <mdPath>]   # --record：成功后写回发布记录
node <skillDir>/scripts/upload.mjs target <mdPath>                  # 读文档里的发布记录（pageId / url / 上次版本）
```

1. `info`：只读，输出 `title`、`version`、`space`、`url`。把这些告诉用户，确认要覆盖这一页。
2. `put`：`--expect-version` 填用户确认时看到的版本号。脚本会先校验 XHTML 良构（不良构退出码 3）。如果页面当前版本不是这个号，说明有人刚改过，脚本会拒绝上传（退出码 1），这时重新 `info` 并再次确认。上传后脚本会重新读取页面，确认版本号变成 n+1，并输出新的版本号和链接。
3. 认证：`wiki.username` 非空时用 Basic（Confluence Cloud：邮箱 + API token），为空时用 Bearer（Server / DC 的个人访问令牌）。token 只在请求头里使用，不会出现在输出里。
4. 失败时脚本输出 HTTP 状态码和响应体，如实告诉用户。401 / 403 是凭据或权限问题，直接停下，不要重试。

## 验证与反馈

- 确认新 `version.number` = 上传前 + 1，`version.when` 已更新；没涨 → 写入可能失败，查返回信息。
- 回复用户：页面标题、URL、新版本号、更新时间。
- 临时 XHTML 文件可删除（留着也行，`tmp/` 已被 gitignore）。
