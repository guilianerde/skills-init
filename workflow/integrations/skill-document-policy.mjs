import fs from 'node:fs';
import path from 'node:path';

import { resolveTemplate, skillMeta } from '../scripts/resolve.mjs';
import { lint } from '../scripts/lint-doc.mjs';
import { ARTIFACT_TEMPLATES } from '../lib/artifact-finalize.mjs';

export function createSkillDocumentPolicy(root) {
  return Object.freeze({
    validate({ kind, text }) {
      const [skill, template] = ARTIFACT_TEMPLATES[kind] ?? [];
      if (!skill || !template) {
        return { ok: false, errors: [`不支持的正式产物类型：${kind}`], warnings: [] };
      }
      const resolved = resolveTemplate(root, skill, template);
      if (!resolved.ok) {
        return {
          ok: false,
          errors: [resolved.hint ?? resolved.message ?? `无法解析模板：${skill}/${template}`],
          warnings: [],
        };
      }
      const source = fs.readFileSync(path.resolve(root, resolved.path), 'utf8');
      const rules = skillMeta(skill).templates.find((item) => item.id === template)?.lint;
      return lint(text, source, rules);
    },
  });
}
