// md-to-wiki 转换脚本单元测试：node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { convert, checkWellFormed } from '../md-to-wiki/scripts/md-to-wiki.mjs';

const SCRIPT = fileURLToPath(new URL('../md-to-wiki/scripts/md-to-wiki.mjs', import.meta.url));
const wellFormed = (html) => assert.deepEqual(checkWellFormed(html), { ok: true }, html);

test('标题、段落与单换行转 <br/>', () => {
  const h = convert('# 标题 #\n\n第一行\n第二行');
  assert.equal(h, '<h1>标题</h1><p>第一行<br/>第二行</p>');
});

test('行内格式与转义', () => {
  const h = convert('**粗** *斜* ~~删~~ `a<b>&c` [链接](https://x.com/?a=1&b=2) ![图](a.png) <https://y.com> 5 < 6 & 7');
  assert.match(h, /<strong>粗<\/strong>/);
  assert.match(h, /<em>斜<\/em>/);
  assert.match(h, /<del>删<\/del>/);
  assert.match(h, /<code>a&lt;b&gt;&amp;c<\/code>/);
  assert.match(h, /<a href="https:\/\/x.com\/\?a=1&amp;b=2">链接<\/a>/);
  assert.match(h, /<img src="a.png" alt="图"\/>/);
  assert.match(h, /<a href="https:\/\/y.com">https:\/\/y.com<\/a>/);
  assert.match(h, /5 &lt; 6 &amp; 7/);
  wellFormed(h);
});

test('下划线不在单词中间触发斜体', () => {
  assert.equal(convert('snake_case_name 和 _斜_'), '<p>snake_case_name 和 <em>斜</em></p>');
});

test('代码块转 code 宏，CDATA 终止符被拆开', () => {
  const h = convert('```java\nif (a < b && c) { x = "]]>"; }\n```');
  assert.equal(h, '<ac:structured-macro ac:name="code" ac:schema-version="1"><ac:parameter ac:name="language">java</ac:parameter>'
    + '<ac:plain-text-body><![CDATA[if (a < b && c) { x = "]]]]><![CDATA[>"; }\n]]></ac:plain-text-body></ac:structured-macro>');
  wellFormed(h);
});

test('代码块里的 # 和 > 不被当成标题或引用', () => {
  const h = convert('```\n# not heading\n> not quote\n```');
  assert.doesNotMatch(h, /<h1>|<blockquote>/);
});

test('表格含对齐、管道转义与缺失单元格', () => {
  const h = convert('| 名 | 值 | 说明 |\n|:---|---:|:-:|\n| a | 1 | x \\| y |\n| b | 2 |');
  assert.match(h, /<th style="text-align: left">名<\/th>/);
  assert.match(h, /<td style="text-align: right">1<\/td>/);
  assert.match(h, /<td style="text-align: center">x \| y<\/td>/);
  assert.match(h, /<tr><td style="text-align: left">b<\/td><td style="text-align: right">2<\/td><td style="text-align: center"><\/td><\/tr>/);
  wellFormed(h);
});

test('嵌套列表、有序列表起始值、任务列表', () => {
  const h = convert('- 一\n  - 一.1\n  - 一.2\n- 二\n\n3. 三\n4. 四\n\n- [x] 完成\n- [ ] 未完成');
  assert.match(h, /<ul><li>一<ul><li>一.1<\/li><li>一.2<\/li><\/ul><\/li><li>二<\/li><\/ul>/);
  assert.match(h, /<ol start="3"><li>三<\/li><li>四<\/li><\/ol>/);
  assert.match(h, /<li>☑ 完成<\/li><li>☐ 未完成<\/li>/);
  wellFormed(h);
});

test('列表项里的代码块', () => {
  const h = convert('1. 执行：\n\n   ```bash\n   npm test\n   ```\n2. 完成');
  assert.match(h, /<li><p>执行：<\/p><ac:structured-macro[^>]*><ac:parameter ac:name="language">bash<\/ac:parameter><ac:plain-text-body><!\[CDATA\[npm test\n\]\]>/);
  wellFormed(h);
});

test('引用、分隔线、HTML 注释与原始 HTML', () => {
  const h = convert('> 引用 **重点**\n> 第二行\n\n---\n\n<!-- 注释 -->\n<div>raw</div>');
  assert.match(h, /^<blockquote><p>引用 <strong>重点<\/strong><br\/>第二行<\/p><\/blockquote><hr\/>/);
  assert.doesNotMatch(h, /注释/);
  assert.match(h, /&lt;div&gt;raw&lt;\/div&gt;/);
  wellFormed(h);
});

test('良构校验能发现问题', () => {
  assert.equal(checkWellFormed('<p>a<br></p>').ok, false);
  assert.equal(checkWellFormed('<p>a & b</p>').ok, false);
  assert.equal(checkWellFormed('<p><strong>x</p></strong>').ok, false);
  assert.equal(checkWellFormed('<p>x</p><![CDATA[ < & ]]>').ok, true);
});

test('CLI：第一个引用块移入 info 宏，不在正文重复', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md2wiki-'));
  const md = path.join(dir, 'a.md'); const out = path.join(dir, 'out', 'a.html');
  fs.writeFileSync(md, '# 方案\n\n```\n> 代码里的引用不算\n```\n\n> 自动生成，需人工校对\n\n正文');
  const r = spawnSync(process.execPath, [SCRIPT, md, out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const h = fs.readFileSync(out, 'utf8');
  assert.match(h, /^<ac:structured-macro ac:name="info"[^>]*><ac:rich-text-body><p>自动生成，需人工校对<\/p>/);
  assert.equal(h.match(/自动生成/g).length, 1);
  assert.match(h, /代码里的引用不算/);
  assert.equal(spawnSync(process.execPath, [SCRIPT, md, out, '--no-banner'], { encoding: 'utf8' }).status, 0);
  assert.doesNotMatch(fs.readFileSync(out, 'utf8'), /ac:name="info"/);
  assert.equal(spawnSync(process.execPath, [SCRIPT, '--check', out], { encoding: 'utf8' }).status, 0);
  fs.writeFileSync(out, '<p>bad<br></p>');
  assert.equal(spawnSync(process.execPath, [SCRIPT, '--check', out], { encoding: 'utf8' }).status, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
