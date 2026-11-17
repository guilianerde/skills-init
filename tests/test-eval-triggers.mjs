import test from 'node:test';
import assert from 'node:assert/strict';

import { checkActualModels, classifyTriggerTool, isApiErrorText } from '../scripts/eval-trigger-utils.mjs';

test('trigger eval 把 provider 以普通文本返回的 API 错误识别为调用失败', () => {
  assert.equal(isApiErrorText(JSON.stringify({
    error: {
      code: 'InvalidEndpoint.ClosedEndpoint',
      message: 'temporarily unavailable',
    },
  })), true);
  assert.equal(isApiErrorText('{"error":"quota exceeded"}'), true);
  assert.equal(isApiErrorText('{"message":"ordinary answer"}'), false);
  assert.equal(isApiErrorText('ordinary answer'), false);
  assert.equal(isApiErrorText(''), false);
});

test('trigger eval 识别 Skill 调用、SKILL.md 读取和普通探索', () => {
  const skills = ['workflow', 'nacos-config'];
  assert.equal(classifyTriggerTool('Skill', '{"skill":"workflow"}', skills), 'workflow');
  assert.equal(classifyTriggerTool('Skill', '{"command":"/nacos-config order"}', skills), 'nacos-config');
  assert.equal(classifyTriggerTool('Read', '{"file_path":".claude/skills/workflow/SKILL.md"}', skills), 'workflow');
  assert.equal(classifyTriggerTool('Read', '{"file_path":"CLAUDE.md"}', skills), 'none');
  assert.equal(classifyTriggerTool('Glob', '{"pattern":"**/*.md"}', skills), 'none');
});

test('trigger eval 的模型要求必须覆盖每一个请求', () => {
  assert.deepEqual(checkActualModels(['anthropic-claude-sonnet-4'], ''), { ok: true, missing: 0, mismatched: [] });
  assert.deepEqual(checkActualModels(['anthropic-claude-sonnet-4'], 'anthropic-claude'), { ok: true, missing: 0, mismatched: [] });
  assert.deepEqual(checkActualModels(['anthropic-claude-sonnet-4', 'glm-5.2'], 'anthropic-claude'), {
    ok: false,
    missing: 0,
    mismatched: ['glm-5.2'],
  });
  assert.deepEqual(checkActualModels(['anthropic-claude-sonnet-4', null], 'anthropic-claude'), {
    ok: false,
    missing: 1,
    mismatched: [],
  });
  assert.deepEqual(checkActualModels([], 'anthropic-claude'), { ok: false, missing: 0, mismatched: [] });
});
