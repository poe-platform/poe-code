import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import test from 'node:test';
import { boundedProcess } from './harness.js';

for (const closedBeforeCheck of [true, false]) test(`process deadline preserves queued close: ${closedBeforeCheck}`, async context => {
  const child = Object.assign(new EventEmitter(), {
    pid: 12345,
    stdout: new EventEmitter(), stderr: new EventEmitter(),
    stdin: Object.assign(new EventEmitter(), { end() {} }),
  });
  let deadline: (() => void) | undefined;
  context.mock.method(childProcess, 'spawn', () => child);
  syncBuiltinESMExports();
  context.after(() => { context.mock.restoreAll(); syncBuiltinESMExports(); });
  const kill = context.mock.method(process, 'kill', () => true);
  context.mock.method(globalThis, 'setTimeout', (callback: () => void) => {
    deadline = callback;
    return 1;
  });
  context.mock.method(globalThis, 'clearTimeout', () => {});
  const pending = boundedProcess('fixture', [], { cwd: '/', env: {} });
  child.stdout.emit('data', Buffer.from('complete'));
  assert.ok(deadline);
  deadline();
  await new Promise<void>(resolve => setImmediate(resolve));
  if (!closedBeforeCheck) {
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  assert.equal(kill.mock.callCount(), closedBeforeCheck ? 0 : 1);
  if (!closedBeforeCheck) assert.deepEqual(kill.mock.calls[0]!.arguments, [-12345, 'SIGKILL']);
  child.emit('exit', 0, null);
  child.emit('close', 0, null);
  const result = await pending;
  assert.equal(result.timedOut, !closedBeforeCheck);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'complete');
});
