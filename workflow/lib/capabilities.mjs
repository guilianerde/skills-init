// DocNexus format 7：项目根运行，内部状态在 .docnexus/，知识输出固定到 workflow-run/docnexus/。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

// 集中探测接入状态；不连接远端服务、不创建索引、不输出凭据。

const SKILLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
export const DOCNEXUS_HINT = 'DocNexus 是必装组件，运行 npx @rowansenne/workflow-run 修复接入后继续；不使用默认模板或跳过知识库。';
export const docnexusBin = (root) => { const bin = docnexusBinPath(root); return bin ? path.relative(path.resolve(root), bin) : null; };

export function codegraphStatus(root) {
  const indexed = fs.existsSync(path.join(root, '.codegraph'));
  const cli = spawnSync('codegraph', ['--version'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32', env: { ...process.env, DO_NOT_TRACK: '1' }, timeout: 30000 }).status === 0;
  const script = path.join(SKILLS_DIR, 'code-graph', 'scripts', 'cg.mjs');
  const scan = fs.existsSync(script);
  let library = { ok: false, error: indexed ? 'skill_missing' : 'no_index' };
  if (indexed && scan) {
    const r = spawnSync(process.execPath, [script, 'status', '--root', root], { cwd: root, encoding: 'utf8', timeout: 30000 });
    try {
      const result = JSON.parse(r.stdout);
      if (r.status === 0 && result.library) library = { ...result.library, ok: !result.library.error };
      else library = { ok: false, error: 'probe_failed' };
    } catch { library = { ok: false, error: 'probe_failed' }; }
  }
  const mode = indexed && library.ok ? 'script' : indexed && cli ? 'cli' : 'source';
  return {
    ok: mode !== 'source', cli, indexed, library, scan, mode,
    how: mode !== 'source' ? null : !indexed ? '是否运行 codegraph init 建索引由用户决定；本次直接读源码' : library.hint ?? '重跑 npx @rowansenne/workflow-run --with-codegraph 修复接入',
  };
}

export function capabilities(root) {
  const wiki = readJson(path.join(SKILLS_DIR, 'md-to-wiki', 'wiki-config.json'));
  const db = readJson(path.join(SKILLS_DIR, 'database-query', 'config.json'));
  const dn = docnexusConnected(root);
  const rest = wiki?.enabled === true && !!wiki?.wiki?.base_url;
  return {
    ready: dn,
    blockers: dn ? [] : [{ capability: 'docnexus', hint: DOCNEXUS_HINT }],
    docnexus: {
      ok: dn, required: true,
      bin: dn ? `./${docnexusBin(root).split(path.sep).join('/')}` : null,
      root: '.', internal: DOCNEXUS_INTERNAL, workspace: `${DOCNEXUS_OUTPUT}/docnexus`, output_dir: DOCNEXUS_OUTPUT,
      run: `node ${path.relative(root, path.join(SKILLS_DIR, 'workflow', 'scripts', 'docnexus.mjs')).split(path.sep).join('/')}`,
      how: dn ? null : DOCNEXUS_HINT,
    },
    wiki: { ok: rest, channel: rest ? 'rest' : null, mcp: 'unknown', how: '配置 md-to-wiki/wiki-config.json，或由 agent 在开工时补充当前会话的 wiki MCP 通道；配置存在不代表鉴权和网络已验证' },
    codegraph: codegraphStatus(root),
    database: {
      ok: !!db?.connections && Object.keys(db.connections).length > 0,
      default: db?.default_connection ?? (db?.connections?.default ? 'default' : null),
      connections: Object.fromEntries(Object.entries(db?.connections ?? {}).map(([k, c]) => [k, { driver: c.driver ?? 'mysql', readonly: c.readonly !== false }])),
      how: '重跑 npx @rowansenne/workflow-run 补配数据库',
    },
  };
}
