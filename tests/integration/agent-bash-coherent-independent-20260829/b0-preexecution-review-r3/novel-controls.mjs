import fs from 'node:fs';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { supervisor, completeWrite, clock } from './capsule/stage-b0-r3/owner.mjs';
const rows = [];
const outcome = promise => promise.then(value => ({ ok: true, value }), reason => ({ ok: false, reason }));
const run = state => state.manager.run('case', 'SYNTHETIC-NOT-EXECUTED', [], { cwd: '/PURE', env: {}, seconds: 1 });
function fake(config = {}) {
  const handles = new Map(), files = new Map(), signals = [], closes = [];
  let descriptor = 0, spawns = 0, stdoutWrites = 0, eventWrites = 0;
  const io = {
    openSync(name) {
      if (config.openSuffix && name.endsWith(config.openSuffix)) throw config.openReason;
      handles.set(++descriptor, name); files.set(name, Buffer.alloc(0)); return descriptor;
    },
    writeSync(fd, bytes, offset, length) {
      const name = handles.get(fd); assert.ok(name);
      let count = length;
      if (name.endsWith('events.jsonl') && config.eventFailure && eventWrites++ === 0) throw 0;
      if (name.endsWith('.stdout') && config.partialFailure) {
        if (stdoutWrites++ > 0) throw undefined;
        count = 1;
      }
      files.set(name, Buffer.concat([files.get(name), bytes.subarray(offset, offset + count)]));
      return count;
    },
    fsyncSync(fd) {
      assert.ok(handles.has(fd));
      if (config.flushFailure && handles.get(fd).endsWith('.stdout')) throw false;
      if (config.eventFlushFailure && handles.get(fd).endsWith('events.jsonl')) throw 0;
    },
    closeSync(fd) {
      const name = handles.get(fd); assert.ok(name); closes.push(name); handles.delete(fd);
      if (config.onClose) config.onClose(name);
      if (config.closeFailure && name.endsWith('.stdout')) throw false;
    },
  };
  const spawn = () => {
    spawns++;
    const child = new EventEmitter(); child.pid = 123456;
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
    child.stdin.end = () => queueMicrotask(() => {
      if (config.childFailure) child.emit('error', config.reason);
      if (config.data) child.stdout.emit('data', Buffer.from('AB'));
      child.emit('exit', 0, null); child.emit('close', 0, null);
    });
    return child;
  };
  const kill = (pid, signal) => {
    signals.push({ pid, signal });
    if (signal === 0) throw Object.assign(new Error('synthetic absent'), { code: 'ESRCH' });
  };
  const manager = supervisor('/PURE', 1620, 1024, { io, spawn, kill, now: config.now ?? (() => 0), started: 0, roles: ['case', 'second'] });
  return { manager, io, handles, files, signals, closes, get spawns() { return spawns; } };
}
async function test(id, body) { const detail = await body(); rows.push({ id, status: 'PASS', detail }); }
await test('N01-invalid-progress-domain', async () => {
  for (const value of [-1, NaN, Infinity, 0.5, 3]) {
    let calls = 0, progress = 0;
    assert.throws(() => completeWrite({ writeSync() { calls++; return value; } }, 1, Buffer.from('AB'), () => progress++));
    assert.equal(calls, 1); assert.equal(progress, 0);
  }
  return { variants: 5 };
});
await test('N02-partial-then-undefined-with-secondary', async () => {
  const state = fake({ partialFailure: true, data: true, flushFailure: true });
  const result = await outcome(run(state)); assert.equal(result.ok, false); assert.equal(result.reason, undefined);
  assert.equal(state.files.get('/PURE/00-case.stdout').toString(), 'A');
  assert.ok(state.manager.records.some(row => row.phase === 'capture-flush' && row.reason === false));
  const retirement = state.manager.abort(result.reason);
  assert.equal(retirement.attemptedBytes, 2); assert.equal(retirement.storedBytes, 1); assert.equal(state.handles.size, 0);
});
await test('N03-first-acquisition-and-event-open-falsy', async () => {
  let present = false, reason;
  try { fake({ openSuffix: 'events.jsonl', openReason: 0 }); } catch (error) { present = true; reason = error; }
  assert.equal(present, true); assert.equal(reason, 0);
  const state = fake({ openSuffix: '.stdout', openReason: undefined });
  const result = await outcome(run(state)); assert.equal(result.ok, false); assert.equal(result.reason, undefined);
  assert.equal(state.spawns, 0); assert.equal(state.handles.size, 1);
  state.manager.abort(result.reason); assert.equal(state.handles.size, 0);
});
await test('N04-close-failure-retains-primary-and-forbids-next', async () => {
  const state = fake({ closeFailure: true, childFailure: true, reason: 0 });
  const result = await outcome(run(state)); assert.equal(result.ok, false); assert.equal(result.reason, 0);
  assert.ok(state.closes.some(name => name.endsWith('.stderr')));
  assert.ok(state.manager.records.some(row => row.phase === 'capture-close' && row.reason === false));
  assert.ok(state.manager.records.some(row => row.phase === 'unknown'));
  assert.equal((await outcome(state.manager.run('second', 'NONE', [], { cwd: '/', env: {} }))).ok, false);
  assert.equal(state.spawns, 1); state.manager.abort(0); assert.equal(state.handles.size, 0);
});
await test('N05-observer-failure-after-spawn-teardown', async () => {
  const state = fake({ eventFailure: true });
  const result = await outcome(run(state)); assert.equal(result.ok, false); assert.equal(result.reason, 0);
  assert.ok(state.signals.some(row => row.signal === 'SIGTERM'));
  assert.ok(state.signals.some(row => row.signal === 0));
  state.manager.abort(0); assert.equal(state.handles.size, 0);
  return { nativeSignals: 0, syntheticSignals: state.signals.length };
});
await test('N06-publication-overdue-after-persist-not-success', async () => {
  let current = 1619999;
  const state = fake({ now: () => current, onClose(name) { if (name.endsWith('result.json')) current = 1800000; } });
  await run(state); state.manager.finish();
  assert.throws(() => state.manager.publish('/PURE/result.json', { status: 'PASS' }));
  assert.ok(state.files.has('/PURE/result.json')); assert.equal(state.handles.size, 0);
  return { artifactMayExist: true, publishReturnedSuccess: false };
});
await test('N07-finish-failure-cannot-readmit', async () => {
  const state = fake({ eventFlushFailure: true }); await run(state);
  let present = false, reason;
  try { state.manager.finish(); } catch (error) { present = true; reason = error; }
  assert.equal(present, true); assert.equal(reason, 0); assert.equal(state.handles.size, 0);
  assert.equal((await outcome(run(state))).ok, false); assert.equal(state.spawns, 1);
});
await test('N08-overlap-and-exact-shared-boundaries', async () => {
  const state = fake(); const pending = run(state);
  const refused = await outcome(state.manager.run('second', 'NONE', [], { cwd: '/', env: {} }));
  assert.equal(refused.ok, false); await pending; assert.equal(state.spawns, 1);
  state.manager.finish(); assert.equal(state.handles.size, 0);
  let current = 1619999; const shared = clock(0, () => current);
  assert.equal(shared.remaining(), 1); current++; assert.throws(() => shared.remaining());
  assert.equal(shared.publication(), 180000); current = 1800000; assert.throws(() => shared.publication());
});
assert.equal(rows.length, 8);
fs.writeFileSync(new URL('./NOVEL-RESULT.json', import.meta.url), JSON.stringify({ role: 'WHOLE_OWNER_PURE_SYNTHETIC_DEPENDENCIES', groups: rows, realChildSpawns: 0, nativeFdInjection: 0, nativeSignals: 0, productImports: 0 }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ groups: rows.length, passed: rows.length, realChildSpawns: 0 }));
