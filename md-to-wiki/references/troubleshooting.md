# 转换脚本与排错

## scripts/md_to_wiki.py

```
python md_to_wiki.py <inputMd> <outputHtml> [--banner <bannerMdPath>] [--no-banner]
```

脚本只做本地转换，不调用 wiki API：

1. 提取 fenced code block 换成占位符，避免 markdown 库破坏代码内容；
2. 用 `markdown` 库（`tables`、`sane_lists`、`nl2br` 扩展）转 HTML；
3. 占位符还原为 `<ac:structured-macro ac:name="code">` 宏，代码放进 `<![CDATA[...]]>`；
4. 修复 XHTML 良构（见下表）；
5. 可选：banner 片段包进 `<ac:structured-macro ac:name="info">` 放到正文前。

## XHTML 良构规则（脚本已处理）

| 问题 | markdown 库默认输出 | 修复 |
|------|---------------------|------|
| 换行 | `<br>` | `<br/>` |
| 分隔线 | `<hr>` | `<hr/>` |
| 图片 | `<img src="..." alt="...">` | `<img src="..." alt="..."/>` |
| 标题锚点 | `<h2 id="xxx">` | 去掉 `id`（Confluence 自己生成） |
| 代码块 | `<pre><code>...</code></pre>` | `<ac:structured-macro ac:name="code">` + CDATA |
| `&` | 文本中的 `&` 需为 `&amp;` | 表格等场景库会自动转；CDATA 内不转 |
| CDATA 嵌套 | 代码含 `]]>` | 拆成 `]]]]><![CDATA[>` |

## 良构校验命令

```bash
python -c "
import xml.etree.ElementTree as ET
c = open(r'<tmpHtmlPath>', encoding='utf-8').read()
try:
    ET.fromstring('<root xmlns:ac=\"http://atlassian.com/ac\">' + c + '</root>')
    print('XML well-formed: OK')
except ET.ParseError as e:
    print('XML parse error:', e)
"
```

## 常见错误

| 错误 | 后果 | 正解 |
|---|---|---|
| 直接把 Markdown 粘进 Confluence | 代码块丢失、表格错位 | 转成 Storage Format 再上传 |
| 普通 HTML 转换器（不处理自闭合） | `Error parsing xhtml: Unexpected close tag </p>; expected </br>` | 用本脚本 |
| 不做良构校验就上传 | 400，错误难定位 | 校验通过再上传 |
| 代码块不包 CDATA | `<` `>` `&` 破坏 XML | 脚本已处理，含 `]]>` 嵌套 |
| 不传 `version` | 并发编辑时覆盖他人改动 | 先读当前 version 再更新 |
| URL 解析不出 pageId 却硬猜 | 写到错误页面 | 用 `[?&]pageId=(\d+)` 提取，失败就停 |
| body 过大（>256KB） | REST 拒绝 | 拆分或精简文档；~50KB 实测无问题 |
| 临时 HTML 写到源码目录 | 污染 git 工作区 | 写到 `tmp/skills/md-to-wiki/` |
