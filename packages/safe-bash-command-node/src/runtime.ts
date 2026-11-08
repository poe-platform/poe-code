/** Executed only inside QuickJS. Host capabilities are serialized, never exposed as host objects. */
export const bootstrap = String.raw`
(() => {
const bridge = globalThis.__host;
delete globalThis.__host;
const call = (op, ...args) => {
  const result = JSON.parse(bridge(op, JSON.stringify(args)));
  if (result.error) throw Object.assign(new Error(result.error.message), {code: result.error.code});
  return result.value;
};
const encoding = value => {
  if (value !== undefined && value !== 'utf8' && value !== 'utf-8') throw new Error('Only UTF-8 encoding is supported');
  return value;
};
globalThis.Buffer = class Buffer extends Uint8Array {
  static from(value, enc) { encoding(enc); return new Buffer(typeof value === 'string' ? call('encode', value) : value); }
  static alloc(size) { return new Buffer(size); }
  static isBuffer(value) { return value instanceof Buffer; }
  toString(enc = 'utf8') { encoding(enc); return call('decode', Array.from(this)); }
};
const fileEncoding = options => {
  if (options !== null && typeof options === 'object') {
    for (const key of Object.keys(options)) if (key !== 'encoding') throw new Error('Unsupported fs option: ' + key);
    options = options.encoding;
  }
  return encoding(options);
};
const fs = {
  readFileSync(path, enc) { enc = fileEncoding(enc); const bytes = Buffer.from(call('read', path)); return enc ? bytes.toString(enc) : bytes; },
  writeFileSync(path, data, enc) { fileEncoding(enc); call('write', path, Array.from(Buffer.from(data))); },
  existsSync(path) { try { call('stat', path); return true; } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return false; throw e; } },
  statSync(path) { const stat = call('stat', path); return {...stat, isFile: () => stat.type === 'file', isDirectory: () => stat.type === 'directory', isSymbolicLink: () => stat.type === 'symlink'}; },
  mkdirSync(path, options = {}) { call('mkdir', path, options.recursive === true); },
};
const childResult = (command, args, options = {}) => {
  for (const key of Object.keys(options)) if (key !== 'encoding') throw new Error('Unsupported child_process option: ' + key);
  encoding(options.encoding);
  const result = call('exec', command, args);
  const stdout = Buffer.from(result.bytes);
  if (result.status !== 0) throw Object.assign(new Error('Command failed: ' + command), {status: result.status, stdout});
  return options.encoding ? stdout.toString(options.encoding) : stdout;
};
const child = {
  execSync(command, options) { return childResult('sh', ['-c', command], options); },
  execFileSync(command, args = [], options) { return childResult(command, args, options); },
};
function __setup(config) {
  globalThis.process = {argv: config.argv, argv0: 'node', execPath: '/virtual/bin/node', execArgv: [], version: 'v22.0.0', versions: {node: '22.0.0'}, platform: 'linux', arch: 'x64', pid: 1, ppid: 0, env: config.env, cwd: () => config.cwd, exitCode: 0,
    stdout: {write: value => {call('output', String(value), false); return true;}},
    stderr: {write: value => {call('output', String(value), true); return true;}},
  };
  globalThis.console = {
    log: (...values) => call('output', values.map(String).join(' ') + '\n', false),
    error: (...values) => call('output', values.map(String).join(' ') + '\n', true),
  };
  const path = {sep:'/', delimiter:':',
    resolve: (...parts) => parts.reduce((base, part) => call('resolve', base, part), config.cwd),
    dirname: value => call('dirname', value),
    join: (...parts) => call('path', 'join', ...parts),
    basename: value => call('path', 'basename', value),
    extname: value => call('path', 'extname', value),
  };
  path.posix = path;
  const cache = new Map();
  const load = base => name => {
    if (typeof name !== 'string') throw new TypeError('Module name must be a string');
    const builtin = name.startsWith('node:') ? name.slice(5) : name;
    if (builtin === 'fs') return fs;
    if (builtin === 'child_process') return child;
    if (builtin === 'path') return path;
    if (builtin === 'process') return globalThis.process;
    if (!(name.startsWith('./') || name.startsWith('../') || name.startsWith('/'))) throw new Error('Unsupported module: ' + name);
    const filename = call('resolve', base, name);
    if (cache.has(filename)) return cache.get(filename).exports;
    const source = call('source', filename);
    const module = {exports:{}};
    cache.set(filename, module);
    try {
      if (filename.endsWith('.json')) module.exports = JSON.parse(source);
      else new Function('exports', 'require', 'module', '__filename', '__dirname', source)(module.exports, load(path.dirname(filename)), module, filename, path.dirname(filename));
      return module.exports;
    } catch (e) { cache.delete(filename); throw e; }
  };
  globalThis.__filename = config.filename;
  globalThis.__dirname = config.filename.startsWith('/') ? path.dirname(config.filename) : config.cwd;
  globalThis.require = load(__dirname);
  globalThis.module = {exports:{}};
  globalThis.exports = module.exports;
}
return __setup;
})()
`;
