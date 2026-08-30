import fs from 'node:fs';
import childProcess from 'node:child_process';
import assert from 'node:assert/strict';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const preload = fileURLToPath(import.meta.url);
const owned = resolve(dirname(preload), '..');
const native = { open: fs.openSync, close: fs.closeSync, sync: fs.fsyncSync, write: fs.writeSync, spawn: childProcess.spawn, kill: process.kill };
const descriptor = native.open(join(owned, 'raw', 'observations', `${process.pid}.jsonl`), 'wx');
const descriptors = new Map();
let sequence = 0, firstAssertion = null;
function event(type, fields = {}) {
  native.write(descriptor, `${JSON.stringify({ sequence: ++sequence, monotonicNs: process.hrtime.bigint().toString(), at: new Date().toISOString(), pid: process.pid, ppid: process.ppid, type, ...fields })}\n`);
  native.sync(descriptor);
}
event('observer-start', { argv: process.argv, execArgv: process.execArgv, execPath: process.execPath, memory: process.memoryUsage() });
fs.openSync = function (path, ...args) {
  const result = Reflect.apply(native.open, this, [path, ...args]);
  descriptors.set(result, typeof path === 'string' ? resolve(path) : String(path));
  return result;
};
fs.closeSync = function (target) {
  const result = Reflect.apply(native.close, this, [target]);
  descriptors.delete(target);
  return result;
};
fs.fsyncSync = function (target) {
  const result = Reflect.apply(native.sync, this, [target]);
  const path = descriptors.get(target) ?? null;
  event('fsync-completed', { path });
  if (path?.endsWith('/RAW-RECEIPT.json')) firstAssertion = path;
  return result;
};
for (const method of ['equal', 'ok', 'deepEqual']) {
  const original = assert[method];
  assert[method] = function (...args) {
    if (firstAssertion) {
      event('first-assertion-after-raw', { receipt: firstAssertion, method });
      firstAssertion = null;
    }
    return Reflect.apply(original, this, args);
  };
}
childProcess.spawn = function (executable, args, options) {
  const isNode = executable === process.execPath;
  const actualArgs = isNode ? ['--import', preload, ...args] : args;
  const child = Reflect.apply(native.spawn, this, [executable, actualArgs, options]);
  event('spawn', { childPid: child.pid ?? null, executable, originalArgs: args, actualArgs, detached: options?.detached ?? false });
  const kill = child.kill;
  child.kill = function (signal) {
    event('child-kill-before', { childPid: child.pid, signal: signal ?? 'SIGTERM', exitCode: child.exitCode, signalCode: child.signalCode, memory: process.memoryUsage() });
    const accepted = Reflect.apply(kill, this, [signal]);
    event('child-kill-return', { childPid: child.pid, signal: signal ?? 'SIGTERM', accepted });
    return accepted;
  };
  child.once('error', error => event('child-error', { childPid: child.pid ?? null, code: error.code, message: error.message }));
  child.once('exit', (code, signal) => event('child-exit', { childPid: child.pid, code, signal }));
  child.once('close', (code, signal) => event('child-close', { childPid: child.pid, code, signal }));
  return child;
};
process.kill = function (pid, signal) {
  if (signal !== 0) event('process-kill-before', { target: pid, signal: signal ?? 'SIGTERM', memory: process.memoryUsage() });
  return Reflect.apply(native.kill, this, [pid, signal]);
};
syncBuiltinESMExports();
process.once('exit', code => { event('process-exit-event', { code, memory: process.memoryUsage() }); });
