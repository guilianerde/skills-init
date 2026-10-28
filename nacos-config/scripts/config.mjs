// 只读 Nacos：本地配置定位、单配置获取、结构化脱敏。除登录外不发送 POST。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = fileURLToPath(new URL('..', import.meta.url));
const MAX_BYTES = 2 * 1024 * 1024;
export class UsageError extends Error {}
const fail = (s) => { throw new UsageError(s); };
const own = (o, k) => Object.hasOwn(o, k);

export function flatten(value, prefix = '', out = Object.create(null), seen = new Set()) {
  if (value && typeof value === 'object' && Object.keys(value).length) {
    if (seen.has(value)) throw new Error('不支持循环配置引用');
    seen.add(value);
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out, seen);
    seen.delete(value);
  } else if (prefix) out[prefix] = value;
  return out;
}

export function properties(text) {
  const out = Object.create(null);
  const unescape = (s) => s.replace(/\\u([\da-fA-F]{4})|\\(.)/g, (_, hex, c) => hex ? String.fromCharCode(parseInt(hex, 16)) : ({ t: '\t', n: '\n', r: '\r', f: '\f' }[c] ?? c));
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    let s = lines[i].trimStart();
    if (!s || /^[#!]/.test(s)) continue;
    while ((s.match(/\\+$/)?.[0].length ?? 0) % 2 === 1 && i + 1 < lines.length) s = s.slice(0, -1) + lines[++i].trimStart();
    const m = /^((?:\\.|[^\s:=\\])*)(?:\s*[=:]\s*|\s+)?(.*)$/.exec(s);
    if (!m) throw new Error('properties 解析失败');
    out[unescape(m[1])] = unescape(m[2]);
  }
  return out;
}

export async function documents(text, format) {
  try {
    if (format === 'properties') return [properties(text)];
    const structured = (v) => {
      if (v !== null && typeof v !== 'object') throw new Error();
      return flatten(v);
    };
    if (format === 'json') return [structured(JSON.parse(text))];
    if (format !== 'yaml') fail('格式须为 json、yaml 或 properties');
    let yaml;
    try { yaml = await import('yaml'); } catch { fail('缺少 yaml 依赖：运行 npm install --prefix <skills>/nacos-config --ignore-scripts --no-package-lock'); }
    return yaml.parseAllDocuments(text, { prettyErrors: false, logLevel: 'silent' }).map((d) => {
      if (d.errors.length || d.warnings.length) throw new Error();
      return structured(d.toJS({ maxAliasCount: 50 }));
    });
  } catch (e) {
    if (e instanceof UsageError) throw e;
    throw new Error(`配置 ${format} 解析失败（未输出原文）`);
  }
}

export function resolveValue(value, props, env = process.env, stack = []) {
  if (typeof value !== 'string') return value;
  if (stack.length > 30) fail('连接参数占位符嵌套超过 30 层');
  let s = ''; let offset = 0;
  for (let start; (start = value.indexOf('${', offset)) >= 0;) {
    s += value.slice(offset, start);
    let end = start + 2; let depth = 1;
    for (; end < value.length && depth; end++) {
      if (value.startsWith('${', end)) { depth++; end++; }
      else if (value[end] === '}') depth--;
    }
    if (depth) fail('连接参数含未闭合的占位符');
    const expr = value.slice(start + 2, end - 1);
    const colon = expr.indexOf(':');
    const key = colon < 0 ? expr : expr.slice(0, colon);
    if (key.includes('${')) fail('不支持动态占位符名称');
    if (stack.includes(key)) fail('连接参数的占位符存在循环引用');
    const v = own(env, key) ? env[key] : own(props, key) ? props[key] : colon >= 0 ? expr.slice(colon + 1) : undefined;
    if (v === undefined) fail(`连接参数缺少变量：${key}`);
    s += String(resolveValue(v, props, env, [...stack, key]));
    offset = end;
  }
  s += value.slice(offset);
  if (/\$\{|@[^@\s]+@/.test(s)) fail('连接参数含未解析的占位符或构建过滤变量');
  return s;
}

function formatOf(file, explicit) {
  const ext = (explicit ?? path.extname(file).slice(1)).toLowerCase();
  const format = ext === 'yml' ? 'yaml' : ext;
  if (!['json', 'yaml', 'properties'].includes(format)) fail('无法判断配置格式，请传 --format json|yaml|properties');
  return format;
}

function read(file) {
  if (!fs.existsSync(file)) fail('配置文件不存在');
  if (fs.statSync(file).size > MAX_BYTES) fail('配置文件超过 2 MiB');
  return fs.readFileSync(file, 'utf8');
}

function profileOf(doc) {
  return doc['spring.config.activate.on-profile'] ?? doc['spring.profiles'];
}

export function mergeDocuments(docs, profile) {
  const out = Object.create(null);
  for (const doc of docs) {
    const active = profileOf(doc);
    if (active !== undefined) {
      if (!profile) fail('存在 profile 条件文档，请传 --profile 明确选择');
      const names = String(active).split(',').map((s) => s.trim());
      if (names.some((s) => !/^[\w.-]+$/.test(s))) fail('不支持复杂 profile 表达式，请明确提供本次环境配置');
      if (!names.includes(profile)) continue;
    }
    Object.assign(out, doc);
  }
  return out;
}

export function localConnection(props, env = process.env) {
  const p = 'spring.cloud.nacos.';
  const get = (k) => resolveValue(props[`${p}config.${k}`] ?? props[`${p}${k}`], props, env);
  return { server_addr: get('server-addr'), namespace: get('namespace'), group: get('group'), username: get('username'), password: get('password') };
}

export function serverURL(address) {
  if (!address || typeof address !== 'string' || address.includes(',')) fail('请配置单个 Nacos server_addr 入口');
  let u;
  try { u = new URL(address.includes('://') ? address : `http://${address}`); } catch { fail('Nacos 地址无效'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) fail('Nacos 地址只支持无凭据、查询参数和片段的 HTTP(S) URL');
  if (u.pathname === '/') u.pathname = '/nacos';
  u.pathname = u.pathname.replace(/\/+$/, '');
  return u;
}

const SECRET = /password|passwd|pwd|secret|token|credential|private[_.-]?key|access[_.-]?key|api[_.-]?key|authorization|cookie/i;
export function maskValue(key, value) {
  if (SECRET.test(key)) return '******';
  if (typeof value !== 'string') return value;
  if (/-----BEGIN [^-]*PRIVATE KEY-----/.test(value)) return '******';
  return value.replace(/(\b[a-z][\w+.-]*:\/\/)[^\s/@]+@/gi, '$1******@')
    .replace(/([?;&](?:password|passwd|pwd|token|access[_-]?token|secret|access[_-]?key|api[_-]?key|authorization)=)[^\s&#;]*/gi, '$1******');
}

export async function retrieve(conn, { dataId, group, namespace, apiVersion, timeout = 15 } = {}, env = process.env) {
  const version = String(apiVersion ?? conn.api_version ?? '1');
  if (!['1', '2', '3'].includes(version)) fail('api_version 须为 1、2 或 3');
  if (!dataId) fail('请明确传 --data-id');
  if (!Number.isFinite(Number(timeout)) || Number(timeout) <= 0 || Number(timeout) > 300) fail('timeout 须为 0～300 秒之间');
  const base = serverURL(conn.server_addr);
  const credential = (name) => {
    const variable = conn[`${name}_env`];
    if (variable) {
      if (!env[variable]) fail(`缺少凭据环境变量：${variable}`);
      return env[variable];
    }
    return conn[name];
  };
  let token = credential('token');
  const username = token ? undefined : credential('username');
  const password = token ? undefined : credential('password');
  if (!token && (username || password) && !(username && password)) fail('Nacos 登录需要同时提供用户名和密码');
  const request = async (route, params, login = false) => {
    const url = new URL(base);
    url.pathname += route;
    const headers = {};
    if (!login && token) {
      if (version === '3') headers.accessToken = token;
      else params.accessToken = token;
    }
    const body = new URLSearchParams(params);
    if (login) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    else url.search = body.toString();
    let res;
    try {
      res = await fetch(url, { method: login ? 'POST' : 'GET', headers, body: login ? body : undefined, redirect: 'error', signal: AbortSignal.timeout(Number(timeout) * 1000) });
    } catch { throw new Error('Nacos 请求失败：网络、超时、TLS 或重定向错误（未输出凭据）'); }
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`Nacos ${login ? '登录' : '配置读取'}失败：HTTP ${res.status}（未输出错误体）`);
    }
    const reader = res.body.getReader();
    const chunks = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES) { await reader.cancel(); throw new Error(); }
        chunks.push(value);
      }
    } catch { throw new Error('Nacos 响应读取失败、超时或超过 2 MiB'); }
    const text = Buffer.concat(chunks).toString('utf8');
    if (!login && version === '1') return text;
    let result;
    try { result = JSON.parse(text); } catch { throw new Error('Nacos 响应不是预期 JSON（未输出原文）'); }
    if (login) {
      if (typeof result.accessToken !== 'string' || !result.accessToken) throw new Error('Nacos 登录响应缺少 accessToken');
      return result.accessToken;
    }
    if (result.code !== 0) throw new Error('Nacos 返回业务错误（未输出错误体）');
    if (version === '3' && (result.data?.encryptedDataKey || result.data?.success === false || (result.data?.errorCode ?? 0) !== 0)) throw new Error('Nacos 返回加密配置或客户端读取错误，无法作为明文配置使用');
    const content = version === '3' ? result.data?.content : result.data;
    if (typeof content !== 'string') throw new Error('Nacos 响应缺少配置内容');
    return content;
  };
  if (!token && username) token = await request(version === '3' ? '/v3/auth/user/login' : '/v1/auth/login', { username, password }, true);
  const ns = namespace ?? conn.namespace ?? '';
  const g = group ?? conn.group ?? 'DEFAULT_GROUP';
  const params = { dataId, [version === '3' ? 'groupName' : 'group']: g };
  params[version === '1' ? 'tenant' : 'namespaceId'] = version === '1' && ns === 'public' ? '' : ns || (version === '1' ? '' : 'public');
  const content = await request(version === '1' ? '/v1/cs/configs' : version === '2' ? '/v2/cs/config' : '/v3/client/cs/config', params);
  return { source: { server: base.toString(), api_version: version, namespace: ns || 'public', group: g, data_id: dataId, read_at: new Date().toISOString(), sha256: crypto.createHash('sha256').update(content).digest('hex') }, content };
}

function args(argv) {
  const o = { command: argv[0], files: [] };
  const names = { '--conn': 'conn', '--data-id': 'dataId', '--group': 'group', '--namespace': 'namespace', '--api-version': 'apiVersion', '--timeout': 'timeout', '--key': 'key', '--format': 'format', '--profile': 'profile' };
  if (!['inspect', 'get'].includes(o.command)) fail('用法：config.mjs inspect|get [--file 路径] [--conn 名称] [--data-id ID] [--key 属性]');
  for (let i = 1; i < argv.length; i++) {
    const k = argv[i];
    if (k !== '--file' && !names[k]) fail('未知参数（不接受命令行凭据）');
    const v = argv[++i];
    if (v === undefined || v.startsWith('--')) fail(`参数 ${k} 缺少值`);
    if (k === '--file') o.files.push(v); else o[names[k]] = v;
  }
  if (o.files.length && o.conn) fail('--file 与 --conn 不能同时使用');
  return o;
}

export async function main(argv, { cwd = process.cwd(), skillDir = SKILL_DIR, env = process.env } = {}) {
  const o = args(argv);
  const configPath = path.join(skillDir, 'config.json');
  let config = {};
  if (!o.files.length && fs.existsSync(configPath)) {
    try { config = JSON.parse(read(configPath)); } catch { fail('本机 config.json 无法解析'); }
  }
  if (o.command === 'inspect') {
    const files = o.files.length ? o.files : ['', 'config', 'src/main/resources'].flatMap((dir) => {
      const p = path.join(cwd, dir);
      return fs.existsSync(p) ? fs.readdirSync(p).sort().filter((n) => /^(application|bootstrap)(?:-[\w.-]+)?\.(ya?ml|properties)$/.test(n)).map((n) => path.join(dir, n)) : [];
    });
    const candidates = [];
    for (const file of files) {
      const docs = await documents(read(path.resolve(cwd, file)), formatOf(file));
      docs.forEach((d, i) => candidates.push({ file, document: i + 1, profile: profileOf(d) ?? null, nacos_keys: Object.keys(d).filter((k) => k.startsWith('spring.cloud.nacos.')), config_imports: Object.entries(d).filter(([k]) => k === 'spring.config.import' || k.startsWith('spring.config.import.')).map(([, v]) => maskValue('import', String(v).split('?')[0])) }));
    }
    return { connections: Object.keys(config.connections ?? {}), default_connection: config.default_connection ?? null, candidates };
  }
  let conn; let selected;
  if (o.files.length) {
    const docs = [];
    for (const file of o.files) docs.push(...await documents(read(path.resolve(cwd, file)), formatOf(file)));
    conn = localConnection(mergeDocuments(docs, o.profile), env);
    selected = { files: o.files, profile: o.profile ?? null };
  } else {
    const name = o.conn ?? config.default_connection;
    if (!name || !own(config.connections ?? {}, name)) fail('请选择已有 --conn，或通过 --file 指定 application / bootstrap 配置');
    conn = config.connections[name];
    if (own(conn, 'password') || own(conn, 'token')) fail('本机连接请使用 password_env / token_env，不保存明文凭据');
    selected = { connection: name };
  }
  if (!o.dataId) fail('请明确传 --data-id');
  const format = formatOf(o.dataId, o.format);
  const result = await retrieve(conn, o, env);
  const docs = await documents(result.content, format);
  if (docs.length !== 1) fail('远程多文档配置无法确定最终属性，请明确拆分或核对各文档');
  const values = Object.create(null);
  for (const [k, v] of Object.entries(docs[0])) if (!o.key || k === o.key || k.startsWith(`${o.key}.`)) values[k] = maskValue(k, v);
  if (o.key && !Object.keys(values).length) fail('所选配置中未找到指定 key');
  return { source: { ...result.source, ...selected }, values, notice: '单个远程配置快照；未计算 Spring 运行时覆盖、灰度和动态刷新。敏感字段已按名称脱敏。' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => {
    // JSON / YAML / fetch 原始错误可能带原文或请求 URL，只输出本脚本产生的消息。
    console.error(e instanceof UsageError || e.constructor === Error ? e.message : '配置处理失败（未输出原文）');
    process.exitCode = e instanceof UsageError ? 2 : 1;
  });
}
