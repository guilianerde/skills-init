#!/usr/bin/env node
// 正式文档写入入口；草稿在 tmp 中编辑，lint 通过后再发布、登记索引与运行证据。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveTemplate, skillMeta } from './resolve.mjs';
import { lint } from './lint-doc.mjs';
import { ARTIFACT_TEMPLATES, finalizeArtifact, resumeFinalization, abortFinalization } from '../lib/artifact-finalize.mjs';

export function main(argv) {
  try {
    const args = [...argv]; const action = args.shift(); const opts = {};
    while (args.length) {
      const key = args.shift();
      if (!['--root', '--branch', '--id', '--expect-revision', '--kind', '--draft', '--input', '--packet', '--result'].includes(key) || !args.length) throw new Error(`未知或缺少值的参数：${key}`);
      opts[key.slice(2)] = args.shift();
    }
    const root = path.resolve(opts.root ?? '.');
    const branch = opts.branch ?? spawnSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout?.trim();
    const read = (p) => p ? JSON.parse(fs.readFileSync(p === '-' ? 0 : path.resolve(root, p), 'utf8')) : undefined;
    let out;
    if (action === 'resume') out = resumeFinalization(root, { branch, id: opts.id });
    else if (action === 'abort') out = abortFinalization(root, { branch, id: opts.id });
    else if (action === 'finalize') {
      const [skill, template] = ARTIFACT_TEMPLATES[opts.kind] ?? [];
      if (!skill || !opts.draft) throw new Error('finalize 需要 --kind clarification|requirement|plan|review|delivery|tech|release 和 --draft <草稿.md>');
      const resolved = resolveTemplate(root, skill, template);
      if (!resolved.ok) throw new Error(resolved.hint ?? JSON.stringify(resolved));
      const source = fs.readFileSync(path.resolve(root, resolved.path), 'utf8');
      const rules = skillMeta(skill).templates.find((t) => t.id === template).lint;
      out = finalizeArtifact(root, { branch, id: opts.id, revision: Number(opts['expect-revision']), kind: opts.kind,
        text: fs.readFileSync(path.resolve(root, opts.draft), 'utf8'), input: read(opts.input) ?? {}, packet: read(opts.packet), result: read(opts.result) }, (text) => lint(text, source, rules));
    } else throw new Error('用法：artifact.mjs finalize --id <id> --expect-revision <n> --kind <种类> --draft <草稿> [--input <checkpoint.json>] [--packet <handoff.json> --result <审查结果.json>] | resume --id <id> | abort --id <id>');
    console.log(JSON.stringify(out, null, 2)); return 0;
  } catch (e) { console.error(e.message); return 1; }
}
const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exit(main(process.argv.slice(2)));
