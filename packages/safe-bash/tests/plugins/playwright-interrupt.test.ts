import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createPlaywrightAdapter, type PlaywrightBrowser, type PlaywrightContext } from '../../src/playwright/adapter.js';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

function observe(promise: Promise<unknown>) {
  let settled = false;
  const result = Promise.allSettled([promise]).then(([outcome]) => {
    settled = true;
    assert.ok(outcome);
    return outcome;
  });
  return { result, get settled() { return settled; } };
}

function fixture(withInterrupt = true) {
  const calls: string[] = [];
  const close = deferred();
  const interrupt = deferred();
  const host = deferred();
  const effects: { acquire?: () => Promise<void>; close?: () => Promise<void>; interrupt?: () => Promise<void>; release?: () => Promise<void> } = {};
  let connected = true;
  const context = Object.assign(new EventEmitter(), {
    newPage: async () => { throw new Error('unused'); }, pages: () => [],
    close() { calls.push('context.close'); return effects.close?.() ?? close.promise; },
  }) satisfies PlaywrightContext;
  const browser = Object.assign(new EventEmitter(), {
    isConnected: () => connected,
    newContext: async () => { calls.push('browser.newContext'); return context; },
  }) satisfies PlaywrightBrowser;
  const resource: { browser: PlaywrightBrowser; interrupt?: () => Promise<void>; release(): Promise<void> } = {
    browser,
    release() { assert.equal(this, resource); calls.push('resource.release'); return effects.release?.() ?? host.promise; },
  };
  if (withInterrupt) resource.interrupt = function () {
    assert.equal(this, resource);
    calls.push('resource.interrupt');
    return effects.interrupt?.() ?? interrupt.promise;
  };
  const adapter = createPlaywrightAdapter({ chromium: { async acquireBrowser() {
    calls.push('acquire');
    await effects.acquire?.();
    return resource;
  } } });
  return {
    adapter, resource, context, browser, calls, effects, close, interrupt, host,
    disconnect() { connected = false; browser.emit('disconnected'); },
  };
}

function request(signal = new AbortController().signal) {
  return { acquisitionId: 'interrupt-test', session: 'victim', browser: 'chromium' as const, headless: true, signal };
}

for (const error of [new Error('interrupt getter failed'), undefined]) test(`interrupt lookup failure drains closure and release: ${String(error)}`, async () => {
  const state = fixture();
  Object.defineProperty(state.resource, 'interrupt', { get() { throw error; } });
  state.close.resolve();
  state.host.resolve();
  const lease = await state.adapter.acquire(request());
  const observed = observe(lease.release());
  assertFailures(await observed.result, [error]);
  assert.equal(state.calls.filter(call => call === 'context.close').length, 1);
  assert.equal(state.calls.filter(call => call === 'resource.release').length, 1);
  assert.equal(state.browser.listenerCount('disconnected'), 0);
  assert.equal(state.context.listenerCount('close'), 0);
});

function assertFailures(outcome: PromiseSettledResult<unknown>, errors: unknown[]) {
  if (errors.length === 0) {
    assert.equal(outcome.status, 'fulfilled');
    return;
  }
  assert.equal(outcome.status, 'rejected');
  if (outcome.status !== 'rejected') return;
  if (errors.length === 1) assert.equal(outcome.reason, errors[0]);
  else {
    assert.ok(outcome.reason instanceof AggregateError);
    assert.equal(outcome.reason.errors.length, errors.length);
    for (const error of errors) assert.ok(outcome.reason.errors.some((actual: unknown) => Object.is(actual, error)), 'original failure identity must survive');
  }
}

for (const first of ['close', 'interrupt'] as const) {
  for (const failsFirst of [false, true]) {
    test(`release starts both operations and drains ${first} ${failsFirst ? 'rejection' : 'completion'} before host release`, async () => {
      const state = fixture();
      const lease = await state.adapter.acquire(request());
      let notifications = 0;
      let reentrant: Promise<void> | undefined;
      lease.onClosed(() => { notifications++; reentrant = lease.release(); });
      const completion = lease.release();
      const observed = observe(completion);
      const concurrent = lease.release();
      await new Promise<void>(resolve => setImmediate(resolve));
      const admitted = [...state.calls];
      const firstError = new Error(`${first} failed`);
      if (failsFirst) state[first].reject(firstError);
      else state[first].resolve();
      await new Promise<void>(resolve => setImmediate(resolve));
      const prematureHost = state.calls.includes('resource.release');
      const prematureSettlement = observed.settled;
      state.close.resolve();
      state.interrupt.resolve();
      await new Promise<void>(resolve => setImmediate(resolve));
      const hostStarted = state.calls.includes('resource.release');
      const abandonedHost = observed.settled;
      state.host.resolve();
      const outcome = await observed.result;
      assert.equal(concurrent, completion);
      assert.equal(reentrant, completion);
      assert.equal(lease.release(), completion);
      assert.equal(notifications, 1);
      assert.ok(admitted.includes('context.close'));
      assert.ok(admitted.includes('resource.interrupt'), 'interrupt must start while context.close is pending');
      assert.equal(admitted.includes('resource.release'), false);
      assert.equal(prematureHost, false, 'host release must await both operations even when one rejects');
      assert.equal(prematureSettlement, false);
      assert.equal(hostStarted, true);
      assert.equal(abandonedHost, false);
      assert.equal(state.calls.filter(call => call === 'context.close').length, 1);
      assert.equal(state.calls.filter(call => call === 'resource.interrupt').length, 1);
      assert.equal(state.calls.filter(call => call === 'resource.release').length, 1);
      assert.equal(state.context.listenerCount('close'), 0);
      assert.equal(state.browser.listenerCount('disconnected'), 0);
      assertFailures(outcome, failsFirst ? [firstError] : []);
    });
  }
}

for (const closeResult of ['success', 'confirmed-target-closed', 'unconfirmed-target-closed', 'genuine-failure'] as const) {
  test(`interrupt unblocks stalled context close: ${closeResult}`, async () => {
    const state = fixture();
    const closeError = new Error(closeResult === 'genuine-failure' ? 'context flush failed' : 'browserContext.close: Target page, context or browser has been closed');
    let unblockedByInterrupt = false;
    state.effects.interrupt = async () => {
      unblockedByInterrupt = true;
      if (closeResult !== 'unconfirmed-target-closed') state.disconnect();
      if (closeResult === 'success') state.close.resolve();
      else state.close.reject(closeError);
    };
    const lease = await state.adapter.acquire(request());
    const observed = observe(lease.release());
    await new Promise<void>(resolve => setImmediate(resolve));
    const neededRescue = !unblockedByInterrupt;
    state.close.resolve();
    state.host.resolve();
    const outcome = await observed.result;
    assert.equal(neededRescue, false, 'stalled close required test rescue because interrupt was never initiated');
    assert.equal(state.calls.filter(call => call === 'resource.release').length, 1);
    assertFailures(outcome, closeResult === 'genuine-failure' || closeResult === 'unconfirmed-target-closed' ? [closeError] : []);
  });
}

for (const mode of ['sync', 'async'] as const) {
  for (const value of ['error', 'undefined', 'false'] as const) {
    for (const hostFails of [false, true]) {
      test(`${mode} interrupt ${value} failure retains identity; host ${hostFails ? 'fails' : 'succeeds'}`, async () => {
        const state = fixture();
        const interruptError = value === 'error' ? new Error('interrupt failed') : value === 'false' ? false : undefined;
        const hostError = new Error('host release failed');
        state.effects.interrupt = mode === 'sync' ? () => { throw interruptError; } : async () => { throw interruptError; };
        state.close.resolve();
        if (hostFails) state.effects.release = async () => { throw hostError; };
        else state.host.resolve();
        const lease = await state.adapter.acquire(request());
        const observed = observe(lease.release());
        await new Promise<void>(resolve => setImmediate(resolve));
        state.interrupt.resolve();
        const outcome = await observed.result;
        assert.equal(state.calls.filter(call => call === 'resource.release').length, 1);
        assertFailures(outcome, hostFails ? [interruptError, hostError] : [interruptError]);
        assert.equal(state.calls.filter(call => call === 'resource.interrupt').length, 1);
      });
    }
  }
}

for (const confirmed of [false, true]) {
  test(`target-closed interrupt and host errors are never suppressed; confirmed=${confirmed}`, async () => {
    const state = fixture();
    const closeError = new Error('browserContext.close: Target page, context or browser has been closed');
    const interruptError = new Error(closeError.message);
    const hostError = new Error(closeError.message);
    state.effects.close = async () => { throw closeError; };
    state.effects.interrupt = async () => { if (confirmed) state.disconnect(); throw interruptError; };
    state.effects.release = async () => { throw hostError; };
    const lease = await state.adapter.acquire(request());
    const outcome = await observe(lease.release()).result;
    assert.equal(state.calls.filter(call => call === 'resource.release').length, 1);
    assertFailures(outcome, confirmed ? [interruptError, hostError] : [closeError, interruptError, hostError]);
  });
}

for (const interruptFails of [false, true]) {
  test(`context acquisition rejection interrupts and releases partial resource; interrupt fails=${interruptFails}`, async () => {
    const state = fixture();
    const acquisitionError = new Error('newContext failed');
    const interruptError = new Error('partial resource interrupt failed');
    state.browser.newContext = async () => { throw acquisitionError; };
    const observed = observe(state.adapter.acquire(request()));
    await new Promise<void>(resolve => setImmediate(resolve));
    const admitted = [...state.calls];
    if (interruptFails) state.interrupt.reject(interruptError);
    else state.interrupt.resolve();
    state.host.resolve();
    const outcome = await observed.result;
    assert.equal(admitted.includes('context.close'), false);
    assert.ok(admitted.includes('resource.interrupt'), 'partial acquisition cleanup must interrupt even without a context');
    assert.equal(admitted.includes('resource.release'), false);
    assert.equal(state.calls.filter(call => call === 'resource.release').length, 1);
    assert.equal(state.browser.listenerCount('disconnected'), 0);
    if (!interruptFails) assertFailures(outcome, [acquisitionError]);
    else {
      assert.equal(outcome.status, 'rejected');
      if (outcome.status === 'rejected') {
        assert.ok(outcome.reason instanceof AggregateError);
        assert.equal(outcome.reason.message, 'Playwright acquisition and cleanup failed');
        assert.deepEqual(outcome.reason.errors, [acquisitionError, interruptError]);
      }
    }
  });
}

for (const phase of ['browser', 'context'] as const) {
  test(`caller abort during ${phase} acquisition drains late resource via interrupt`, async () => {
    const state = fixture();
    const acquisition = deferred();
    const cancellation = new AbortController();
    const reason = new Error(`abort pending ${phase}`);
    if (phase === 'browser') state.effects.acquire = () => acquisition.promise;
    else state.browser.newContext = async () => { await acquisition.promise; return state.context; };
    let interrupted = false;
    state.effects.interrupt = async () => { interrupted = true; state.disconnect(); state.close.resolve(); };
    const observed = observe(state.adapter.acquire(request(cancellation.signal)));
    await new Promise<void>(resolve => setImmediate(resolve));
    cancellation.abort(reason);
    const settledBeforeAcquisition = observed.settled;
    acquisition.resolve();
    await new Promise<void>(resolve => setImmediate(resolve));
    const neededRescue = !interrupted;
    state.close.resolve();
    state.host.resolve();
    const outcome = await observed.result;
    assert.equal(settledBeforeAcquisition, false);
    assert.equal(neededRescue, false, 'abort cleanup did not initiate interrupt');
    assert.equal(state.calls.filter(call => call === 'context.close').length, phase === 'context' ? 1 : 0);
    assert.equal(state.calls.filter(call => call === 'resource.release').length, 1);
    assert.equal(state.context.listenerCount('close'), 0);
    assert.equal(state.browser.listenerCount('disconnected'), 0);
    assertFailures(outcome, [reason]);
  });
}

test('without interrupt close still completes before host release and completion is shared', async () => {
  const state = fixture(false);
  const lease = await state.adapter.acquire(request());
  const completion = lease.release();
  const observed = observe(completion);
  const concurrent = lease.release();
  await new Promise<void>(resolve => setImmediate(resolve));
  const prematureHost = state.calls.includes('resource.release');
  state.close.resolve();
  await new Promise<void>(resolve => setImmediate(resolve));
  const hostStarted = state.calls.includes('resource.release');
  const prematureSettlement = observed.settled;
  state.host.resolve();
  const outcome = await observed.result;
  assert.equal(concurrent, completion);
  assert.equal(prematureHost, false);
  assert.equal(hostStarted, true);
  assert.equal(prematureSettlement, false);
  assert.deepEqual(state.calls, ['acquire', 'browser.newContext', 'context.close', 'resource.release']);
  assertFailures(outcome, []);
});

test('already aborted caller never acquires or interrupts a resource', async () => {
  const state = fixture();
  const reason = new Error('already aborted');
  const outcome = await observe(state.adapter.acquire(request(AbortSignal.abort(reason)))).result;
  assertFailures(outcome, [reason]);
  assert.deepEqual(state.calls, []);
});

test('abort after lease transfer does not interrupt until explicit release', async () => {
  const state = fixture();
  const cancellation = new AbortController();
  const lease = await state.adapter.acquire(request(cancellation.signal));
  cancellation.abort(new Error('request completed'));
  await new Promise<void>(resolve => setImmediate(resolve));
  const callsBeforeRelease = [...state.calls];
  state.close.resolve();
  state.interrupt.resolve();
  state.host.resolve();
  const outcome = await observe(lease.release()).result;
  assert.deepEqual(callsBeforeRelease, ['acquire', 'browser.newContext']);
  assert.equal(state.calls.filter(call => call === 'resource.interrupt').length, 1);
  assert.equal(state.calls.filter(call => call === 'resource.release').length, 1);
  assertFailures(outcome, []);
});
