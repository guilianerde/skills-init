// skill.json 一致性：元数据只有一份，这里保证它与实际文件、package.json、README 对得上
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSkills, deriveMeta, validCategory, TEMPLATE_CATEGORY } from '../bin/skills.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const skills = loadSkills(REPO);
const meta = deriveMeta(skills);
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');

test('每个 skill 有 SKILL.md.tpl，frontmatter name 与目录名一致', () => {
  assert.ok(skills.length >= 7);
  for (const s of skills) {
    const md = read(`${s.name}/SKILL.md.tpl`);
    assert.match(md, new RegExp(`^---\\r?\\nname: ${s.name}\\r?\\n`), s.name);
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

// skill 目录里的所有文本文件（SKILL.md、references、scripts、模板）
function skillFiles(name) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(md|tpl|mjs|json)$/.test(e.name) && e.name !== 'skill.json') out.push(p);
    }
  };
  walk(path.join(REPO, name));
  // 声明的共享文件安装后就是本 skill 的一部分，一并检查
  for (const f of skills.find((s) => s.name === name)?.shared ?? []) out.push(path.join(REPO, 'shared', f));
  return out;
}

test('requires / optional 只引用存在的 skill，且 requires 无环', () => {
  const names = new Set(meta.skills);
  for (const s of skills) {
    for (const d of [...s.requires, ...s.optional]) assert.ok(names.has(d) && d !== s.name, `${s.name} 依赖了不存在或自身：${d}`);
  }
  const byName = new Map(skills.map((s) => [s.name, s]));
  const visit = (n, stack) => {
    assert.ok(!stack.includes(n), `requires 有环：${[...stack, n].join(' -> ')}`);
    for (const d of byName.get(n).requires) visit(d, [...stack, n]);
  };
  for (const s of skills) visit(s.name, []);
});

test('跨 skill 的文件引用必须在 requires 或 optional 中声明', () => {
  // 形如 <other>/scripts/…、<other>/references/…、<other>/xxx.json|md|mjs 的路径引用
  for (const s of skills) {
    const declared = new Set([...s.requires, ...s.optional]);
    for (const f of skillFiles(s.name)) {
      const text = fs.readFileSync(f, 'utf8');
      for (const other of meta.skills) {
        if (other === s.name) continue;
        const re = new RegExp(`(?<![\\w-])${other}/(scripts|references)/|(?<![\\w-])${other}/[\\w.-]+\\.(json|md|mjs)\\b`);
        const m = text.match(re);
        if (m) assert.ok(declared.has(other), `${path.relative(REPO, f)} 引用了 ${m[0]}，但 ${s.name}/skill.json 没有声明依赖 ${other}`);
      }
    }
  }
});

test('requires 的依赖必须被实际使用（避免声明过时）', () => {
  for (const s of skills) {
    const text = skillFiles(s.name).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    for (const d of s.requires) assert.match(text, new RegExp(`${d}/`), `${s.name} 声明了 requires ${d}，但没有引用它的任何文件`);
  }
});

test('shared 声明的文件都存在，且每个共享文件至少被一个 skill 使用', () => {
  const used = new Set(skills.flatMap((s) => s.shared));
  for (const f of used) assert.ok(fs.existsSync(path.join(REPO, 'shared', f)), `shared/${f} 不存在`);
  for (const f of fs.readdirSync(path.join(REPO, 'shared'))) assert.ok(used.has(f), `shared/${f} 没有被任何 skill 声明`);
  for (const s of skills) for (const f of s.shared) assert.ok(!fs.existsSync(path.join(REPO, s.name, 'references', f)), `${s.name}/references/${f} 与共享文件重名`);
});

test('docnexus 分类：名称合法；会写入 DocNexus 的 skill 都声明分类，并在 SKILL.md 里经 resolve.mjs category 取用', () => {
  for (const s of skills) {
    const md = read(`${s.name}/SKILL.md.tpl`);
    if (s.docnexus) {
      assert.ok(validCategory(s.docnexus.category), `${s.name}: ${s.docnexus.category}`);
      assert.ok(s.docnexus.reason, s.name);
      assert.ok(md.includes(`resolve.mjs category ${s.name}`), `${s.name} 声明了分类但 SKILL.md 没有取用`);
    } else if (s.name !== 'workflow') {
      // workflow 只写模板（固定 doc-template）
      assert.doesNotMatch(md, /capture 流程/, `${s.name} 会写入 DocNexus，需在 skill.json 声明 docnexus.category`);
    }
  }
  assert.ok(validCategory(TEMPLATE_CATEGORY));
  for (const bad of ['', ' x', 'x ', 'a\nb', 'x'.repeat(81)]) assert.ok(!validCategory(bad), JSON.stringify(bad));
});

test('docnexus.readFrom：只引用已声明分类的 skill，且 SKILL.md 经 knowledge.mjs 取用', () => {
  const byName = new Map(skills.map((s) => [s.name, s]));
  for (const s of skills) {
    const from = s.docnexus?.readFrom ?? [];
    for (const n of from) assert.ok(byName.get(n)?.docnexus?.category, `${s.name} readFrom ${n}：该 skill 不存在或没有声明分类`);
    const md = read(`${s.name}/SKILL.md.tpl`);
    assert.equal(md.includes(`knowledge.mjs ${s.name}`), from.length > 0, `${s.name}：readFrom 与 SKILL.md 中的 knowledge.mjs 调用不一致`);
  }
});

test('引用的 <skills>/<skill>/references|scripts 路径都存在；跨 skill 引用指向文件而不是「某 skill 的某一节」', () => {
  const docs = skills.flatMap((s) => [`${s.name}/SKILL.md.tpl`, ...(fs.existsSync(path.join(REPO, s.name, 'references')) ? fs.readdirSync(path.join(REPO, s.name, 'references')).filter((f) => f.endsWith('.md')).map((f) => `${s.name}/references/${f}`) : [])]);
  docs.push(...fs.readdirSync(path.join(REPO, 'shared')).map((f) => `shared/${f}`));
  for (const d of docs) {
    const text = read(d);
    for (const [, skill, rel] of text.matchAll(/<skills>\/([\w-]+)\/((?:references|scripts)\/[\w.-]+\.(?:md|mjs))/g)) {
      const shared = rel.startsWith('references/') && skills.find((s) => s.name === skill)?.shared.includes(rel.slice('references/'.length));
      assert.ok(shared || fs.existsSync(path.join(REPO, skill, rel)), `${d} 引用了不存在的 ${skill}/${rel}`);
    }
    assert.doesNotMatch(text, /`[\w-]+` skill\s*「/, `${d}：跨 skill 引用请写文件路径（<skills>/<skill>/references/...），避免加载整篇 SKILL.md`);
  }
});
