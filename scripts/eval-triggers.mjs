#!/usr/bin/env node
// 多 skill 分流评估：在临时项目里装好全部 skill，用 `claude -p` 逐条发送 evals/trigger-cases.json 中的请求，
// 从流式事件里取「第一个被调用的工具」判断请求被分给了哪个 skill（或没有触发任何本项目 skill）。
//
//   node scripts/eval-triggers.mjs [--runs 1] [--concurrency 4] [--model <id>] [--only <skill>]
//
// 注意：每条请求会真实调用一次 Claude（按你的 claude CLI 账号计费）；检测到第一个工具调用就终止进程，不会执行任何工具。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = ['workflow', 'dev', 'project-review', 'database-query', 'md-to-wiki', 'create-tech-md-doc', 'create-release-md-doc', 'code-graph'];

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const RUNS = Number(opt('--runs', 1));
const CONC = Number(opt('--concurrency', 4));
const MODEL = opt('--model', '');
const ONLY = opt('--only', '');
const TIMEOUT = 120_000;

let cases = JSON.parse(fs.readFileSync(path.join(REPO, 'evals', 'trigger-cases.json'), 'utf8'));
if (ONLY) cases = cases.filter((c) => c.expect.includes(ONLY));

// 临时项目：用安装器把 skills 装进 .claude/skills（软链接到 .agents/skills）
const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-init-eval-'));
spawnSync('git', ['init', '-q'], { cwd: proj });
const inst = spawnSync(process.execPath, [path.join(REPO, 'bin', 'skills-init.mjs'), '--project-root', proj, '--envs', 'claude', '--yes', '--skip-db'], { encoding: 'utf8' });
if (inst.status !== 0) { console.error(inst.stdout, inst.stderr); process.exit(1); }

function classify(toolName, input) {
  if (toolName === 'Skill') {
    const m = input.match(/"(?:skill|command|name)"\s*:\s*"([^"]+)"/);
    const s = m ? m[1].replace(/^\//, '').split(/\s/)[0] : '';
    return SKILLS.includes(s) ? s : `other:${s}`;
  }
  if (toolName === 'Read') {
    const m = input.match(/skills[\\/]+([^\\/"]+)[\\/]+SKILL\.md/);
    if (m) return SKILLS.includes(m[1]) ? m[1] : `other:${m[1]}`;
  }
  return 'none';
}

function runOne(query) {
  return new Promise((resolve) => {
    const cmd = ['-p', query, '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
    if (MODEL) cmd.push('--model', MODEL);
    const env = { ...process.env }; delete env.CLAUDECODE;
    const p = spawn('claude', cmd, { cwd: proj, env, stdio: ['ignore', 'pipe', 'ignore'] });
    let buf = '', tool = null, json = '', done = false, streamed = false;
    const finish = (r) => { if (done) return; done = true; p.kill('SIGKILL'); clearTimeout(t); resolve(r); };
    const t = setTimeout(() => finish('timeout'), TIMEOUT);
    p.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        // 额度用尽、未登录等调用失败：记为 error，不能当成「没触发 skill」
        if (ev.type === 'result' && ev.is_error) return finish('error');
        if (ev.type !== 'stream_event') continue;
        streamed = true;
        const se = ev.event || {};
        if (se.type === 'content_block_start' && se.content_block?.type === 'tool_use') {
          tool = se.content_block.name; json = '';
          if (tool !== 'Skill' && tool !== 'Read') return finish('none');
        } else if (se.type === 'content_block_delta' && tool && se.delta?.type === 'input_json_delta') {
          json += se.delta.partial_json || '';
        } else if (se.type === 'content_block_stop' && tool) {
          return finish(classify(tool, json));
        }
      }
    });
    p.on('close', () => finish(streamed ? 'none' : 'error')); // 一个流事件都没有：进程没正常跑起来
  });
}

// 期望 none 表示「不该触发本项目的 skill」：触发了用户环境里的其他 skill（如 other:anthropic-skills:pdf）也算对
const hit = (c, got) => c.expect.includes(got) || (got.startsWith('other:') && c.expect.includes('none'));

const jobs = [];
for (const c of cases) for (let r = 0; r < RUNS; r++) jobs.push(c);
const results = new Map(cases.map((c) => [c, []]));
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const c = jobs[next++];
    const got = await runOne(c.query);
    results.get(c).push(got);
    process.stderr.write(got === 'timeout' ? 'T' : got === 'error' ? 'E' : hit(c, got) ? '.' : 'x');
  }
}
console.error(`评估 ${cases.length} 条请求 × ${RUNS} 次，并发 ${CONC}，临时项目 ${proj}`);
await Promise.all(Array.from({ length: CONC }, worker));
process.stderr.write('\n');

const errors = [...results.values()].flat().filter((g) => g === 'error' || g === 'timeout').length;
let pass = 0, total = 0;
const rows = [];
for (const [c, got] of results) {
  const ok = got.filter((g) => hit(c, g)).length;
  pass += ok; total += got.length;
  rows.push({ ok: ok === got.length, expect: c.expect.join('|'), got: got.join(','), query: c.query });
}
for (const r of rows.filter((r) => !r.ok)) console.log(`✗ 期望 ${r.expect}，实际 ${r.got}\n    ${r.query}`);
console.log(`\n准确率 ${pass}/${total}（${(100 * pass / total).toFixed(0)}%）`);
if (errors) console.log(`⚠ ${errors} 次调用失败或超时（额度用尽 / 未登录 / 网络），结果不可信，请恢复后重跑`);
const out = path.join(REPO, 'tmp', 'evals', `trigger-${Date.now()}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(rows, null, 2));
console.log(`明细：${path.relative(REPO, out)}`);
fs.rmSync(proj, { recursive: true, force: true });
