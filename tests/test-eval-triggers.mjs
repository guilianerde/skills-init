import test from 'node:test';
import assert from 'node:assert/strict';

import { isApiErrorText } from '../scripts/eval-trigger-utils.mjs';

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
