// skill.json 一致性：元数据只有一份，这里保证它与实际文件、package.json、README 对得上
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSkills, deriveMeta } from '../bin/skills.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const skills = loadSkills(REPO);
const meta = deriveMeta(skills);
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');

test('每个 skill 有 SKILL.md.tpl，frontmatter name 与目录名一致', () => {
  assert.ok(skills.length >= 7);
  for (const s of skills) {
    const md = read(`${s.name}/SKILL.md.tpl`);
    assert.match(md, new RegExp(`^---\\nname: ${s.name}\\n`), s.name);
  }
});

test('order 不重复', () => {
  const orders = skills.map((s) => s.order);
  assert.equal(new Set(orders).size, orders.length);
});

test('模板与用户文件的源路径都存在，模板 id 在 skill 内唯一', () => {
  for (const t of meta.templates) assert.ok(fs.existsSync(path.join(REPO, t.src)), t.src);
  for (const [key, blank] of Object.entries(meta.userFiles)) if (blank) assert.ok(fs.existsSync(path.join(REPO, blank)), `${key} -> ${blank}`);
  for (const s of skills) assert.equal(new Set(s.templates.map((t) => t.id)).size, s.templates.length, s.name);
});

test('改名签名不会误伤当前 skill', () => {
  for (const [old, { to, signature }] of Object.entries(meta.renamed)) {
    assert.ok(meta.skills.includes(to));
    assert.ok(!meta.skills.includes(old));
    assert.doesNotMatch(read(`${to}/SKILL.md.tpl`), signature);
  }
});

test('package.json files 与 README 覆盖全部 skill', () => {
  const pkg = JSON.parse(read('package.json'));
  const readme = read('README.md');
  for (const name of meta.skills) {
    assert.ok(pkg.files.includes(name), `package.json files 缺 ${name}`);
    assert.ok(readme.includes(name), `README 未提及 ${name}`);
  }
});
