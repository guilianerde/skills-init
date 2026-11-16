#!/usr/bin/env node
// 审查范围命令入口；范围、分类和分批规则位于 workflow/lib/review-scope.mjs。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { matchGlob } from '../lib/path-match.mjs';
import {
  classify,
  loadDiff,
  parseDiff,
  plan,
  readAt,
  reviewConfig,
  scope,
  skipReason,
  stripComments,
  stripRegexLiterals,
} from '../lib/review-scope.mjs';
import { resolveTemplate } from './resolve.mjs';

export { matchGlob, globToRegExp } from '../lib/path-match.mjs';
export { classify, loadDiff, parseDiff, plan, readAt, reviewConfig, scope, skipReason, stripComments, stripRegexLiterals };

export function checklistSections(text) {
  const out = {};
  const parts = text.replace(/\r/g, '').split(/^(?=## )/m);
  for (const part of parts) {
    const match = /^## (\d+)[.、．]/.exec(part);
    if (match) out[Number(match[1])] = part.trimEnd();
  }
  return out;
}

function languageBullet(section, lang) {
  if (!section || !lang) return null;
  const head = section.split('\n')[0];
  const bullet = section.split('\n').find((line) => line.includes(`**${lang}**`));
  return bullet ? `${head}\n${bullet}` : null;
}

function readChecklist(root) {
  const template = resolveTemplate(root, 'project-review', 'checklist.md');
  if (!template.ok) return { ok: false, error: template.hint ?? template.message ?? '取不到审查清单' };
  const abs = path.resolve(root, template.path);
  for (const file of [abs, `${abs}.tpl`]) {
    try { return { ok: true, path: template.path, text: fs.readFileSync(file, 'utf8') }; } catch { /* 下一个 */ }
  }
  return { ok: false, error: `读不到审查清单 ${template.path}` };
}

export function rulesFor(root, files, { config = reviewConfig(root), checklist = readChecklist(root), inScope = [] } = {}) {
  if (!checklist.ok) return checklist;
  const sections = checklistSections(checklist.text);
  const parsed = Object.keys(sections).length > 0;
  const known = new Map(inScope.map((entry) => [entry.path, entry]));
  const perFile = files.map((filePath) => {
    const key = filePath.split(path.sep).join('/').replace(/^\.\//, '');
    if (known.has(key)) {
      const { project_rules, ...entry } = known.get(key);
      const projectRules = config.rules
        .filter((rule) => rule?.path && rule?.rule && matchGlob(key, rule.path))
        .map((rule) => ({ path: rule.path, rule: rule.rule }));
      return { ...entry, ...(projectRules.length ? { project_rules: projectRules } : {}) };
    }
    let text = '';
    try { text = fs.readFileSync(path.join(root, key), 'utf8'); } catch { /* 缺失文件只做路径分类 */ }
    return { path: key, ...classify({ path: key, changed_text: text }, config.rules) };
  });
  const numbers = [...new Set(perFile.flatMap((entry) => entry.sections))].sort((a, b) => a - b);
  const languages = [...new Set(perFile.map((entry) => entry.lang).filter(Boolean))];
  const output = [`# 审查要点：${perFile.map((entry) => entry.path).join('、')}`, '', `清单：${checklist.path}`, ''];
  for (const entry of perFile) output.push(`- ${entry.path}：${entry.kind}，风险 ${entry.risk}，清单 ${entry.sections.join(' / ')}`);
  output.push('');
  if (!parsed) output.push('（清单没有「## <编号>.」格式的小节，按整份清单检查）', '', checklist.text.trim());
  for (const number of numbers) {
    if (!sections[number]) { output.push(`（清单里没有第 ${number} 节）`, ''); continue; }
    if (number === 14) {
      for (const language of languages) {
        const bullet = languageBullet(sections[14], language);
        if (bullet) output.push(bullet, '');
      }
      continue;
    }
    output.push(sections[number], '');
  }
  const projectRules = perFile.flatMap((entry) => (entry.project_rules ?? []).map((rule) => ({ ...rule, file: entry.path })));
  if (projectRules.length) {
    output.push('## 项目规则（workflow/profile.json 的 review.rules，和上面的清单一起检查）', '');
    for (const rule of projectRules) output.push(`- \`${rule.file}\`（匹配 \`${rule.path}\`）：${rule.rule}`);
  }
  return { ok: true, text: output.join('\n').trimEnd() + '\n' };
}

function main(argv) {
  let root = process.cwd();
  const options = { exclude: [] };
  const rest = [];
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--root') root = path.resolve(argv[++index] ?? '.');
    else if (argv[index] === '--diff') options.diff = argv[++index] ?? null;
    else if (argv[index] === '--base') options.base = argv[++index] ?? null;
    else if (argv[index] === '--exclude') options.exclude.push(...(argv[++index] ?? '').split(',').map((value) => value.trim()).filter(Boolean));
    else rest.push(argv[index]);
  }
  if (rest[0] === 'rules') {
    if (rest.length < 2) { console.error('用法: review-scope.mjs rules <文件> [<文件>…]'); return 1; }
    const scan = scope(root, options);
    const result = rulesFor(root, rest.slice(1), { inScope: scan.ok ? scan.review : [] });
    if (!result.ok) { console.error(result.error); return 1; }
    process.stdout.write(result.text);
    return 0;
  }
  if (rest.length) {
    console.error('用法: review-scope.mjs [--diff <base>...<head> | --base <分支>] [--exclude a,b] | rules <文件…>');
    return 1;
  }
  const result = scope(root, options);
  console.log(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 1;
}

export { main };
const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exit(main(process.argv.slice(2)));
