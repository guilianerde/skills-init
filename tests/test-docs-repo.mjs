// 独立文档仓库：团队文档仓库克隆到项目根的 skills-init/（它自己是 git 仓库，代码仓库忽略它），产物在
// skills-init/docs/requirements/<需求名>/<项目名>/，项目名配置一次，写完提示提交（可关闭），跨服务需求共用一个需求目录
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
const ENV = { ...process.env, SKILLS_INIT_ADMIN: '1' };

// 一个工作区：团队文档仓库（远端 team-docs.git）+ 若干项目（各自装好 skills；clone 时把文档仓库克隆到 skills-init/）
function workspace() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'docsrepo-'));
  const remote = path.join(ws, 'team-docs.git');
  spawnSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  const seed = path.join(ws, 'seed');
  spawnSync('git', ['clone', '-q', remote, seed]);
  spawnSync('git', [...G, 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: seed });
  spawnSync('git', ['push', '-q', 'origin', 'HEAD:main'], { cwd: seed });
  const project = (name, branch, { clone = false } = {}) => {
    const root = path.join(ws, name);
    fs.mkdirSync(root);
    const git = (...a) => spawnSync('git', [...G, ...a], { cwd: root, encoding: 'utf8' });
    git('init', '-q', '-b', 'main'); git('commit', '-q', '--allow-empty', '-m', 'init'); git('checkout', '-q', '-b', branch);
    const cloneDocs = () => assert.equal(spawnSync('git', ['clone', '-q', remote, 'skills-init'], { cwd: root }).status, 0);
    if (clone) cloneDocs();
    const cli = (...a) => spawnSync(process.execPath, [path.join(REPO, 'bin/skills-init.mjs'), '--project-root', root, ...a], { cwd: root, encoding: 'utf8', env: ENV });
    const r = cli('--envs', 'codex', '--skip-db', '--yes');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const script = (s) => path.join(root, '.agents/skills/workflow/scripts', s);
    const run = (s, ...a) => { const x = spawnSync(process.execPath, [script(s), ...a], { cwd: root, encoding: 'utf8' }); return { code: x.status, out: x.stdout.trim().startsWith('{') || x.stdout.trim().startsWith('[') ? JSON.parse(x.stdout) : x.stdout, err: x.stderr }; };
    const req = (...a) => run('requirement.mjs', ...a);
    const put = (rel, text) => { fs.mkdirSync(path.dirname(path.resolve(root, rel)), { recursive: true }); fs.writeFileSync(path.resolve(root, rel), text); };
    const docsGit = (...a) => spawnSync('git', [...G, ...a], { cwd: path.join(root, 'skills-init'), encoding: 'utf8' });
    return { root, git, run, req, put, cli, cloneDocs, docsGit, docs: path.join(root, 'skills-init') };
  };
  return { ws, remote, project };
}

test('文档仓库克隆到 skills-init/：先要项目名（只配一次），之后产物写到 skills-init/docs/requirements/<需求>/<项目>/，引用用「仓库名:路径」', () => {
  const { ws, project } = workspace();
  const p = project('order-service', 'feature/order-export');
  assert.equal(p.req('which').out.mode, 'project', '默认 skills-init/ 随项目提交');
  assert.equal(p.req('config', '--repo', '../team-docs').code, 1, '--repo 已不支持');

  p.cloneDocs();
  let r = p.req('which');
  assert.equal(r.code, 2);
  assert.deepEqual([r.out.mode, r.out.need_project, r.out.suggested_project], ['repo', true, 'order-service']);
  assert.equal(p.req('path', 'delivery').code, 2);

  p.req('config', '--project', 'order-service');
  const profile = JSON.parse(fs.readFileSync(path.join(p.root, '.agents/skills/workflow/profile.json'), 'utf8'));
  assert.deepEqual(profile.artifacts, { project: 'order-service' });
  r = p.req('which');
  assert.deepEqual([r.code, r.out.bound, r.out.mode, r.out.project], [0, false, 'repo', 'order-service']);

  r = p.req('bind', '--name', '订单导出支持按渠道筛选');
  assert.equal(r.out.dir, 'skills-init/docs/requirements/订单导出支持按渠道筛选/order-service');
  r = p.req('path', 'delivery').out;
  assert.equal(r.path, 'skills-init/docs/requirements/订单导出支持按渠道筛选/order-service/delivery.md');
  assert.equal(r.cite, 'team-docs:docs/requirements/订单导出支持按渠道筛选/order-service/delivery.md');
  p.put(r.path, doc('交付', 'feature/order-export'));
  const meta = JSON.parse(fs.readFileSync(path.join(p.docs, 'docs/requirements/订单导出支持按渠道筛选/order-service/meta.json'), 'utf8'));
  assert.equal(meta.project, 'order-service');
  assert.equal(p.run('resolve.mjs', 'status').out.artifacts.mode, 'repo');

  // 升级后代码仓库忽略整个 skills-init/
  assert.equal(p.cli('upgrade').status, 0);
  assert.match(fs.readFileSync(path.join(p.root, '.gitignore'), 'utf8'), /^\/skills-init\/$/m);
  assert.equal(p.git('status', '--porcelain', '--', 'skills-init').stdout, '', '代码仓库里看不到产物');
  fs.rmSync(ws, { recursive: true, force: true });
});

test('写完提示提交：sync 输出 commit（文件、建议信息、命令），提交后清空；个人可用 --local 关闭提示', () => {
  const { ws, project } = workspace();
  const p = project('order-service', 'feature/order-export', { clone: true });
  p.req('config', '--project', 'order-service');
  p.req('bind', '--name', '订单导出');
  const { path: f } = p.req('path', 'review').out;
  p.put(f, doc('审查', 'feature/order-export'));
  let s = p.req('sync', f).out;
  assert.deepEqual(s.commit.files.sort(), ['docs/requirements/订单导出/order-service/meta.json', 'docs/requirements/订单导出/order-service/review.md']);
  assert.equal(s.commit.suggested_message, 'docs(订单导出): order-service 审查报告');
  assert.equal(s.commit.commands.length, 2);
  for (const c of s.commit.commands) assert.equal(spawnSync('sh', ['-c', c.replace('git -C', `git ${G.join(' ')} -C`)], { cwd: p.root }).status, 0, c);
  assert.equal(p.docsGit('log', '-1', '--format=%s').stdout.trim(), 'docs(订单导出): order-service 审查报告');
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

test('跨服务需求：其他项目在 which 里看到已有需求（推送后），用同名 bind 加入；视图里一个需求下按项目区分', () => {
  const { ws, project } = workspace();
  const a = project('order-service', 'feature/order-export', { clone: true });
  a.req('config', '--project', 'order-service');
  a.req('bind', '--name', '订单导出');
  a.put(a.req('path', 'delivery').out.path, doc('订单服务交付', 'feature/order-export'));
  a.docsGit('add', '-A'); a.docsGit('commit', '-q', '-m', 'docs'); a.docsGit('push', '-q', 'origin', 'HEAD:main');

  const b = project('pay-service', 'feature/export-pay', { clone: true });
  b.req('config', '--project', 'pay-service');
  const w = b.req('which').out;
  assert.deepEqual(w.other_projects.map((x) => [x.name, x.projects]), [['订单导出', ['order-service']]]);
  const r = b.req('bind', '--name', '订单导出').out;
  assert.deepEqual([r.dir, r.joined, r.created], ['skills-init/docs/requirements/订单导出/pay-service', true, true]);
  b.put(b.req('path', 'delivery').out.path, doc('支付服务交付', 'feature/export-pay'));
  assert.deepEqual(fs.readdirSync(path.join(b.docs, 'docs/requirements/订单导出')).sort(), ['order-service', 'pay-service']);

  const v = b.run('view.mjs', '--out', 'skills-init/tmp/v.html');
  assert.equal(v.code, 0, v.err);
  const html = fs.readFileSync(path.join(b.root, 'skills-init/tmp/v.html'), 'utf8');
  const data = JSON.parse(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]);
  const req = data.requirements.find((x) => x.name === '订单导出');
  assert.deepEqual(req.projects.sort(), ['order-service', 'pay-service']);
  assert.deepEqual(req.artifacts.map((x) => x.file).sort(), ['order-service/delivery.md', 'pay-service/delivery.md']);
  assert.equal(data.mode, 'repo');
  // artifacts.mjs（链路、PR 描述）只看本项目
  const av = b.run('artifacts.mjs', '--branch', 'feature/export-pay').out;
  assert.equal(av.latest.delivery.cite, 'team-docs:docs/requirements/订单导出/pay-service/delivery.md');
  fs.rmSync(ws, { recursive: true, force: true });
});
