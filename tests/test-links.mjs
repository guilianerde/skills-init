// 软链接删除与探测：Windows 上指向目录的软链接被当成目录，fs.rmSync / unlink 删不掉（0.6.0 在开发者模式下安装时报 EISDIR）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { removeLink } from '../bin/lib/core.mjs';
import { symlinkSupported } from '../bin/lib/install.mjs';

test('removeLink：Windows 式的 EPERM / EISDIR 改用 rmdir；不存在时不报错；不碰链接目标', () => {
  const calls = [];
  const orig = { unlinkSync: fs.unlinkSync, rmdirSync: fs.rmdirSync };
  try {
    for (const code of ['EPERM', 'EISDIR']) {
      fs.unlinkSync = (p) => { calls.push(['unlink', p]); throw Object.assign(new Error(code), { code }); };
      fs.rmdirSync = (p) => { calls.push(['rmdir', p]); };
      removeLink('X');
    }
    fs.unlinkSync = () => { throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); };
    assert.throws(() => removeLink('X'), /EBUSY/);
  } finally { Object.assign(fs, orig); }
  assert.deepEqual(calls, [['unlink', 'X'], ['rmdir', 'X'], ['unlink', 'X'], ['rmdir', 'X']]);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'links-'));
  removeLink(path.join(dir, 'missing'));
  fs.mkdirSync(path.join(dir, 'target'));
  fs.writeFileSync(path.join(dir, 'target', 'keep.txt'), 'x');
  try { fs.symlinkSync('target', path.join(dir, 'link'), 'dir'); } catch { fs.rmSync(dir, { recursive: true, force: true }); return; } // 建不了链接的环境跳过真实部分
  removeLink(path.join(dir, 'link'));
  assert.equal(fs.existsSync(path.join(dir, 'link')), false);
  assert.equal(fs.readFileSync(path.join(dir, 'target', 'keep.txt'), 'utf8'), 'x');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('symlinkSupported：探测链接用完即删，并清掉之前异常退出留下的探测链接', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'));
  const stale = path.join(dir, '.workflow-run-probe-12345');
  let canLink = true;
  try { fs.symlinkSync('.', stale, 'dir'); } catch { canLink = false; }
  const prev = process.env.WORKFLOW_RUN_NO_SYMLINK; delete process.env.WORKFLOW_RUN_NO_SYMLINK;
  try {
    assert.equal(symlinkSupported(dir), canLink);
  } finally { if (prev !== undefined) process.env.WORKFLOW_RUN_NO_SYMLINK = prev; }
  assert.deepEqual(fs.readdirSync(dir), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('DocNexus CLI 位置：workflow-run/docnexus/node_modules/.bin；项目根的旧位置不再使用；安装器与 skill 脚本判断一致', async () => {
  const { docnexusBin, docnexusUpgradeCmd } = await import('../bin/lib/core.mjs');
  const { docnexusBin: skillBin, docnexusConnected } = await import('../workflow/scripts/resolve.mjs');
  const name = process.platform === 'win32' ? 'docnexus.cmd' : 'docnexus';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dnbin-'));
  const put = (...p) => { fs.mkdirSync(path.join(root, ...p.slice(0, -1)), { recursive: true }); fs.writeFileSync(path.join(root, ...p), ''); };
  assert.equal(docnexusBin(root), null);
  assert.equal(skillBin(root), null);
  put('docnexus', 'project.json');
  put('node_modules', '.bin', name);
  put('docnexus', 'node_modules', '.bin', name);
  assert.equal(docnexusBin(root), null, '项目根的 docnexus/ 是旧位置，升级时搬进 workflow-run/');
  assert.equal(docnexusConnected(root), false);
  put('workflow-run', 'docnexus', 'project.json');
  assert.equal(docnexusConnected(root), false, '只有工作区没有 CLI');
  put('workflow-run', 'docnexus', 'node_modules', '.bin', name);
  assert.equal(path.relative(root, docnexusBin(root)), path.join('workflow-run', 'docnexus', 'node_modules', '.bin', name));
  assert.equal(skillBin(root), path.join('workflow-run', 'docnexus', 'node_modules', '.bin', name));
  assert.equal(docnexusConnected(root), true);
  assert.match(docnexusUpgradeCmd(), /^npm install --prefix \.\/workflow-run\/docnexus --save-exact /);
  fs.rmSync(root, { recursive: true, force: true });
});
