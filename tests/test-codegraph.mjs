// --with-codegraph：用 PATH 上的假 codegraph / npm 记录调用，验证安装、MCP 配置目标、建索引、能力探测与 doctor
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { useLocalDocNexus } from './helpers/docnexus-pkg.mjs';

// 必装组件 DocNexus 用本地夹具接入：不依赖 npm registry，也不写用户的 ~/.npm。
useLocalDocNexus();

const REPO = fileURLToPath(new URL('..', import.meta.url));
const skip = process.platform === 'win32' ? '假 CLI 用 shebang 脚本实现，Windows 跳过' : false;

// 假 codegraph：记录参数与 DO_NOT_TRACK；init 时建 .codegraph/（有 init-fails 标记文件时失败）
const FAKE_CG = (log) => `#!/bin/sh
echo "$DO_NOT_TRACK $*" >> "${log}"
case "$1" in
  --version) echo "codegraph 1.6.2" ;;
  init) [ -f "$2/init-fails" ] && exit 1; mkdir -p "$2/.codegraph" ;;
esac
exit 0
`;
// 假 npm：i -g 时把假 codegraph 放进 PATH 上的目录。
// 其他调用（必装组件 DocNexus 的 `npm install --prefix ./.docnexus …`）必须透传给
// 真实 npm——PATH 被收窄过，所以用绝对路径调用，否则接入会失败。
const FAKE_NPM = (log, bin, cg, realNpm) => `#!/bin/sh
echo "$*" >> "${log}"
if [ "$1" = "i" ] && [ "$2" = "-g" ]; then cp "${cg}" "${bin}/codegraph"; chmod +x "${bin}/codegraph"; exit 0; fi
exec "${realNpm}" "$@"
`;

function setup({ installed = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-'));
  const root = path.join(base, 'proj'); const bin = path.join(base, 'bin');
  fs.mkdirSync(root); fs.mkdirSync(bin);
  spawnSync('git', ['init', '-q'], { cwd: root });
  const cgLog = path.join(base, 'cg.log'); const npmLog = path.join(base, 'npm.log');
  const cgSrc = path.join(base, 'codegraph.sh');
  fs.writeFileSync(cgSrc, FAKE_CG(cgLog), { mode: 0o755 });
  // 真实 npm 的绝对路径：本机 PATH 里查找（安装器要靠它装必装组件 DocNexus）
  const which = spawnSync('/bin/sh', ['-c', 'command -v npm'], { encoding: 'utf8' });
  const realNpm = which.status === 0 ? which.stdout.trim() : 'npm';
  fs.writeFileSync(path.join(bin, 'npm'), FAKE_NPM(npmLog, bin, cgSrc, realNpm), { mode: 0o755 });
  if (installed) fs.copyFileSync(cgSrc, path.join(bin, 'codegraph'));
  // PATH 只留假命令目录、node 与系统目录，避免用到本机真装的 codegraph
  const env = { ...process.env, PATH: [bin, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter), DO_NOT_TRACK: '' };
  const cli = (...a) => { const r = spawnSync(process.execPath, [path.join(REPO, 'bin/workflow-run.mjs'), '--project-root', root, ...a], { cwd: root, encoding: 'utf8', env }); return { status: r.status, log: `${r.stdout}\n${r.stderr}` }; };
  const calls = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n') : []);
  const status = () => JSON.parse(spawnSync(process.execPath, [path.join(root, '.agents/skills/workflow/scripts/resolve.mjs'), 'status'], { cwd: root, encoding: 'utf8', env }).stdout).codegraph;
  // npm 调用日志里还有版本探测（-v）与必装组件 DocNexus 的安装；codegraph 相关断言只看全局安装
  const npmCalls = () => calls(npmLog).filter((l) => l.startsWith('i -g '));
  return { base, root, cli, status, cg: () => calls(cgLog), npm: npmCalls };
}

test('--with-codegraph：已有 CLI 时为 claude / codex 写项目级 MCP 配置并建索引；不上报统计；能力探测与 doctor 识别', { skip }, () => {
  const t = setup();
  const r = t.cli('--envs', 'claude,codex,qwen', '--yes', '--skip-db', '--with-codegraph');
  assert.equal(r.status, 0, r.log);
  assert.deepEqual(t.npm(), [], '已有 codegraph 不再安装');
  const cg = t.cg();
  assert.ok(cg.includes(`1 install --target=claude,codex --location=local --yes`), cg.join('\n'));
  assert.ok(cg.includes(`1 init ${t.root} --yes`), cg.join('\n'));
  assert.ok(cg.every((l) => l.startsWith('1 ')), '本工具发起的调用都带 DO_NOT_TRACK=1');
  assert.match(r.log, /qwen：CodeGraph 不支持写 MCP 配置/);
  assert.match(r.log, /codegraph telemetry off/);
  assert.match(fs.readFileSync(path.join(t.root, '.gitignore'), 'utf8'), /^\.codegraph\/$/m);
  // 能力探测现在还会报告通道（library / scan / mode）：这里只断言与本用例相关的稳定子集
  const st = t.status();
  assert.deepEqual({ ok: st.ok, cli: st.cli, indexed: st.indexed, how: st.how }, { ok: true, cli: true, indexed: true, how: null });
  assert.match(t.cli('doctor', '--offline').log, /CodeGraph 已接入（codegraph 1\.6\.2/);
  fs.rmSync(t.base, { recursive: true, force: true });
});

test('--with-codegraph：没有 CLI 时 npm 全局安装；只选 qwen 时不写 MCP 配置', { skip }, () => {
  const t = setup({ installed: false });
  const r = t.cli('--envs', 'qwen', '--yes', '--skip-db', '--with-codegraph');
  assert.equal(r.status, 0, r.log);
  assert.deepEqual(t.npm(), ['i -g @colbymchenry/codegraph@1'], '按 1.x 安装（code-graph skill 按 1.x 的库接口编写）');
  assert.ok(!t.cg().some((l) => l.includes(' install ')), '没有可写 MCP 配置的环境');
  assert.ok(t.cg().includes(`1 init ${t.root} --yes`));
  fs.rmSync(t.base, { recursive: true, force: true });
});

test('建索引失败：安装返回非 0 并提示，skills 照常装好；没建索引时能力探测给出由用户建索引的提示', { skip }, () => {
  const t = setup();
  fs.writeFileSync(path.join(t.root, 'init-fails'), '');
  const r = t.cli('--envs', 'claude', '--yes', '--skip-db', '--with-codegraph');
  assert.equal(r.status, 1);
  assert.match(r.log, /CodeGraph 接入失败/);
  assert.ok(fs.existsSync(path.join(t.root, '.agents/skills/dev/SKILL.md')));
  const s = t.status();
  assert.deepEqual([s.ok, s.cli, s.indexed], [false, true, false]);
  assert.match(s.how, /codegraph init/);
  assert.match(t.cli('doctor', '--offline').log, /没有建索引/);
  fs.rmSync(t.base, { recursive: true, force: true });
});
