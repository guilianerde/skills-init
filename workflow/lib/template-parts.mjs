// 文档模板可把写作要求放在正文骨架之前。旧模板仍视为完整骨架。
import { proseLines } from './document-model.mjs';

export const RULES_MARKER = '<!-- workflow-run:template-rules -->';
export const CONTENT_MARKER = '<!-- workflow-run:template-content -->';

export function templateParts(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const prose = proseLines(text);
  const rules = prose.filter(({ text }) => text.trim() === RULES_MARKER).map(({ line }) => line - 1);
  const content = prose.filter(({ text }) => text.trim() === CONTENT_MARKER).map(({ line }) => line - 1);
  if (!rules.length && !content.length) return { content: text, offset: 0 };
  if (rules.length !== 1 || content.length !== 1 || rules[0] >= content[0] || lines.slice(0, rules[0]).some((line) => line.trim())) {
    return { content: '', error: '模板的要求和内容标记不完整、重复或顺序错误' };
  }
  const offset = content[0] + 1;
  return { rules: lines.slice(rules[0] + 1, content[0]).join('\n'), content: lines.slice(offset).join('\n'), offset };
}
