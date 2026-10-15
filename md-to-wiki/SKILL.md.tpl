---
name: md-to-wiki
description: "Publish a local Markdown document to a Confluence wiki page. Use when the user wants to write/upload/publish/sync a markdown file to wiki/Confluence, or invokes /md-to-wiki <mdPath> <pageId|url> [--title <title>] [--banner <bannerMdPath>] [--no-banner] [--validate-only]. Converts Markdown to Confluence Storage Format XHTML (code blocks -> ac:structured-macro code macros, tables/lists/headings preserved), validates XML well-formedness, then uploads via the environment's wiki MCP tool or Confluence REST API. NOTE: the skill is gated on wiki connection config — if wiki-config.json is missing or disabled, the skill MUST NOT run and MUST tell the user the connection is not configured. Trigger phrases: 发布到wiki / 上传到wiki / 同步到wiki / md转wiki / publish to wiki / upload to confluence."
---

# MD to Wiki

将本地 Markdown 文档转换为 Confluence Storage Format (XHTML) 并写入指定 wiki 页面。一次命令完成「转换 + 校验 + 上传」全流程。

## GATE — 未配置则禁止启动（最高优先级）

执行任何步骤前，先读取本 skill 目录下的 `wiki-config.json`：

- 文件缺失，或 `enabled` 不是 `true`，或 `wiki.base_url` 为空 → **立即停止**。
  回复用户：`wiki 连接未配置：运行 init-skills 补配，或填写 <skill目录>/wiki-config.json（enabled: true，并填 base_url / api_token）。`
  不做任何转换、不上传、不调用任何 wiki API。
- 只有配置通过（enabled=true 且 base_url 非空）才继续下面流程。

> 跨环境初始化时该配置默认留空（enabled=false），因此**未补配前本 skill 不生效**。

## Overview

**核心原理**：Python `markdown` 库把 md 转成 HTML → 提取代码块包成 Confluence `<ac:structured-macro ac:name="code">` 宏 → 修复 XHTML 自闭合标签（`<br>` → `<br/>` 等）→ `xml.etree.ElementTree` 做良构校验 → 上传到 Confluence。

**为什么需要本 skill**：Confluence Storage Format 是严格的 XHTML，直接粘贴 Markdown 或用普通 HTML 转换会因 `<br>` 未闭合、`&` 未转义、代码块格式丢失等问题报 `Error parsing xhtml`。本 skill 把踩过的坑固化成可复用脚本。

**上传通道（二选一，按环境能力）**：
- **通道 A — 环境的 wiki MCP 工具**：环境若已配置 Confluence MCP（如 Claude Code 的 `mcp__wiki-mcp__update_page`），直接用该工具上传；
- **通道 B — Confluence REST API**：环境无 MCP 工具但可执行 Python/HTTP 时，用 `wiki-config.json` 里的 `base_url` / `api_token`，以 Python 调 REST API 上传（见 Step 3）。
- 两通道都不可用 → 停，如实说明。

## When to Use

**触发条件（满足任一）：**
- 用户输入 `/md-to-wiki <mdPath> <pageId|url>`（精确命令）
- 用户输入 `/md-to-wiki <mdPath> <pageId|url> --title "自定义标题"`
- 用户要求"把/将这个 md 文档写到/发布到/同步到 wiki"，并给出 markdown 文件路径和目标 wiki 页面
- 用户给出 markdown 文件路径和 wiki pageId/URL，希望转换并上传

**不适用：**
- 只想把 Markdown 转 HTML 看效果（用任意在线工具）
- 目标不是 Confluence（是 GitHub README、Notion 等）
- 从 git diff 生成技术方案/上线方案文档（用 `create-tech-md-doc` / `create-release-md-doc`，它们生成 md；生成后再用本 skill 发布）
- 目标 wiki 页面不存在且用户未授权创建（本 skill 只更新已有页面；若需创建，先用 wiki MCP/REST 创建页面）

## Command Format

```
/md-to-wiki <mdPath> <pageId|url> [--title <title>] [--banner <bannerMdPath>] [--no-banner] [--validate-only]
```

- `<mdPath>`：本地 Markdown 文件绝对或相对路径（必填）
- `<pageId|url>`：Confluence 页面 pageId（纯数字）或 URL（含 `viewpage.action?pageId=`，自动正则提取）（必填）
- `--title <title>`（可选）：更新时的页面标题。不传则保留原页面标题不变
- `--banner <bannerMdPath>`（可选）：顶部 info 宏的内容来源（一个小 md 片段）。不传且未加 `--no-banner` 时，从正文第一个 `>` 引用块自动提取作为 banner
- `--no-banner`（可选）：不添加顶部 info 宏，只转换正文
- `--validate-only`（可选）：只生成 XHTML 并校验良构，不调用 wiki API 上传（用于预检）

## Workflow

严格按顺序执行。每一步标注了工具和判停条件。

### Step 0 — GATE + 前置校验

1. **GATE（必做）**：读本 skill 目录 `wiki-config.json`。未启用/缺失/base_url 空 → 停（见顶部 GATE）。
2. **确认 markdown 文件存在**：用 Read 工具读 `<mdPath>` 前 5 行。不存在 → 停，提示用户。
3. **解析 pageId**：
   - 值是纯数字 → 直接当 pageId
   - 值是 URL → 用正则 `[?&]pageId=(\d+)` 提取；提取失败 → 提示用户重新提供，**不要**猜一个 pageId
4. **确认连接状态**（通道 A 时）：调环境的 wiki MCP `get_connection_status`（如 `mcp__wiki-mcp__get_connection_status`）。未连接 → 停，提示先配置 MCP 连接。
5. **读取目标页面当前状态**：调 `get_page({pageId, expand: "version"})`（通道 A）或 REST `GET /rest/api/content/{pageId}?expand=version`（通道 B）。
   - 页面不存在/无权限 → 停，提示用户
   - 成功 → 记录当前 `version.number`，用于后续 update（工具会自动 +1，但传 version 可防并发覆盖）
6. **确认 Python 环境**：调 Bash `python --version` 或 `python3 --version`。Python ≥ 3.6 即可。
7. **确认 markdown 库**：调 Bash `python -c "import markdown; print(markdown.__version__)"`。
   - 未安装 → `pip install markdown`（机器上装一次即可，后续复用）
   - 安装失败 → 停，提示用户

> **判停**：config 未启用 / md 文件不存在 / pageId 解析不出 / wiki 未连接 / 目标页面不存在 / Python 或 markdown 库不可用 → 停。其余项不阻塞。

### Step 1 — 准备转换脚本

本 skill 自带转换脚本：`scripts/md_to_wiki.py`（与本 SKILL.md 同目录的 scripts/ 下）。

脚本签名（CLI 参数）：
```
python md_to_wiki.py <inputMd> <outputHtml> [--banner <bannerMdPath>] [--no-banner]
```

脚本职责（已固化，无需每次重写）：
1. 读取输入 md
2. 提取 fenced code blocks（```` ```lang\n...``` ````），替换成占位符，避免 markdown 库破坏代码内容
3. 用 `markdown` 库（extensions: `tables`, `sane_lists`, `nl2br`）转 HTML
4. 把占位符还原成 Confluence `<ac:structured-macro ac:name="code">` 宏（含 `<ac:plain-text-body><![CDATA[...]]></ac:plain-text-body>`，处理 CDATA 内 `]]>` 转义）
5. 修复 XHTML 良构：`<br>` → `<br/>`、`<hr>` → `<hr/>`、`<img ...>` → `<img .../>`、去掉 heading 的 `id` 属性
6. 可选：把 banner md 片段包进 `<ac:structured-macro ac:name="info">` 宏拼到正文前
7. 写入 outputHtml

脚本**不**调 wiki API，只做本地转换。上传交给 Step 3。

### Step 2 — 执行转换并校验

```bash
python <skillDir>/scripts/md_to_wiki.py <mdPath> <tmpHtmlPath> [--banner <bannerMdPath>] [--no-banner]
```

- `<tmpHtmlPath>`：临时输出路径，统一写到项目 `tmp/skills/md-to-wiki/`（不存在则创建；该目录已被 gitignore），文件名 `_wiki_upload_<timestamp>.html`；无写权限时用系统 temp
- 转换完用 Python 做 XML 良构校验（声明 `ac:` 命名空间后用 `xml.etree.ElementTree.fromstring` 解析）：
  ```bash
  python -c "
  import xml.etree.ElementTree as ET
  with open(r'<tmpHtmlPath>', 'r', encoding='utf-8') as f: c = f.read()
  try:
      ET.fromstring('<root xmlns:ac=\"http://atlassian.com/ac\">' + c + '</root>')
      print('XML well-formed: OK')
  except ET.ParseError as e:
      print('XML parse error:', e)
  "
  ```

> **判停**：XML 不良构 → 停，把错误行号+内容片段告诉用户，提示脚本可能需补充规则。不要把不良构的 HTML 硬塞给 Confluence（一定会报 400）。

### Step 3 — 上传到 Confluence

读 Step 2 生成的 tmpHtmlPath 全文，作为正文上传。

**通道 A — wiki MCP 工具**（环境有 Confluence MCP 时）：
```
<环境的 wiki-mcp>_update_page({
  pageId: "<pageId>",
  title: "<原标题 或 --title 传入的标题>",
  body: <tmpHtmlPath 全文内容>,
  version: <Step 0 读到的当前 version.number>
})
```
（Claude Code 中工具名为 `mcp__wiki-mcp__update_page`；其他环境按各自 MCP 工具命名调用。）

**通道 B — Confluence REST API**（环境无 MCP 工具，但 wiki-config.json 已填 base_url / api_token 时）：
用 Python（urllib 或 requests）调 REST API：
```
PUT {base_url}/rest/api/content/{pageId}?expand=version
Authorization: Bearer {api_token}
Content-Type: application/json
{
  "id": "{pageId}", "type": "page",
  "title": "<标题>",
  "space": {"key": "<页面所属 space key，可从 get_page 结果取得>"},
  "version": {"number": <当前 version.number + 1>},
  "body": {"storage": {"value": "<tmpHtmlPath 全文>", "representation": "storage"}}
}
```
REST 失败时如实报告 HTTP 状态与响应体，不要假装成功。

> **判停**：两通道都不可用 → 停，说明环境缺少 wiki 上传能力，提示补配 MCP 或 REST 参数。

### Step 4 — 验证并收尾

1. **验证写入成功**：调 `get_page({pageId, expand: "version"})`，确认 `version.number` 比上传前 +1，`version.when` 更新。
2. **给用户反馈**：页面标题、URL、新版本号、更新时间。
3. **清理临时文件**：删掉 `<tmpHtmlPath>`（可选，留着也行）。

> **判停**：version 未涨 → 写入可能失败，查返回的错误信息告诉用户。

## XHTML 良构规则（脚本已处理，记录于此供排查）

| 问题 | Markdown 库默认输出 | 修复 |
|------|---------------------|------|
| 换行 | `<br>` | `<br/>` |
| 分隔线 | `<hr>` | `<hr/>` |
| 图片 | `<img src="..." alt="...">` | `<img src="..." alt="..."/>` |
| 标题锚点 | `<h2 id="xxx">` | 去掉 `id` 属性（Confluence 自己生成） |
| 代码块 | `<pre><code>...</code></pre>` | 替换成 `<ac:structured-macro ac:name="code">` + `<![CDATA[...]]>` |
| `&` 字符 | 文本中的 `&` 需转 `&amp;` | markdown 库在表格等场景会自动转；CDATA 内不转 |
| CDATA 嵌套 | 代码内容含 `]]>` | 拆成 `]]]]><![CDATA[>` |

## Quick Reference

### 一行触发
```
/md-to-wiki D:\project\docs\design.md 160998757
/md-to-wiki ./design.md https://wiki.example.com/pages/viewpage.action?pageId=160998757
/md-to-wiki ./design.md 160998757 --title "【技术方案】新版设计" --no-banner
/md-to-wiki ./design.md 160998757 --banner ./_banner.md
/md-to-wiki ./design.md 160998757 --validate-only
```

### 与其他 skill 的串联
```
# 先生成技术方案 md（create-tech-md-doc），再发布到 wiki（本 skill）
/create-tech-md-doc feature/xxx master
/md-to-wiki .claude/docs/tech-doc_feature-xxx_20260921.md 160998757

# 先生成上线方案 md（create-release-md-doc），再发布到 wiki
/create-release-md-doc feature/xxx master
/md-to-wiki .claude/docs/release-doc_feature-xxx_20260921.md 160998758
```

## Common Mistakes

| 错误 | 后果 | 正解 |
|---|---|---|
| 配置未启用就执行转换/上传 | 违反 GATE，凭据为空必然失败 | Step 0 先读 wiki-config.json，未启用立即停 |
| 直接把 Markdown 粘进 Confluence 编辑器 | 代码块格式丢失、表格错位 | 用本 skill 转成 Storage Format 再上传 |
| 用普通 HTML 转换器（不处理 `<br>` 自闭合） | Confluence 报 `Error parsing xhtml: Unexpected close tag </p>; expected </br>` | 脚本已修复所有空标签自闭合 |
| 不做 XML 良构校验就上传 | 400 错误返工，且错误信息难定位 | Step 2 校验通过再上传 |
| 代码块不包 CDATA 直接塞进 XML | 代码里的 `<` `>` `&` 破坏 XML 结构 | 脚本用 `<![CDATA[...]]>` 包裹，并处理 `]]>` 嵌套 |
| `version` 不传 | 并发编辑时可能覆盖他人改动 | Step 0 读当前 version，Step 3 传入 |
| pageId 从 URL 解析失败却硬猜 | 写到错误页面 | URL 用正则 `[?&]pageId=(\d+)` 提取；失败就停 |
| body 超大（>256KB） | Confluence REST 拒绝 | 拆分文档或精简；实测 ~50KB 无问题 |
| 临时 HTML 写到项目源码目录 | 污染 git 工作区 | 统一写到 `tmp/skills/md-to-wiki/` 或系统 temp |

## Red Flags — STOP

- `wiki-config.json` 缺失 / `enabled` 非 true / `base_url` 为空 → **停（GATE）**
- markdown 文件不存在 → 停
- pageId 解析不出（URL 无 `pageId=` 参数）→ 停，不要猜
- wiki 未连接（MCP 连接状态异常，或 REST 401/403）→ 停
- 目标页面不存在或无权限 → 停
- XML 良构校验失败 → 停，不要硬上传
- Python 或 markdown 库不可用且安装失败 → 停

## 与其他 skill 的关系

- **create-tech-md-doc / create-release-md-doc**：它们从 git diff 生成 Markdown 文档；本 skill 把生成的 md 发布到 Confluence。典型串联：先 create-*-md-doc 生成，再 md-to-wiki 发布。
- **drawio / swagger**：发布其他格式内容到 wiki 时，若需配套发布 md 说明文档，可用本 skill。
