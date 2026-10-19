// /workflow template：template.mjs 起草稿 → 校验与影响 → 保存（给出写入 DocNexus 的指引）；未接入 DocNexus 时默认模板只读
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
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-')), 'svc'); fs.mkdirSync(root); // 目录名 svc = 自动取的项目名
  assert.equal(node([path.join(REPO, 'bin/workflow-run.mjs'), '--project-root', root, '--envs', 'codex', '--skip-db', '--yes'], { cwd: root, env: { ...process.env, WORKFLOW_RUN_ADMIN: '1' } }).status, 0);
  const run = (...a) => { const r = node([path.join(root, '.agents/skills/workflow/scripts/template.mjs'), ...a], { cwd: root }); return { code: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr }; };
  return { root, run, draftFile: (skill, id = 'template.md') => path.join(root, 'workflow-run/tmp/template-draft', skill, id) };
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

const connect = (root) => {
  fs.mkdirSync(path.join(root, 'workflow-run/docnexus/node_modules/.bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'workflow-run/docnexus/project.json'), '{}');
  fs.writeFileSync(path.join(root, 'workflow-run/docnexus/node_modules/.bin', process.platform === 'win32' ? 'docnexus.cmd' : 'docnexus'), '');
};
const libFile = (root, skill, id = 'template.md') => path.join(root, 'workflow-run/docnexus/library/templates', skill, id);

test('未接入 DocNexus：默认模板只读，draft / save 退出码 2 提示先接入，不写任何模板', () => {
  const { root, run, draftFile } = project();
  let r = run('draft', 'delivery');
  assert.equal(r.code, 2);
  assert.deepEqual([r.out.need_docnexus, r.out.current], [true, '.agents/skills/dev/references/delivery-template.md']);
  assert.match(r.out.hint, /--with-docnexus/);
  assert.ok(!fs.existsSync(draftFile('dev', 'delivery-template.md')), '不起草稿');
  fs.mkdirSync(path.dirname(draftFile('dev', 'delivery-template.md')), { recursive: true });
  fs.writeFileSync(draftFile('dev', 'delivery-template.md'), '# 交付\n\n## 验证 *\n');
  r = run('save', 'delivery');
  assert.equal(r.code, 2);
  assert.equal(r.out.need_docnexus, true);
  assert.ok(!fs.existsSync(path.join(root, 'workflow-run/templates')), '不写项目模板');
  assert.equal(run('draft', 'tech').out.need_docnexus, true, '技术方案没有默认模板，也要先接入');
  fs.rmSync(root, { recursive: true, force: true });
});

test('已接入 DocNexus、没有模板时 draft 要样例；--from 抽骨架 → check → save 给出 capture 指引', () => {
  const { root, run, draftFile } = project();
  connect(root);
  let r = run('draft', 'tech');
  assert.equal(r.code, 2);
  assert.equal(r.out.need_sample, true);
  fs.writeFileSync(path.join(root, 'sample.md'), '# 【技术方案】订单导出\n\n## 一、背景 *\n\n运营要按渠道导出\n\n## 二、接口\n\n| 接口 | 说明 |\n|---|---|\n| /order/export | 加参数 |\n');
  r = run('draft', 'tech', '--from', 'sample.md');
  assert.equal(r.code, 0, r.err);
  assert.deepEqual([r.out.from, r.out.expected], ['sample', 'workflow-run/docnexus/library/templates/create-tech-md-doc/template.md']);
  assert.ok(!fs.readFileSync(draftFile('create-tech-md-doc'), 'utf8').includes('/order/export'));
  r = run('check', 'tech');
  assert.equal(r.code, 0);
  assert.equal(r.out.changes, null, '还没有当前模板');
  r = run('save', 'tech');
  assert.equal(r.code, 2, JSON.stringify(r.out));
  assert.match(r.out.hint, /--category doc-template/);
  assert.ok(!fs.existsSync(libFile(root, 'create-tech-md-doc')), '不直接写知识库');
  fs.rmSync(root, { recursive: true, force: true });
});

test('修改知识库里的模板：草稿沿用 / --force 重来；check 列出变化与对已生成文档的影响；save 不改知识库', () => {
  const { root, run, draftFile } = project();
  connect(root);
  const tplFile = libFile(root, 'create-release-md-doc');
  const TPL = '# 【上线方案】{{文档标题}}\n\n## 一、上线服务 *\n\n{{服务}}\n\n## 二、灰度\n\n{{灰度}}\n';
  fs.mkdirSync(path.dirname(tplFile), { recursive: true });
  fs.writeFileSync(tplFile, TPL);
  fs.mkdirSync(path.join(root, 'workflow-run/docs/requirements/x/svc'), { recursive: true });
  fs.writeFileSync(path.join(root, 'workflow-run/docs/requirements/x/svc/release-doc.md'), '# 【上线方案】x\n\n> 自动生成\n> 对比分支：`a` ←→ `main`\n> diff 概览\n> 模板来源：DocNexus\n\n## 一、上线服务\n\norder\n\n## 二、灰度\n\n无\n');

  let r = run('draft', 'release');
  assert.equal(r.out.from, 'docnexus');
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
  assert.equal(r.code, 2);
  assert.deepEqual([r.out.docnexus, r.out.expected], [true, 'workflow-run/docnexus/library/templates/create-release-md-doc/template.md']);
  assert.match(r.out.hint, /capture/);
  assert.deepEqual(r.out.changes.added, ['二、回滚 *']);
  assert.equal(fs.readFileSync(tplFile, 'utf8'), TPL, '知识库里的模板没被改');

  run('draft', 'release', '--force');
  r = run('save', 'release');
  assert.equal(r.out.saved, null, '没改动时不写入');
  fs.writeFileSync(d, '正文没有标题\n');
  r = run('save', 'release');
  assert.equal(r.code, 1, '草稿有错误时拒绝保存');
  r = run('draft', 'release', '--force');
  assert.equal(r.out.created, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('带默认版本的模板、知识库里还没有：草稿取默认模板，保存目标是知识库', () => {
  const { root, run, draftFile } = project();
  connect(root);
  let r = run('draft', 'delivery');
  assert.equal(r.out.from, 'import_from');
  assert.equal(r.out.expected, 'workflow-run/docnexus/library/templates/dev/delivery-template.md');
  assert.equal(fs.readFileSync(draftFile('dev', 'delivery-template.md'), 'utf8'), fs.readFileSync(path.join(root, '.agents/skills/dev/references/delivery-template.md'), 'utf8'));
  fs.appendFileSync(draftFile('dev', 'delivery-template.md'), '\n## 上线关注点（如有）\n\n{{要盯的指标}}\n');
  r = run('save', 'delivery');
  assert.equal(r.code, 2, JSON.stringify(r.out));
  assert.equal(r.out.expected, 'workflow-run/docnexus/library/templates/dev/delivery-template.md');
  assert.doesNotMatch(fs.readFileSync(path.join(root, '.agents/skills/dev/references/delivery-template.md'), 'utf8'), /上线关注点/, '默认模板没被改');
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
