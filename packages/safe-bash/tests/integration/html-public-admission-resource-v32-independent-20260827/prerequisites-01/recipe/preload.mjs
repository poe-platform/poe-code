import fs from 'node:fs';
import childProcess from 'node:child_process';
import { register, syncBuiltinESMExports } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const preload = fileURLToPath(import.meta.url);
const recipe = dirname(preload), raw = resolve(recipe, '../raw');
const binding = JSON.parse(fs.readFileSync(join(recipe, 'BINDINGS.json')));
const manifest = JSON.parse(fs.readFileSync(join(recipe, 'MANIFEST.json')));
const allowed = { ...binding.allowedModules };
for (const [name, identity] of Object.entries(manifest.inventory.files)) if (name.endsWith('.mjs')) allowed[join(recipe, name)] = identity.sha256;
register('./loader.mjs', import.meta.url, { data: { allowed, logfile: join(raw, `loads-${process.pid}.jsonl`) } });
const descriptor = fs.openSync(join(raw, `process-${process.pid}.jsonl`), 'wx');
const nativeSpawn = childProcess.spawn, nativeSync = childProcess.spawnSync, nativeExec = childProcess.execFileSync;
function event(type, fields = {}) {
  fs.writeSync(descriptor, `${JSON.stringify({ at: new Date().toISOString(), ns: process.hrtime.bigint().toString(), pid: process.pid, type, ...fields })}\n`);
  fs.fsyncSync(descriptor);
}
event('start', { argv: process.argv, execArgv: process.execArgv });
childProcess.spawn = function (executable, args, options) {
  const actualArgs = executable === process.execPath ? ['--import', preload, ...args] : args;
  const child = Reflect.apply(nativeSpawn, this, [executable, actualArgs, options]);
  event('spawn', { childPid: child.pid, executable, args, actualArgs, detached: options?.detached === true });
  const originalKill = child.kill;
  child.kill = function (signal) {
    const accepted = Reflect.apply(originalKill, this, [signal]);
    event('signal', { childPid: child.pid, signal, accepted });
    return accepted;
  };
  child.once('error', error => event('error', { childPid: child.pid, code: error.code, message: error.message }));
  child.once('exit', (code, signal) => event('exit', { childPid: child.pid, code, signal }));
  child.once('close', (code, signal) => event('close', { childPid: child.pid, code, signal }));
  return child;
};
childProcess.spawnSync = function (...args) {
  const result = Reflect.apply(nativeSync, this, args);
  event('sync-close', { executable: args[0], args: args[1], childPid: result.pid, status: result.status, signal: result.signal, error: result.error?.message });
  return result;
};
childProcess.execFileSync = function (...args) {
  try { const result = Reflect.apply(nativeExec, this, args); event('exec-sync-return', { executable: args[0], args: args[1], status: 0 }); return result; }
  catch (error) { event('exec-sync-error', { executable: args[0], args: args[1], status: error.status, signal: error.signal }); throw error; }
};
syncBuiltinESMExports();
process.once('exit', code => event('process-exit', { code }));
