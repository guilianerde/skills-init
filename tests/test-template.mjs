// /workflow template：template.mjs 起草稿 → 校验与影响 → 保存（备份、确认生效）；已接入 DocNexus 时不直接写知识库
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkFormat, compare } from '../workflow/scripts/template.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const node = (args, opts = {}) => spawnSync(process.execPath, args, { encoding: 'utf8', ...opts });

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-'));
  assert.equal(node([path.join(REPO, 'bin/skills-init.mjs'), '--project-root', root, '--envs', 'codex', '--skip-db', '--yes'], { cwd: root, env: { ...process.env, SKILLS_INIT_ADMIN: '1' } }).status, 0);
  const run = (...a) => { const r = node([path.join(root, '.agents/skills/workflow/scripts/template.mjs'), ...a], { cwd: root }); return { code: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr }; };
  return { root, run, draftFile: (skill, id = 'template.md') => path.join(root, 'skills-init/tmp/template-draft', skill, id) };
}

test('checkFormat：没有标题、{{ }} 不成对、{{fact:}} 是错误；元信息块、重名、没有必填是警告', () => {
  assert.ok(checkFormat('只有正文\n').errors.length);
  const bad = checkFormat('# 标题\n\n## 一 *\n\n{{写什么\n\n{{fact:abc}}\n');
  assert.equal(bad.errors.length, 2);
  const w = checkFormat('> 自动生成\n# T\n\n## 背景\n\n## 1. 背景\n').warnings.join('\n');
  assert.match(w, /元信息/);
  assert.match(w, /重名/);
  assert.match(w, /没有标记必填/);
  const ok = checkFormat('# T\n\n## 背景 *\n\n## 配置（如有）\n');
  assert.deepEqual([ok.errors, ok.warnings, ok.required, ok.optional], [[], [], ['背景'], ['配置（如有）']]);
});

test('compare：按归一化标题比对，改编号不算变化；列出增删、标记变化与顺序', () => {
  const c = compare('# T\n## 一、背景 *\n## 二、接口\n## 三、配置\n', '# T\n## 1. 背景 *\n## 2. 配置\n## 3. 接口（如有）\n## 4. 回滚 *\n');
  assert.deepEqual(c.added, ['4. 回滚 *']);
  assert.deepEqual(c.removed, []);
  assert.deepEqual(c.marks, ['3. 接口（如有）：普通 → 如有']);
  assert.equal(c.reordered, true);
});

test('没有模板时 draft 要样例；--from 抽骨架 → check → save 写入项目模板并生效', () => {
  const { root, run, draftFile } = project();
  let r = run('draft', 'tech');
  assert.equal(r.code, 2);
  assert.equal(r.out.need_sample, true);
  fs.writeFileSync(path.join(root, 'sample.md'), '# 【技术方案】订单导出\n\n## 一、背景 *\n\n运营要按渠道导出\n\n## 二、接口\n\n| 接口 | 说明 |\n|---|---|\n| /order/export | 加参数 |\n');
  r = run('draft', 'tech', '--from', 'sample.md');
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.from, 'sample');
  assert.ok(!fs.readFileSync(draftFile('create-tech-md-doc'), 'utf8').includes('/order/export'));
  r = run('check', 'tech');
  assert.equal(r.code, 0);
  assert.equal(r.out.changes, null, '还没有当前模板');
  r = run('save', 'tech');
  assert.equal(r.code, 0, JSON.stringify(r.out));
  assert.deepEqual([r.out.saved, r.out.backup, r.out.effective, r.out.source], ['skills-init/templates/create-tech-md-doc/template.md', null, true, 'project']);
  assert.ok(!fs.existsSync(draftFile('create-tech-md-doc')), '保存后删除草稿');
  fs.rmSync(root, { recursive: true, force: true });
});

test('修改已有模板：草稿沿用 / --force 重来；check 列出变化与对已生成文档的影响；save 备份旧模板', () => {
  const { root, run, draftFile } = project();
  const tplFile = path.join(root, 'skills-init/templates/create-release-md-doc/template.md');
  fs.mkdirSync(path.dirname(tplFile), { recursive: true });
  fs.writeFileSync(tplFile, '# 【上线方案】{{文档标题}}\n\n## 一、上线服务 *\n\n{{服务}}\n\n## 二、灰度\n\n{{灰度}}\n');
  fs.mkdirSync(path.join(root, 'skills-init/docs/requirements/x'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills-init/docs/requirements/x/release-doc.md'), '# 【上线方案】x\n\n> 自动生成\n> 对比分支：`a` ←→ `main`\n> diff 概览\n> 模板来源：项目文件\n\n## 一、上线服务\n\norder\n\n## 二、灰度\n\n无\n');

  let r = run('draft', 'release');
  assert.equal(r.out.from, 'project');
  const d = draftFile('create-release-md-doc');
  fs.writeFileSync(d, '# 【上线方案】{{文档标题}}\n\n## 一、上线服务 *\n\n{{服务}}\n\n## 二、回滚 *\n\n{{回滚步骤}}\n');
  r = run('draft', 'release');
  assert.equal(r.out.created, false, '已有草稿时沿用');
  assert.match(fs.readFileSync(d, 'utf8'), /回滚/);

  r = run('check', 'release');
  assert.equal(r.code, 0);
  assert.deepEqual(r.out.changes.added, ['二、回滚 *']);
  assert.deepEqual(r.out.changes.removed, ['二、灰度']);
  assert.equal(r.out.impact.docs, 1);
  assert.deepEqual(r.out.impact.affected[0].new_errors, ['缺少必填章节「二、回滚」']);

  r = run('save', 'release');
  assert.equal(r.code, 0);
  assert.match(r.out.backup, /^skills-init\/tmp\/template-backup\/[\d-]+\/create-release-md-doc\/template\.md$/);
  assert.match(fs.readFileSync(path.join(root, r.out.backup), 'utf8'), /灰度/);
  assert.match(fs.readFileSync(tplFile, 'utf8'), /回滚/);

  run('draft', 'release');
  r = run('save', 'release');
  assert.equal(r.out.saved, null, '没改动时不写入');
  fs.writeFileSync(d, '正文没有标题\n');
  r = run('save', 'release');
  assert.equal(r.code, 1, '草稿有错误时拒绝保存');
  assert.match(fs.readFileSync(tplFile, 'utf8'), /回滚/);
  r = run('draft', 'release', '--force');
  assert.equal(r.out.created, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('带默认版本的模板：草稿取默认模板，保存到项目后优先生效', () => {
  const { root, run, draftFile } = project();
  let r = run('draft', 'delivery');
  assert.equal(r.out.source, 'default');
  assert.equal(r.out.expected, 'skills-init/templates/dev/delivery-template.md');
  fs.appendFileSync(draftFile('dev', 'delivery-template.md'), '\n## 上线关注点（如有）\n\n{{要盯的指标}}\n');
  r = run('save', 'delivery');
  assert.equal(r.code, 0, JSON.stringify(r.out));
  assert.equal(r.out.source, 'project');
  assert.deepEqual(r.out.changes.added, ['上线关注点（如有）']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('已接入 DocNexus：save 不写知识库，退出码 2 给出 capture 指引', () => {
  const { root, run } = project();
  fs.mkdirSync(path.join(root, 'skills-init/docnexus/node_modules/.bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills-init/docnexus/project.json'), '{}');
  fs.writeFileSync(path.join(root, 'skills-init/docnexus/node_modules/.bin', process.platform === 'win32' ? 'docnexus.cmd' : 'docnexus'), '');
  const lib = path.join(root, 'skills-init/docnexus/library/templates/create-tech-md-doc/template.md');
  fs.mkdirSync(path.dirname(lib), { recursive: true });
  fs.writeFileSync(lib, '# 【技术方案】{{文档标题}}\n\n## 背景 *\n');
  let r = run('draft', 'tech');
  assert.equal(r.out.source, 'docnexus');
  fs.appendFileSync(path.join(root, r.out.draft), '\n## 回滚 *\n');
  r = run('save', 'tech');
  assert.equal(r.code, 2);
  assert.equal(r.out.docnexus, true);
  assert.match(r.out.hint, /capture/);
  assert.equal(fs.readFileSync(lib, 'utf8'), '# 【技术方案】{{文档标题}}\n\n## 背景 *\n', '知识库里的模板没被改');
  fs.rmSync(root, { recursive: true, force: true });
});

test('参数：未知模板与缺子命令退出 1；list 列出别名与来源', () => {
  const { root, run } = project();
  assert.equal(run('draft', 'nope').code, 1);
  assert.equal(run().code, 1);
  const l = run('list').out;
  assert.deepEqual(l.map((x) => x.alias), ['tech', 'release', 'plan', 'delivery', 'review', 'checklist']);
  assert.equal(l.find((x) => x.alias === 'review').source, 'default');
  assert.equal(l.find((x) => x.alias === 'tech').missing, true);
  fs.rmSync(root, { recursive: true, force: true });
});
