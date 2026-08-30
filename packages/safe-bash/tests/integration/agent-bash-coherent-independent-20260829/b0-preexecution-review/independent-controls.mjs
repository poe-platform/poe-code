import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
const here = import.meta.dirname;
const originalSpawn = childProcess.spawn;
const originalKill = process.kill;
const originalOpen = fs.openSync;
const originalClose = fs.closeSync;
const originalWrite = fs.writeSync;
const rows = [];
let scenario;
let spawned = 0;
childProcess.spawn = () => {
  spawned++;
  if (scenario.spawnError) throw scenario.reason;
  const child = new EventEmitter();
  child.pid = 900000000;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.end = () => queueMicrotask(() => {
    if (scenario.errorEvent) child.emit('error', scenario.reason);
    if (scenario.output) child.stdout.emit('data', Buffer.from(scenario.output));
    child.emit('exit', scenario.status ?? 0, null);
    child.emit('close', scenario.status ?? 0, null);
  });
  return child;
};
process.kill = (_pid, signal) => {
  if (signal === 0) throw Object.assign(new Error('synthetic absent group'), { code: 'ESRCH' });
  return true;
};
syncBuiltinESMExports();
const { supervisor } = await import('./capsule/stage-a-r2/common.mjs');
async function probe(id, input) {
  scenario = input;
  const directory = path.join(here, 'synthetic', id);
  fs.mkdirSync(directory, { recursive: true });
  const manager = supervisor(directory, 5, 65536);
  const descriptors = new Set();
  let stdoutDescriptor;
  let outcome;
  const before = spawned;
  fs.openSync = function(filename, ...args) {
    if (input.openFailure && String(filename).endsWith('.stderr')) throw input.reason;
    const descriptor = originalOpen.call(fs, filename, ...args);
    descriptors.add(descriptor);
    if (String(filename).endsWith('.stdout')) stdoutDescriptor = descriptor;
    return descriptor;
  };
  fs.closeSync = function(descriptor) {
    const result = originalClose.call(fs, descriptor);
    descriptors.delete(descriptor);
    return result;
  };
  fs.writeSync = function(descriptor, value, ...args) {
    if (input.shortWrite && descriptor === stdoutDescriptor && Buffer.isBuffer(value)) {
      return originalWrite.call(fs, descriptor, value.subarray(0, 1));
    }
    return originalWrite.call(fs, descriptor, value, ...args);
  };
  try {
    await manager.run(id, '/never-launched', [], { cwd: directory, env: {}, seconds: 1 });
    outcome = { returned: true };
  } catch (error) {
    outcome = { returned: false, exactReason: error === input.reason, message: error instanceof Error ? error.message : String(error) };
  } finally {
    fs.openSync = originalOpen;
    fs.closeSync = originalClose;
    fs.writeSync = originalWrite;
  }
  const leakedDescriptors = descriptors.size;
  for (const descriptor of descriptors) originalClose(descriptor);
  const finished = manager.finish();
  const stdout = path.join(directory, '00-' + id + '.stdout');
  return { id, ...outcome, leakedDescriptors, verifierClosedDescriptors: leakedDescriptors, fakeSpawnCalls: spawned - before, captured: finished.captured, actualOutputHex: fs.existsSync(stdout) ? fs.readFileSync(stdout).toString('hex') : '' };
}
try {
  for (const [index, reason] of [0, false, null, undefined].entries()) {
    const result = await probe('I01-' + index, { errorEvent: true, reason });
    rows.push({ ...result, requirementMet: !result.returned && result.exactReason, role: 'synthetic non-Error error-event; not native event claim' });
  }
  const reason = new Error('exact synthetic error');
  const identity = await probe('I02', { errorEvent: true, reason });
  rows.push({ ...identity, requirementMet: !identity.returned && identity.exactReason && identity.leakedDescriptors === 0 });
  const short = await probe('I03', { output: 'AB', shortWrite: true });
  rows.push({ ...short, requirementMet: !short.returned || short.actualOutputHex === '4142', role: 'injected short write return' });
  const open = await probe('I04', { openFailure: true, reason });
  rows.push({ ...open, requirementMet: !open.returned && open.exactReason && open.fakeSpawnCalls === 0 && open.leakedDescriptors === 0 });
  const spawn = await probe('I05', { spawnError: true, reason });
  rows.push({ ...spawn, requirementMet: !spawn.returned && spawn.exactReason && spawn.leakedDescriptors === 0 });
  const nonzero = await probe('I06', { status: 13 });
  rows.push({ ...nonzero, requirementMet: !nonzero.returned && nonzero.leakedDescriptors === 0 });
  assert.equal(rows.length, 9);
  fs.writeFileSync(path.join(here, 'INDEPENDENT-CONTROLS.json'), JSON.stringify({ role: 'SYNTHETIC_ONLY', families: 6, rows, realChildFixtures: 0, workers: 0, productImports: 0, allInjectedDescriptorsClosed: true }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ families: 6, predicates: rows.length, met: rows.filter(row => row.requirementMet).length, unmet: rows.filter(row => !row.requirementMet).length }));
} finally {
  childProcess.spawn = originalSpawn;
  process.kill = originalKill;
  fs.openSync = originalOpen;
  fs.closeSync = originalClose;
  fs.writeSync = originalWrite;
  syncBuiltinESMExports();
}
