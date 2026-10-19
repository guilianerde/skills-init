---
name: md-to-wiki
description: "Publish a local Markdown document to an existing Confluence wiki page. Use when the user wants to write/upload/publish/sync a markdown file to wiki/Confluence, or invokes /md-to-wiki <mdPath> [pageId|url] [--title <title>] [--banner <bannerMdPath>] [--no-banner] [--validate-only]. Converts Markdown to Confluence Storage Format XHTML, validates it, then uploads via the environment's wiki MCP tool or the Confluence REST API. Gated on wiki-config.json: if it is missing or disabled the skill must not run. Trigger phrases: 发布到wiki / 上传到wiki / 同步到wiki / md转wiki / publish to wiki / upload to confluence. Not for generating the documents themselves (create-tech-md-doc / create-release-md-doc)."
---

# MD to Wiki

把本地 Markdown 转成 Confluence Storage Format（严格 XHTML），校验后写入**已有**的 wiki 页面。

## GATE — 未配置则禁止启动（最高优先级）

执行任何步骤前，先读本 skill 目录下的 `wiki-config.json`：

- 文件缺失、`enabled` 不是 `true`、或 `wiki.base_url` 为空 → **立即停止**，回复：
  `wiki 连接未配置：重跑 workflow-run 补配，或填写 <skill目录>/wiki-config.json（enabled: true，并填 base_url / api_token）。`
  不做转换、不上传、不调用任何 wiki API。

## Command Format

```
/md-to-wiki <mdPath> [pageId|url] [--title <title>] [--banner <bannerMdPath>] [--no-banner] [--validate-only]
```

| 参数 | 说明 |
|---|---|
| `<mdPath>` | 本地 Markdown 路径（必填） |
| `[pageId\|url]` | 纯数字 pageId，或含 `pageId=` 的 URL（用 `[?&]pageId=(\d+)` 提取）。文档发布过时可省略：用文档里的发布记录（见 Step 0） |
| `--title` | 更新后的页面标题；不传保留原标题 |
| `--banner` | 顶部 info 宏的内容来源（小 md 片段）；不传且没有 `--no-banner` 时，把正文第一个 `>` 引用块移到顶部 info 宏 |
| `--no-banner` | 不加顶部 info 宏 |
| `--validate-only` | 只转换并校验，不上传 |

不适用：目标不是 Confluence；目标页面不存在（本 skill 只更新已有页面，创建页面需用户另行授权）。

## Workflow

### Step 0 — 前置校验

1. GATE 通过。
2. `<mdPath>` 存在。
3. 确定目标页面：用户给了 pageId / URL 就解析它（提取不出 → 请用户重新提供，**不要猜**）；没给就运行 `node <skillDir>/scripts/upload.mjs target <mdPath>` 读文档第一行的发布记录（`<!-- md-to-wiki: pageId=... -->`，转换时会被丢弃，不会出现在页面上）。有记录就用它，并在 Step 2 的确认里注明「沿用上次发布的页面」；没有记录 → 请用户提供 pageId，停。用户给的 pageId 与记录不同时以用户给的为准，并提醒。
4. 选择上传通道：环境有 wiki MCP 工具 → 通道 A；否则用 `wiki-config.json` 的 REST 参数 → 通道 B；都不可用 → 停。
5. 读取目标页面当前的标题、版本号：通道 A 用 MCP 的 `get_page`，通道 B 用 `node <skillDir>/scripts/upload.mjs info <pageId|url>`（细节见 `references/upload.md`）。页面不存在或无权限 → 停。
6. 本机有 Node.js（≥ 18）；转换脚本不依赖任何第三方库。

### Step 1 — 转换并校验

```bash
node <skillDir>/scripts/md-to-wiki.mjs <mdPath> workflow-run/tmp/md-to-wiki/_wiki_upload_<timestamp>.html [--banner <path>] [--no-banner]
```

脚本转换后会自动做 XML 良构校验，退出码非 0 表示不良构（单独校验：`node <skillDir>/scripts/md-to-wiki.mjs --check <html>`）。不良构 → 停，把报错的行号和原因告诉用户；不要把不良构的内容传给 Confluence。`--validate-only` 到此结束并报告结果。

### Step 2 — 确认后上传

1. 上传会**覆盖**目标页面正文。先告诉用户：目标页面标题、URL、当前版本号，得到确认后再上传。
2. 按通道上传，带上用户确认过的版本号，避免覆盖他人刚做的修改：通道 A 见 `references/upload.md`；通道 B 运行 `node <skillDir>/scripts/upload.mjs put <html> <pageId|url> --expect-version <确认的版本号> [--title <标题>] --record <mdPath>`，脚本会校验良构、核对版本，在上传后确认版本号 +1，并把发布记录写回 Markdown 第一行。
3. 通道 A 上传成功后补写发布记录：`node <skillDir>/scripts/upload.mjs record <mdPath> <pageId> --version <新版本号> --url <页面 URL>`。
4. 确认版本号 +1 后，回复用户页面标题、URL、新版本号，并说明发布记录已写回文档（下次发布同一文档不必再给 pageId）。

## Red Flags — STOP

- GATE 未通过；markdown 文件不存在；pageId 解析不出且文档没有发布记录
- wiki 未连接，或 REST 返回 401 / 403；目标页面不存在或无权限
- XML 良构校验失败
- 用户没有确认覆盖目标页面

## 参考

- `references/upload.md`：通道 A / B 的调用细节与验证
- `references/troubleshooting.md`：转换脚本说明、XHTML 规则、校验命令、常见错误

典型串联：`create-tech-md-doc` / `create-release-md-doc` 生成 `workflow-run/docs/requirements/<需求名>/<项目名>/` 下的 md → 本 skill 发布。

## 终端命令

本 skill 给出的 `node …`、`git …` 命令在 bash、zsh、PowerShell 里写法一样，原样运行即可。需要自己写其他终端命令时，先看本机的系统和终端：`node <skills>/workflow/scripts/resolve.mjs env`（安装时记录，一次对话查一次就够；`resolve.mjs profile` / `status` 的输出里也带着 `env`；没装 workflow skill 时没有这条命令，按你所在的环境写）。按输出的 `os`、`shell`、`note` 写命令，不要再用 `uname`、`$PSVersionTable`、`ver` 之类去探测。`<skills>` 是本 skill 所在的 skills 目录（如 `.agents/skills`）。
