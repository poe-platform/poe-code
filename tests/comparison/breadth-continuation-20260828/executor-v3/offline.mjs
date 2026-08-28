import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import dgram from 'node:dgram';
import childProcess from 'node:child_process';
import workers from 'node:worker_threads';
import timers from 'node:timers';
import timerPromises from 'node:timers/promises';
import moduleAPI, { syncBuiltinESMExports, isBuiltin } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { hash, requireThat } from './safety.mjs';
import { readRegular } from './regular-read.mjs';

const stat = fs.lstatSync.bind(fs);
export function installOffline(view, emit) {
  const files = new Map(view.files.map(file => [path.join(view.root, file.path), file]));
  const violations = [];
  const pending = new Set();
  const restores = [];
  const assets = [];
  const descriptors = new Set();
  const openDescriptor = fs.openSync.bind(fs), closeDescriptor = fs.closeSync.bind(fs), readDescriptor = fs.readSync.bind(fs), statDescriptor = fs.fstatSync.bind(fs);
  const realpath = fs.realpathSync.native.bind(fs.realpathSync);
  const createRequire = moduleAPI.createRequire;
  function replace(object, name, value) {
    const previous = object[name];
    if (typeof previous === 'function') { object[name] = value; restores.push(() => { object[name] = previous; }); }
  }
  const deny = operation => function (...args) {
    const value = { operation, argument: typeof args[0] === 'string' ? args[0].slice(0, 512) : typeof args[0] };
    violations.push(value); emit({ kind: 'offline-denied', ...value });
    throw Object.assign(new Error(`OFFLINE_DENIED:${operation}`), { code: 'OFFLINE_DENIED' });
  };
  function asset(filename) {
    try {
    const absolute = filename instanceof URL ? fileURLToPath(filename) : typeof filename === 'string' ? path.resolve(filename) : '';
    const entry = files.get(absolute);
    requireThat(entry && !entry.path.split('/').some(name => name.toUpperCase() === 'AGENTS.MD'), 'UNBOUND_ASSET', absolute);
    const info = stat(absolute);
    requireThat(info.isFile() && !info.isSymbolicLink() && info.size === entry.bytes && (info.mode & 0o7777) === entry.mode, 'ASSET_METADATA', absolute);
    const bytes = readRegular(absolute, entry.bytes);
    requireThat(hash(bytes) === entry.sha256, 'ASSET_HASH', absolute);
    const witness = { path: entry.path, bytes: bytes.length, sha256: entry.sha256 };
    assets.push(witness); emit({ kind: 'asset-read', ...witness });
    return bytes;
    } catch (error) { const value = { operation: 'asset-read', code: error.code }; violations.push(value); emit({ kind: 'offline-denied', ...value }); throw error; }
  }
  replace(moduleAPI, 'createRequire', filename => {
    const absolute = filename instanceof URL || (typeof filename === 'string' && filename.startsWith('file:')) ? fileURLToPath(filename) : filename;
    if (!files.has(absolute)) return deny('REQUIRE_BASE')(absolute);
    const underlying = createRequire(filename);
    const checked = specifier => {
      const resolved = underlying.resolve(specifier);
      if (!(isBuiltin(resolved) || files.has(resolved))) return deny('UNBOUND_REQUIRE')(resolved);
      return underlying(specifier);
    };
    checked.resolve = specifier => { const resolved = underlying.resolve(specifier); if (!(isBuiltin(resolved) || files.has(resolved))) return deny('UNBOUND_REQUIRE')(resolved); return resolved; };
    return checked;
  });
  for (const name of ['register', 'registerHooks', 'enableCompileCache', 'flushCompileCache', 'runMain']) replace(moduleAPI, name, deny(`module.${name}`));
  replace(fs, 'readFileSync', (filename, options) => { const bytes = asset(filename); return typeof options === 'string' ? bytes.toString(options) : options?.encoding ? bytes.toString(options.encoding) : bytes; });
  replace(fs, 'readFile', (filename, options, callback) => {
    if (typeof options === 'function') { callback = options; options = undefined; }
    try { const bytes = asset(filename); callback(null, typeof options === 'string' ? bytes.toString(options) : options?.encoding ? bytes.toString(options.encoding) : bytes); }
    catch (error) { callback(error); }
  });
  replace(fsp, 'readFile', async (filename, options) => {
    const bytes = asset(filename);
    return typeof options === 'string' ? bytes.toString(options) : options?.encoding ? bytes.toString(options.encoding) : bytes;
  });
  for (const object of [fs, fsp]) for (const name of Object.keys(object)) {
    if (['readFile', 'readFileSync', 'constants'].includes(name)) continue;
    if (typeof object[name] === 'function') replace(object, name, deny(`fs.${name}`));
  }
  replace(fs, 'openSync', (filename, flags) => {
    if (!(flags === 'r' || flags === 0)) return deny('fs.openSync.write')(filename);
    asset(filename);
    const descriptor = openDescriptor(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    descriptors.add(descriptor); return descriptor;
  });
  replace(fs, 'readSync', (descriptor, ...args) => { if (!descriptors.has(descriptor)) return deny('fs.readSync.unowned')(descriptor); return readDescriptor(descriptor, ...args); });
  replace(fs, 'fstatSync', descriptor => { if (!descriptors.has(descriptor)) return deny('fs.fstatSync.unowned')(descriptor); return statDescriptor(descriptor); });
  replace(fs, 'closeSync', descriptor => { if (!descriptors.has(descriptor)) return deny('fs.closeSync.unowned')(descriptor); closeDescriptor(descriptor); descriptors.delete(descriptor); });
  const guardedRealpath = (filename, options) => {
    const absolute = filename instanceof URL ? fileURLToPath(filename) : path.resolve(filename);
    asset(absolute);
    const actual = realpath(absolute);
    requireThat(actual === absolute, 'REALPATH_ALIAS', { actual, absolute });
    return options === 'buffer' || options?.encoding === 'buffer' ? Buffer.from(actual) : actual;
  };
  guardedRealpath.native = guardedRealpath;
  replace(fs, 'realpathSync', guardedRealpath);
  for (const [object, names] of [[http, ['request', 'get', 'createServer']], [https, ['request', 'get', 'createServer']], [net, ['connect', 'createConnection', 'createServer', 'Socket', 'Server']], [tls, ['connect', 'createServer', 'TLSSocket']], [dns, Object.keys(dns)], [dns.promises, Object.keys(dns.promises)], [dgram, ['createSocket']], [childProcess, Object.keys(childProcess)], [workers, ['Worker']]]) for (const name of names) replace(object, name, deny(name === 'Worker' ? 'UNSUPPORTED_WORKER_ASSET_ADMISSION' : name));
  replace(globalThis, 'fetch', deny('fetch'));
  replace(globalThis, 'WebSocket', deny('WebSocket'));
  for (const name of ['exit', 'kill', 'chdir', 'dlopen', 'binding', '_linkedBinding', 'getBuiltinModule']) replace(process, name, deny(`process.${name}`));
  const set = timers.setTimeout, clear = timers.clearTimeout, interval = timers.setInterval, clearInterval = timers.clearInterval;
  function start(callback, duration, ...args) {
    let handle;
    handle = set(() => { pending.delete(handle); callback(...args); }, duration);
    pending.add(handle); return handle;
  }
  function stop(handle) { pending.delete(handle); return clear(handle); }
  for (const object of [timers, globalThis]) { replace(object, 'setTimeout', start); replace(object, 'clearTimeout', stop); replace(object, 'setInterval', (callback, duration, ...args) => { const handle = interval(callback, duration, ...args); pending.add(handle); return handle; }); replace(object, 'clearInterval', handle => { pending.delete(handle); return clearInterval(handle); }); }
  for (const name of ['setTimeout', 'setImmediate']) {
    const original = timerPromises[name];
    replace(timerPromises, name, (...args) => { const token = {}; pending.add(token); return original(...args).finally(() => { pending.delete(token); }); });
  }
  replace(timerPromises, 'setInterval', deny('unsupported-timers-promises.setInterval'));
  for (const name of ['compile', 'instantiate', 'compileStreaming', 'instantiateStreaming', 'Module']) replace(WebAssembly, name, deny(`UNSUPPORTED_WASM_ADMISSION.${name}`));
  syncBuiltinESMExports();
  return { receipt: () => ({ pending: pending.size + descriptors.size, descriptors: descriptors.size, violations, assets, scope: 'trusted dependency operation guard; not adversarial JavaScript isolation', workerWasmPolicy: 'refuse before creation/compilation; unsupported never qualifies' }), close() { for (const restore of restores.reverse()) restore(); syncBuiltinESMExports(); } };
}
