import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPythonJspiScheduler } from '../../../src/commands/python/jspi-scheduler.js';

test('retirement cancels queued Python callbacks and releases their proxies exactly once', async () => {
  const scheduler = createPythonJspiScheduler();
  let calls = 0;
  let releases = 0;
  const callback = Object.assign(() => { calls++; }, {destroy() { releases++; }});
  scheduler.scheduleCallback(callback, 10000);
  const closing = scheduler.close();
  assert.equal(scheduler.close(), closing);
  await closing;
  assert.equal(calls, 0);
  assert.equal(releases, 1);
  assert.throws(() => scheduler.scheduleCallback(callback, 0), /closed/);
  assert.equal(releases, 2);
});

test('retirement drains an admitted suspending callback before settling', async () => {
  const scheduler = createPythonJspiScheduler();
  let started!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  scheduler.scheduleCallback(async () => { started(); await blocked; });
  await entered;
  let settled = false;
  const closing = scheduler.close().then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  release();
  await closing;
  assert.equal(settled, true);
});

test('callback failure is observed and reported only after cooperative retirement', async () => {
  const scheduler = createPythonJspiScheduler();
  const failure = new Error('callback failed');
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  scheduler.scheduleCallback(() => { started(); throw failure; });
  await entered;
  await assert.rejects(scheduler.close(), error => error === failure);
});

test('closing one invocation does not retire a sibling scheduler', async () => {
  const first = createPythonJspiScheduler();
  const sibling = createPythonJspiScheduler();
  let finished!: () => void;
  const ran = new Promise<void>(resolve => { finished = resolve; });
  sibling.scheduleCallback(finished);
  await first.close();
  await ran;
  await sibling.close();
});

test('the scheduler invokes strict Python callbacks without promise continuation arguments', async () => {
  const scheduler = createPythonJspiScheduler();
  let finished!: () => void;
  const entered = new Promise<void>(resolve => { finished = resolve; });
  scheduler.scheduleCallback((...args: unknown[]) => { finished(); assert.equal(args.length, 0); });
  await entered;
  await scheduler.close();
});

test('proxy release can reenter retirement without duplicating release or its promise', async () => {
  const scheduler = createPythonJspiScheduler();
  let releases = 0;
  let reentered: Promise<void> | undefined;
  scheduler.scheduleCallback(Object.assign(() => {}, {destroy() {
    releases++;
    if (releases === 1) reentered = scheduler.close();
  }}), 10000);
  const closing = scheduler.close();
  await closing;
  assert.equal(reentered, closing);
  assert.equal(releases, 1);
});
