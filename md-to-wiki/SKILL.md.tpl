---
name: md-to-wiki
description: "Publish a local Markdown document to an existing Confluence wiki page. Use when the user wants to write/upload/publish/sync a markdown file to wiki/Confluence, or invokes /md-to-wiki <mdPath> <pageId|url> [--title <title>] [--banner <bannerMdPath>] [--no-banner] [--validate-only]. Converts Markdown to Confluence Storage Format XHTML, validates it, then uploads via the environment's wiki MCP tool or the Confluence REST API. Gated on wiki-config.json: if it is missing or disabled the skill must not run. Trigger phrases: 发布到wiki / 上传到wiki / 同步到wiki / md转wiki / publish to wiki / upload to confluence. Not for generating the documents themselves (create-tech-md-doc / create-release-md-doc)."
---

# MD to Wiki

把本地 Markdown 转成 Confluence Storage Format（严格 XHTML），校验后写入**已有**的 wiki 页面。

## GATE — 未配置则禁止启动（最高优先级）

执行任何步骤前，先读本 skill 目录下的 `wiki-config.json`：

- 文件缺失、`enabled` 不是 `true`、或 `wiki.base_url` 为空 → **立即停止**，回复：
  `wiki 连接未配置：重跑 skills-init 补配，或填写 <skill目录>/wiki-config.json（enabled: true，并填 base_url / api_token）。`
  不做转换、不上传、不调用任何 wiki API。

## Command Format

```
/md-to-wiki <mdPath> <pageId|url> [--title <title>] [--banner <bannerMdPath>] [--no-banner] [--validate-only]
```

| 参数 | 说明 |
|---|---|
| `<mdPath>` | 本地 Markdown 路径（必填） |
| `<pageId\|url>` | 纯数字 pageId，或含 `pageId=` 的 URL（用 `[?&]pageId=(\d+)` 提取）（必填） |
| `--title` | 更新后的页面标题；不传保留原标题 |
| `--banner` | 顶部 info 宏的内容来源（小 md 片段）；不传且没有 `--no-banner` 时，把正文第一个 `>` 引用块移到顶部 info 宏 |
| `--no-banner` | 不加顶部 info 宏 |
| `--validate-only` | 只转换并校验，不上传 |

不适用：目标不是 Confluence；目标页面不存在（本 skill 只更新已有页面，创建页面需用户另行授权）。

## Workflow

### Step 0 — 前置校验

1. GATE 通过。
2. `<mdPath>` 存在。
3. 解析 pageId；URL 中提取不出 → 请用户重新提供，**不要猜**。
4. 选择上传通道：环境有 wiki MCP 工具 → 通道 A；否则用 `wiki-config.json` 的 REST 参数 → 通道 B；都不可用 → 停。
5. 读取目标页面当前的标题、版本号（细节见 `references/upload.md`）；页面不存在或无权限 → 停。
6. 本机有 Node.js（≥ 18）；转换脚本不依赖任何第三方库。

### Step 1 — 转换并校验

```bash
node <skillDir>/scripts/md-to-wiki.mjs <mdPath> tmp/skills/md-to-wiki/_wiki_upload_<timestamp>.html [--banner <path>] [--no-banner]
```

脚本转换后会自动做 XML 良构校验，退出码非 0 表示不良构（单独校验：`node <skillDir>/scripts/md-to-wiki.mjs --check <html>`）。不良构 → 停，把报错的行号和原因告诉用户；不要把不良构的内容传给 Confluence。`--validate-only` 到此结束并报告结果。

### Step 2 — 确认后上传

1. 上传会**覆盖**目标页面正文。先告诉用户：目标页面标题、URL、当前版本号，得到确认后再上传。
2. 按通道 A / B 上传，带上读到的版本号防止覆盖他人并发修改（请求格式见 `references/upload.md`）。
3. 重新读取页面，确认版本号 +1；回复用户页面标题、URL、新版本号。

## Red Flags — STOP

- GATE 未通过；markdown 文件不存在；pageId 解析不出
- wiki 未连接，或 REST 返回 401 / 403；目标页面不存在或无权限
- XML 良构校验失败
- 用户没有确认覆盖目标页面

## 参考

- `references/upload.md`：通道 A / B 的调用细节与验证
- `references/troubleshooting.md`：转换脚本说明、XHTML 规则、校验命令、常见错误

典型串联：`create-tech-md-doc` / `create-release-md-doc` 生成 `docs/skills/...` 下的 md → 本 skill 发布。
