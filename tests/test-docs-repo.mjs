// 产物放在独立文档仓库（workflow/profile.json 的 artifacts.repo）：<文档仓库>/<需求名>/<项目名>/，项目名配置一次，
// 写完提示提交（可关闭），跨服务需求共用一个需求目录，迁移把项目里的产物搬过去
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const G = ['-c', 'user.email=t@t', '-c', 'user.name=t'];
const doc = (title, branch, extra = '') => `${extra}# ${title}\n\n> 日期：2026-10-15\n> 对比分支：\`${branch}\` ←→ \`main\`\n\n## 结果\n\nok\n`;

// 一个工作区：文档仓库 + 若干项目（各自装好 skills）
function workspace() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'docsrepo-'));
  const docs = path.join(ws, 'team-docs');
  fs.mkdirSync(docs);
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: docs });
  spawnSync('git', [...G, 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: docs });
  const project = (name, branch) => {
    const root = path.join(ws, name);
    fs.mkdirSync(root);
    const git = (...a) => spawnSync('git', [...G, ...a], { cwd: root, encoding: 'utf8' });
    git('init', '-q', '-b', 'main'); git('commit', '-q', '--allow-empty', '-m', 'init'); git('checkout', '-q', '-b', branch);
    const r = spawnSync(process.execPath, [path.join(REPO, 'bin/skills-init.mjs'), '--project-root', root, '--envs', 'codex', '--skip-db', '--yes'], { cwd: root, encoding: 'utf8', env: { ...process.env, SKILLS_INIT_ADMIN: '1' } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const script = (s) => path.join(root, '.agents/skills/workflow/scripts', s);
    const run = (s, ...a) => { const x = spawnSync(process.execPath, [script(s), ...a], { cwd: root, encoding: 'utf8' }); return { code: x.status, out: x.stdout.trim().startsWith('{') || x.stdout.trim().startsWith('[') ? JSON.parse(x.stdout) : x.stdout, err: x.stderr }; };
    const req = (...a) => run('requirement.mjs', ...a);
    const put = (rel, text) => { fs.mkdirSync(path.dirname(path.resolve(root, rel)), { recursive: true }); fs.writeFileSync(path.resolve(root, rel), text); };
    return { root, git, run, req, put };
  };
  return { ws, docs, project };
}

test('配置文档仓库：先要项目名（只配一次），之后产物写到 <文档仓库>/<需求>/<项目>/，引用用「仓库名:路径」', () => {
  const { ws, docs, project } = workspace();
  const p = project('order-service', 'feature/order-export');
  assert.equal(p.req('which').out.mode, 'project', '默认放在项目里');

  let r = p.req('config', '--repo', '../nope');
  assert.equal(r.out.effective.ok, false);
  assert.equal(p.req('which').code, 2);
  assert.equal(p.req('which').out.need_repo, true);

  p.req('config', '--repo', '../team-docs');
  r = p.req('which');
  assert.equal(r.code, 2);
  assert.equal(r.out.need_project, true);
  assert.equal(r.out.suggested_project, 'order-service');
  assert.equal(p.req('path', 'delivery').code, 2);

  p.req('config', '--project', 'order-service');
  const profile = JSON.parse(fs.readFileSync(path.join(p.root, '.agents/skills/workflow/profile.json'), 'utf8'));
  assert.deepEqual(profile.artifacts, { repo: '../team-docs', project: 'order-service' });
  r = p.req('which');
  assert.deepEqual([r.code, r.out.bound, r.out.mode, r.out.project], [0, false, 'repo', 'order-service']);

  r = p.req('bind', '--name', '订单导出支持按渠道筛选');
  assert.equal(r.out.dir, '../team-docs/订单导出支持按渠道筛选/order-service');
  r = p.req('path', 'delivery').out;
  assert.equal(r.path, '../team-docs/订单导出支持按渠道筛选/order-service/delivery.md');
  assert.equal(r.cite, 'team-docs:订单导出支持按渠道筛选/order-service/delivery.md');
  p.put(r.path, doc('交付', 'feature/order-export'));
  assert.ok(fs.existsSync(path.join(docs, '订单导出支持按渠道筛选/order-service/delivery.md')));
  assert.equal(p.git('status', '--porcelain', '--', 'docs').stdout, '', '项目仓库里没有产物');
  const meta = JSON.parse(fs.readFileSync(path.join(docs, '订单导出支持按渠道筛选/order-service/meta.json'), 'utf8'));
  assert.equal(meta.project, 'order-service');
  assert.equal(p.run('resolve.mjs', 'status').out.artifacts.mode, 'repo');
  fs.rmSync(ws, { recursive: true, force: true });
});

test('写完提示提交：sync 输出 commit（文件、建议信息、命令），提交后清空；个人可用 --local 关闭提示', () => {
  const { ws, docs, project } = workspace();
  const p = project('order-service', 'feature/order-export');
  p.req('config', '--repo', '../team-docs', '--project', 'order-service');
  p.req('bind', '--name', '订单导出');
  const { path: f } = p.req('path', 'review').out;
  p.put(f, doc('审查', 'feature/order-export'));
  let s = p.req('sync', f).out;
  assert.deepEqual(s.commit.files.sort(), ['订单导出/order-service/meta.json', '订单导出/order-service/review.md']);
  assert.equal(s.commit.suggested_message, 'docs(订单导出): order-service 审查报告');
  assert.equal(s.commit.commands.length, 2);
  for (const c of s.commit.commands) assert.equal(spawnSync('sh', ['-c', c.replace('git -C', `git ${G.join(' ')} -C`)], { cwd: p.root }).status, 0, c);
  assert.equal(spawnSync('git', ['log', '-1', '--format=%s'], { cwd: docs, encoding: 'utf8' }).stdout.trim(), 'docs(订单导出): order-service 审查报告');
  assert.equal(p.req('sync', f).out.commit, null, '提交后没有待提交的');
  assert.deepEqual(p.req('pending').out.files, []);

  p.put(p.req('path', 'review').out.path, doc('复审', 'feature/order-export'));
  p.req('config', '--commit-prompt', 'off', '--local');
  assert.equal(p.req('sync').out.commit, null, '关闭后不提示');
  assert.equal(p.req('pending').out.files.length, 2, 'pending 照样能看到');
  const local = path.join(p.root, '.agents/skills/workflow/profile.local.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(local, 'utf8')).artifacts, { commit_prompt: false });
  assert.equal(spawnSync('git', ['check-ignore', '-q', local], { cwd: p.root }).status, 0, '个人设置不提交');
  assert.equal(JSON.parse(fs.readFileSync(path.join(p.root, '.agents/skills/workflow/profile.json'), 'utf8')).artifacts.commit_prompt, undefined, '团队配置不变');
  fs.rmSync(ws, { recursive: true, force: true });
});

test('跨服务需求：其他项目在 which 里看到已有需求，用同名 bind 加入；视图里一个需求下按项目区分', () => {
  const { ws, docs, project } = workspace();
  const a = project('order-service', 'feature/order-export');
  a.req('config', '--repo', '../team-docs', '--project', 'order-service');
  a.req('bind', '--name', '订单导出');
  a.put(a.req('path', 'delivery').out.path, doc('订单服务交付', 'feature/order-export'));

  const b = project('pay-service', 'feature/export-pay');
  b.req('config', '--repo', '../team-docs', '--project', 'pay-service');
  const w = b.req('which').out;
  assert.deepEqual(w.other_projects.map((x) => [x.name, x.projects]), [['订单导出', ['order-service']]]);
  const r = b.req('bind', '--name', '订单导出').out;
  assert.deepEqual([r.dir, r.joined, r.created], ['../team-docs/订单导出/pay-service', true, true]);
  b.put(b.req('path', 'delivery').out.path, doc('支付服务交付', 'feature/export-pay'));
  assert.deepEqual(fs.readdirSync(path.join(docs, '订单导出')).sort(), ['order-service', 'pay-service']);

  const v = b.run('view.mjs', '--out', 'tmp/v.html');
  assert.equal(v.code, 0, v.err);
  const html = fs.readFileSync(path.join(b.root, 'tmp/v.html'), 'utf8');
  const data = JSON.parse(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]);
  const req = data.requirements.find((x) => x.name === '订单导出');
  assert.deepEqual(req.projects.sort(), ['order-service', 'pay-service']);
  assert.deepEqual(req.artifacts.map((x) => x.file).sort(), ['order-service/delivery.md', 'pay-service/delivery.md']);
  assert.equal(data.mode, 'repo');
  // artifacts.mjs（链路、PR 描述）只看本项目
  const av = b.run('artifacts.mjs', '--branch', 'feature/export-pay').out;
  assert.equal(av.latest.delivery.cite, 'team-docs:订单导出/pay-service/delivery.md');
  fs.rmSync(ws, { recursive: true, force: true });
});

test('迁移到文档仓库：升级只提示不搬；migrate 把旧布局和项目里的需求目录搬过去，引用改成「仓库名:路径」', () => {
  const { ws, docs, project } = workspace();
  const p = project('order-service', 'feature/order-export');
  // 先在默认模式下有一个需求目录，再加一份旧布局的审查报告
  p.req('bind', '--name', '订单导出');
  p.put(p.req('path', 'delivery').out.path, doc('交付', 'feature/order-export'));
  p.put('docs/skills/project-review/review-feature-order-export-20261016.md', doc('审查', 'feature/order-export').replace('## 结果', '> 参考产物：docs/skills/requirements/订单导出/delivery.md\n\n## 结果'));
  p.git('add', '-A'); p.git('commit', '-q', '-m', 'docs');
  p.req('config', '--repo', '../team-docs', '--project', 'order-service');

  const up = spawnSync(process.execPath, [path.join(REPO, 'bin/skills-init.mjs'), 'upgrade', '--project-root', p.root], { cwd: p.root, encoding: 'utf8', env: { ...process.env, SKILLS_INIT_ADMIN: '1' } });
  assert.equal(up.status, 0, up.stdout + up.stderr);
  assert.match(up.stdout + up.stderr, /项目里还有 2 份旧产物没搬/);
  assert.ok(fs.existsSync(path.join(p.root, 'docs/skills/requirements/订单导出/delivery.md')), '升级不跨仓库搬文件');

  const dry = p.req('migrate', '--dry-run').out;
  assert.deepEqual(dry.from_project, ['docs/skills/requirements/订单导出']);
  const r = p.req('migrate').out;
  assert.equal(r.moved, 2);
  const dir = path.join(docs, '订单导出/order-service');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['delivery.md', 'meta.json', 'review.md']);
  assert.match(fs.readFileSync(path.join(dir, 'review.md'), 'utf8'), /参考产物：team-docs:订单导出\/order-service\/delivery\.md/);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  assert.deepEqual([meta.name, meta.project, meta.branches], ['订单导出', 'order-service', ['feature/order-export']]);
  assert.ok(!fs.existsSync(path.join(p.root, 'docs/skills/requirements')), '项目里的需求目录搬空后删除');
  assert.ok(!fs.existsSync(path.join(p.root, 'docs/skills/project-review')));
  assert.equal(p.req('which').out.dir, '../team-docs/订单导出/order-service', '分支绑定跟着过去');
  fs.rmSync(ws, { recursive: true, force: true });
});
