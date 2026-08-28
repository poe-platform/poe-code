const assert = require('node:assert/strict');
const fs = require('node:fs');
const promises = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const childProcess = require('node:child_process');
const originalRead = fs.readFileSync;
const originalAppend = fs.appendFileSync;
const work = process.env.DU_ADMISSION_WORK;
const output = process.env.DU_ADMISSION_LOG;
const root = process.env.DU_ADMISSION_RUN;
const expectedTools = JSON.parse(originalRead(process.env.DU_TOOL_MAP));
assert.ok(work && output && root && work.startsWith(`${root}/node_modules/`));
let observationBytes = 0;
const observed = new Set();
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function emit(event) {
  const line = `${JSON.stringify(event)}\n`;
  observationBytes += Buffer.byteLength(line);
  assert.ok(observationBytes <= 33554432, 'observation byte bound');
  originalAppend(output, line);
}
function filename(value) {
  if (value instanceof URL) return require('node:url').fileURLToPath(value);
  return typeof value === 'string' || Buffer.isBuffer(value) ? path.resolve(value.toString()) : null;
}
function writable(value) {
  const target = filename(value);
  if (target !== null) assert.ok(target.startsWith(`${root}/`), `write outside owned run: ${target}`);
}
function readReceipt(value, bytes) {
  const target = filename(value);
  if (target === null || !(typeof bytes === 'string' || Buffer.isBuffer(bytes))) return;
  const digest = hash(bytes);
  if (Object.hasOwn(expectedTools, target)) assert.equal(digest, expectedTools[target], `actual tool read changed: ${target}`);
  const key = `${target}:${digest}`;
  if (observed.has(key)) return;
  observed.add(key);
  emit({ kind: 'actual-file-read', path: target, bytes: Buffer.byteLength(bytes), sha256: digest });
}
fs.readFileSync = function(value, ...args) {
  const bytes = originalRead.call(this, value, ...args);
  readReceipt(value, bytes);
  return bytes;
};
const promiseRead = promises.readFile;
promises.readFile = async function(value, ...args) {
  const bytes = await promiseRead.call(this, value, ...args);
  readReceipt(value, bytes);
  return bytes;
};
const originalCompile = Module.prototype._compile;
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, ...args) {
  const resolved = originalResolve.call(this, request, ...args);
  if (!Module.isBuiltin(resolved)) assert.ok(resolved.startsWith(`${work}/tools/npm/`) || resolved.startsWith(`${work}/tools/typescript/`), `ambient module resolution forbidden: ${resolved}`);
  return resolved;
};
Module.prototype._compile = function(content, value, ...args) {
  const target = path.resolve(value);
  assert.ok(target.startsWith(`${work}/tools/npm/`) || target.startsWith(`${work}/tools/typescript/`), `unbound or product module compile: ${target}`);
  const bytes = originalRead(target);
  emit({ kind: 'actual-commonjs-compile', path: target, diskBytes: bytes.length, diskSha256: hash(bytes), compileBytes: Buffer.byteLength(content), compileSha256: hash(content) });
  assert.equal(hash(content), hash(bytes), 'compile input differs from authenticated regular file');
  assert.equal(hash(content), expectedTools[target], 'actual tool compile differs from frozen dependency');
  return originalCompile.call(this, content, value, ...args);
};
for (const name of ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'mkdir', 'mkdirSync', 'rm', 'rmSync', 'rmdir', 'rmdirSync', 'unlink', 'unlinkSync', 'chmod', 'chmodSync', 'chown', 'chownSync', 'utimes', 'utimesSync', 'createWriteStream', 'truncate', 'truncateSync', 'mkdtemp', 'mkdtempSync']) {
  const original = fs[name];
  if (original) fs[name] = function(value, ...args) { writable(value); return original.call(this, value, ...args); };
  const promised = promises[name];
  if (promised) promises[name] = function(value, ...args) { writable(value); return promised.call(this, value, ...args); };
}
for (const name of ['rename', 'renameSync', 'link', 'linkSync', 'symlink', 'symlinkSync', 'copyFile', 'copyFileSync', 'cp', 'cpSync']) {
  const original = fs[name];
  if (original) fs[name] = function(source, destination, ...args) { if (!name.startsWith('copy') && !name.startsWith('cp')) writable(source); writable(destination); return original.call(this, source, destination, ...args); };
  const promised = promises[name];
  if (promised) promises[name] = function(source, destination, ...args) { if (!name.startsWith('copy') && !name.startsWith('cp')) writable(source); writable(destination); return promised.call(this, source, destination, ...args); };
}
for (const target of [fs, promises]) {
  for (const name of ['open', 'openSync']) {
    const original = target[name];
    if (original) target[name] = function(value, flags, ...args) { if (flags !== 'r' && flags !== 0) writable(value); return original.call(this, value, flags, ...args); };
  }
}
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[name] = () => { throw new Error(`unapproved tool subprocess: ${name}`); };
for (const [moduleName, names] of [['node:net', ['connect', 'createConnection']], ['node:tls', ['connect']], ['node:http', ['request', 'get']], ['node:https', ['request', 'get']], ['node:dgram', ['createSocket']]]) {
  const target = require(moduleName);
  for (const name of names) target[name] = () => { throw new Error(`network disabled: ${moduleName}.${name}`); };
}
globalThis.fetch = () => { throw new Error('network disabled: fetch'); };
Module.syncBuiltinESMExports();
emit({ kind: 'tool-observer-start', pid: process.pid, executable: process.execPath, argv: process.argv, productImportsAuthorized: false });
process.on('exit', code => emit({ kind: 'tool-observer-exit', pid: process.pid, code, observationBytes }));
