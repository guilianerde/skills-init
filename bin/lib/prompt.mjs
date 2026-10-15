// 交互输入（TTY 与管道输入都支持）

import readline from 'node:readline';

export let rl, lines;
export function input() {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
    lines = rl[Symbol.asyncIterator]();
  }
  return rl;
}
export async function ask(prompt, { hidden = false } = {}) {
  const r = input();
  process.stdout.write(prompt);
  let muted = false;
  if (hidden && process.stdin.isTTY) {
    const orig = r._writeToOutput;
    r._writeToOutput = (s) => { if (!muted) orig.call(r, s); };
    muted = true;
    const res = await lines.next();
    muted = false;
    r._writeToOutput = orig;
    process.stdout.write('\n');
    return res.done ? '' : res.value.trim();
  }
  const res = await lines.next();
  if (hidden) process.stdout.write('\n');
  return res.done ? '' : res.value.trim();
}

export function closePrompt() { rl?.close(); }
