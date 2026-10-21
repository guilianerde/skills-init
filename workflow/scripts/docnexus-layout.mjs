// DocNexus format 7：项目根运行，内部状态在 .docnexus/，知识输出固定到 workflow-run/docnexus/。
import fs from 'node:fs';
import path from 'node:path';

export const DOCNEXUS_INTERNAL = '.docnexus';
export const DOCNEXUS_OUTPUT = 'workflow-run';
export const docnexusRoot = (root) => path.resolve(root);
export const docnexusWorkspace = (root) => path.resolve(root, DOCNEXUS_OUTPUT, 'docnexus');
export const docnexusInternal = (root) => path.resolve(root, DOCNEXUS_INTERNAL);

export function docnexusConfigured(root) {
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(docnexusInternal(root), 'project.json'), 'utf8'));
    return marker.format_version === 7 && marker.output_dir === DOCNEXUS_OUTPUT;
  } catch { return false; }
}

export function docnexusBinPath(root) {
  const name = process.platform === 'win32' ? 'docnexus.cmd' : 'docnexus';
  const bin = path.join(docnexusInternal(root), 'node_modules', '.bin', name);
  return fs.existsSync(bin) ? bin : null;
}

export const docnexusConnected = (root) => docnexusConfigured(root) && docnexusBinPath(root) !== null;
