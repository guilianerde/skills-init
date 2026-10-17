# 转换脚本与排错

## scripts/md-to-wiki.mjs

```
node md-to-wiki.mjs <inputMd> <outputHtml> [--banner <bannerMdPath>] [--no-banner]
node md-to-wiki.mjs --check <html>      # 只做良构校验
```

只用 Node 内置能力，不依赖第三方库，也不调用 wiki API：

1. 自带 Markdown 解析：ATX 标题、段落（单换行转 `<br/>`）、引用、有序 / 无序列表（可嵌套、任务列表）、GFM 表格（含对齐）、分隔线、行内代码 / 粗体 / 斜体 / 删除线 / 链接 / 图片 / 自动链接；
2. 围栏代码块转 `<ac:structured-macro ac:name="code">` 宏，代码放进 `<![CDATA[...]]>`；
3. 原始 HTML 一律转义成文本，HTML 注释直接丢弃，保证输出良构；
4. 可选 banner：`--banner` 文件，或把正文第一个引用块移进 `<ac:structured-macro ac:name="info">`；
5. 写出文件后自动做良构校验，不良构时退出码为 1 并给出行号。

不支持的语法（如 setext 标题、脚注、内嵌 HTML 排版）会按普通文本输出；需要时改用 Markdown 等价写法。

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

## 良构校验

```bash
node <skillDir>/scripts/md-to-wiki.mjs --check <tmpHtmlPath>
```

输出 `XML well-formed: OK` 即通过；否则会指出第几行、是未转义的 `&` / `<` 还是标签不匹配。

## 常见错误

| 错误 | 后果 | 正解 |
|---|---|---|
| 直接把 Markdown 粘进 Confluence | 代码块丢失、表格错位 | 转成 Storage Format 再上传 |
| 普通 HTML 转换器（不处理自闭合） | `Error parsing xhtml: Unexpected close tag </p>; expected </br>` | 用本脚本（输出均为自闭合标签） |
| 不做良构校验就上传 | 400，错误难定位 | 校验通过再上传 |
| 代码块不包 CDATA | `<` `>` `&` 破坏 XML | 脚本已处理，含 `]]>` 嵌套 |
| 不传 `version` | 并发编辑时覆盖他人改动 | 先读当前 version 再更新 |
| URL 解析不出 pageId 却硬猜 | 写到错误页面 | 用 `[?&]pageId=(\d+)` 提取，失败就停 |
| body 过大（>256KB） | REST 拒绝 | 拆分或精简文档；~50KB 实测无问题 |
| 临时 HTML 写到源码目录 | 污染 git 工作区 | 写到 `skills-init/tmp/md-to-wiki/` |
