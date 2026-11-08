const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const childProcess = require('node:child_process');
const { fileURLToPath } = require('node:url');
const directory = process.env.HTML_PARTIAL_TRACE;
assert.equal(directory, path.join(__dirname, 'execution', 'trace'));
const filename = path.join(directory, `${process.env.HTML_PARTIAL_COMMAND}-${process.pid}.data`);
const descriptor = fs.openSync(filename, 'wx');
const originalRead = fs.readFileSync;
const originalCompile = Module.prototype._compile;
const auth = JSON.parse(originalRead(path.join(__dirname, 'PREPARE-AUTH.json')));
const mapping = JSON.parse(originalRead(path.join(__dirname, 'ADAPTERS.json')));
let bytesWritten = 0;
let records = 0;
function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function record(value) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  bytesWritten += bytes.length;
  records++;
  assert.ok(bytesWritten <= 16 * 1024 ** 2 && records <= 50000, 'bounded tool trace');
  let offset = 0;
  while (offset < bytes.length) offset += fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
}
record({ kind: 'start', pid: process.pid, command: process.env.HTML_PARTIAL_COMMAND, argv: process.argv, node: process.execPath, version: process.version, preloadSha256: digest(originalRead(__filename)) });
function expectedCode(filename) {
  const base = path.resolve(__dirname, '../html-public-independent-20260827/admission-v2');
  if (filename.startsWith(`${base}/`)) return auth.sealed[filename.slice(base.length + 1)]?.sha256;
  const stage = path.join(__dirname, 'node_modules', 'partial-work', 'drivers');
  if (filename.startsWith(`${stage}/`)) return mapping.find(entry => entry.name === filename.slice(stage.length + 1))?.newSha256;
  for (const [name, entry] of Object.entries(auth.tools)) {
    if (!entry.inventory) continue;
    if (filename.startsWith(`${entry.path}/`)) return entry.inventory[filename.slice(entry.path.length + 1)];
    const suffix = { typescript: '/node_modules/typescript/', nodeTypes: '/node_modules/@types/node/', undiciTypes: '/node_modules/undici-types/' }[name];
    if (suffix && filename.startsWith(`${__dirname}/node_modules/`) && filename.includes(suffix)) return entry.inventory[filename.slice(filename.lastIndexOf(suffix) + suffix.length)];
  }
}
Module.registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url.startsWith('file:')) {
    const filename = fileURLToPath(url);
    const sourceHash = result.source == null ? null : digest(result.source);
    record({ kind: 'load', path: filename, format: result.format, sha256: sourceHash });
    const expected = expectedCode(filename);
    assert.ok(expected, `undeclared executable module: ${filename}`);
    if (sourceHash !== null) assert.equal(sourceHash, expected, filename);
  }
  return result;
} });
fs.readFileSync = function(filename, ...args) {
  const bytes = Reflect.apply(originalRead, this, [filename, ...args]);
  if (typeof filename === 'string' && (typeof bytes === 'string' || Buffer.isBuffer(bytes))) record({ kind: 'read', path: path.resolve(filename), sha256: digest(bytes), bytes: Buffer.byteLength(bytes) });
  return bytes;
};
Module.prototype._compile = function(content, filename, ...args) {
  record({ kind: 'compile', path: path.resolve(filename), sha256: digest(content), bytes: Buffer.byteLength(content) });
  assert.equal(digest(content), expectedCode(path.resolve(filename)), `undeclared or changed compiled module: ${filename}`);
  return Reflect.apply(originalCompile, this, [content, filename, ...args]);
};
const originalSpawn = childProcess.spawn;
childProcess.spawn = function(executable, args, options) {
  const child = Reflect.apply(originalSpawn, this, [executable, args, options]);
  record({ kind: 'spawn', executable, args, pid: child.pid });
  const digestState = crypto.createHash('sha256');
  let streamedBytes = 0, chunks = 0, maxChunkBytes = 0;
  if (child.stdout) {
    const originalStreamRead = child.stdout.read;
    child.stdout.read = function(...readArgs) {
      const bytes = Reflect.apply(originalStreamRead, this, readArgs);
      if (bytes != null) { digestState.update(bytes); streamedBytes += Buffer.byteLength(bytes); chunks++; maxChunkBytes = Math.max(maxChunkBytes, Buffer.byteLength(bytes)); }
      return bytes;
    };
    child.stdout.once('end', () => record({ kind: 'stream-end', pid: child.pid, bytes: streamedBytes, chunks, maxChunkBytes, sha256: digestState.copy().digest('hex'), consumerRssBytes: process.memoryUsage().rss }));
  }
  child.once('close', (status, signal) => record({ kind: 'child-close', pid: child.pid, status, signal, bytes: streamedBytes, chunks, maxChunkBytes, sha256: digestState.digest('hex'), consumerRssBytes: process.memoryUsage().rss }));
  return child;
};
const originalSpawnSync = childProcess.spawnSync;
childProcess.spawnSync = function(executable, args, options) {
  const result = Reflect.apply(originalSpawnSync, this, [executable, args, options]);
  record({ kind: 'spawn-sync-return', executable, args, cwd: options?.cwd, status: result.status, signal: result.signal, error: result.error?.message, stdoutBytes: result.stdout == null ? null : Buffer.byteLength(result.stdout), stdoutSha256: result.stdout == null ? null : digest(result.stdout), stderr: result.stderr?.toString().slice(0, 65536) });
  return result;
};
Module.syncBuiltinESMExports();
process.on('exit', code => { record({ kind: 'exit', code, records, bytesWritten }); fs.closeSync(descriptor); });
