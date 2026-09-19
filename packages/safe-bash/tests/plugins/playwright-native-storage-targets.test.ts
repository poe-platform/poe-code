import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { createPlaywrightStorageOriginPreparer, type PlaywrightStorageControlEvent } from '../../src/playwright/native-storage-targets.js';
import type { PlaywrightContext } from '../../src/playwright/adapter.js';

test('private storage target uses isolated synthetic navigation and joins destruction', async () => {
  const calls: [string, Record<string, unknown> | undefined, string | undefined][] = [];
  const events = new Set<(event: PlaywrightStorageControlEvent) => void>();
  const emit = (event: PlaywrightStorageControlEvent) => { for (const listener of events) listener(event); };
  const guardCalls: string[] = [];
  const prepare = createPlaywrightStorageOriginPreparer({
    subscribe(listener) { events.add(listener); return () => { events.delete(listener); }; },
    async send(method, params, session) {
      calls.push([method, params, session]);
      if (method === 'Target.createTarget') return { targetId: 'hidden' };
      if (method === 'Target.attachToTarget') return { sessionId: 'control' };
      if (method === 'Target.getTargetInfo') return { targetInfo: { targetId: 'hidden', browserContextId: 'owned' } };
      if (method === 'Page.navigate') emit({ method: 'Fetch.requestPaused', sessionId: 'control', params: { requestId: 'request', resourceType: 'Document', request: { url: 'https://storage.example/' } } });
      if (method === 'Fetch.fulfillRequest') emit({ method: 'Page.loadEventFired', sessionId: 'control', params: {} });
      if (method === 'Target.closeTarget') { emit({ method: 'Target.targetDestroyed', params: { targetId: 'hidden' } }); return { success: true }; }
      return {};
    },
  }, { beginCreation() { guardCalls.push('begin'); return { commit(target) { guardCalls.push(target); }, fail() { guardCalls.push('fail'); }, rollback() { guardCalls.push('rollback'); } }; } });
  const lease = await prepare({ context: {} as PlaywrightContext, browserContextId: 'owned', origin: 'https://storage.example', signal: new AbortController().signal });
  assert.deepEqual(guardCalls, ['begin', 'hidden']);
  assert.ok(calls.find(([method, params]) => method === 'Emulation.setScriptExecutionDisabled' && params?.value === true));
  assert.ok(calls.find(([method, params]) => method === 'Network.setBypassServiceWorker' && params?.bypass === true));
  assert.ok(calls.filter(([method]) => method.startsWith('Fetch.')).every(([, , session]) => session === 'control'));
  await lease.cdp.detach();
  await Promise.all([lease.release(), lease.release()]);
  assert.equal(calls.filter(([method]) => method === 'Target.closeTarget').length, 1);
  assert.equal(events.size, 0);
});

test('detachment during owned target retirement joins destruction without issuing a stale detach', async () => {
  const listeners = new Set<(event: PlaywrightStorageControlEvent) => void>();
  const emit = (event: PlaywrightStorageControlEvent) => { for (const listener of listeners) listener(event); };
  const calls: string[] = [];
  const prepare = createPlaywrightStorageOriginPreparer({ subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; }, async send(method) {
    calls.push(method);
    if (method === 'Target.createTarget') return { targetId: 'hidden' };
    if (method === 'Target.attachToTarget') return { sessionId: 'control' };
    if (method === 'Target.getTargetInfo') return { targetInfo: { targetId: 'hidden', browserContextId: 'owned' } };
    if (method === 'Page.navigate') emit({ method: 'Page.loadEventFired', sessionId: 'control' });
    if (method === 'Target.closeTarget') return { success: true };
    if (method === 'Target.detachFromTarget') throw new Error('Session with given id not found.');
    return {};
  } }, { beginCreation() { return { commit() {}, fail() {}, rollback() {} }; } });
  const controller = new AbortController();
  const lease = await prepare({ context: {} as PlaywrightContext, browserContextId: 'owned', origin: 'https://storage.example', signal: controller.signal });
  controller.abort();
  const detached = lease.cdp.detach();
  const assertion = assert.doesNotReject(detached);
  emit({ method: 'Target.targetDestroyed', params: { targetId: 'hidden' } });
  await assertion;
  await lease.release();
  assert.ok(!calls.includes('Target.detachFromTarget'));
});

function storageControlFixture(options: { load?: boolean; staleLoad?: boolean; navigateError?: Error; closeError?: Error; deferClose?: boolean } = {}) {
  const controller = new AbortController();
  const listeners = new Set<(event: PlaywrightStorageControlEvent) => void>();
  const calls: string[] = [];
  const emit = (event: PlaywrightStorageControlEvent) => { for (const listener of listeners) listener(event); };
  let resolveClose!: (result: Record<string, unknown>) => void;
  const closeResponse = new Promise<Record<string, unknown>>(resolve => { resolveClose = resolve; });
  const prepare = createPlaywrightStorageOriginPreparer({
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async send(method) {
      calls.push(method);
      if (method === 'Target.createTarget') return { targetId: 'hidden' };
      if (method === 'Target.attachToTarget') return { sessionId: 'control' };
      if (method === 'Target.getTargetInfo') return { targetInfo: { targetId: 'hidden', browserContextId: 'owned' } };
      if (method === 'Page.enable' && options.staleLoad) {
        emit({ method: 'Page.loadEventFired', sessionId: 'control' });
        emit({ method: 'Page.lifecycleEvent', sessionId: 'control', params: { name: 'load', loaderId: 'blank-loader' } });
      }
      if (method === 'Page.navigate') {
        if (options.navigateError) throw options.navigateError;
        if (options.load !== false) emit({ method: 'Page.loadEventFired', sessionId: 'control' });
        if (options.staleLoad) {
          if (options.load !== false) emit({ method: 'Page.lifecycleEvent', sessionId: 'control', params: { name: 'load', loaderId: 'origin-loader' } });
          return { loaderId: 'origin-loader' };
        }
      }
      if (method === 'Target.closeTarget') {
        if (options.closeError) throw options.closeError;
        if (options.deferClose) return closeResponse;
        return { success: true };
      }
      return {};
    },
  }, { beginCreation() { return { commit() {}, fail() {}, rollback() {} }; } });
  return { controller, listeners, calls, emit, resolveClose, prepare: () => prepare({ context: {} as PlaywrightContext, browserContextId: 'owned', origin: 'https://storage.example', signal: controller.signal }) };
}

async function flushControlOperations() {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

test('initial blank-page load cannot complete synthetic origin navigation', async () => {
  const fixture = storageControlFixture({ staleLoad: true, load: false });
  let settled = false;
  const preparation = fixture.prepare().then(lease => { settled = true; return lease; });
  await flushControlOperations();
  assert.equal(settled, false, 'Preparation must wait for the requested navigation loader');
  fixture.emit({ method: 'Page.lifecycleEvent', sessionId: 'control', params: { name: 'load', loaderId: 'origin-loader' } });
  const lease = await preparation;
  const retirement = lease.release();
  fixture.emit({ method: 'Target.targetDestroyed', params: { targetId: 'hidden' } });
  await retirement;
});

test('requested loader may finish before the navigation reply arrives', async () => {
  const fixture = storageControlFixture({ staleLoad: true });
  const lease = await fixture.prepare();
  const retirement = lease.release();
  fixture.emit({ method: 'Target.targetDestroyed', params: { targetId: 'hidden' } });
  await retirement;
});

test('whole-control disconnection rejects pending retirement without claiming target destruction', async () => {
  const fixture = storageControlFixture();
  const lease = await fixture.prepare();
  const retirement = lease.release();
  const result = retirement.then(() => 'destroyed', error => error);
  await flushControlOperations();
  fixture.emit({ method: 'Inspector.detached', params: { reason: 'socket EOF' } });
  await flushControlOperations();
  const outcome = await Promise.race([result, Promise.resolve('pending')]);
  assert.ok(outcome instanceof Error, `Expected rejected retirement, received ${String(outcome)}`);
  assert.equal(outcome.message, 'Native storage control disconnected');
  assert.equal(fixture.listeners.size, 0);
  assert.equal(getEventListeners(fixture.controller.signal, 'abort').length, 0);
  await assert.rejects(lease.release(), error => error === outcome);
  await assert.rejects(lease.cdp.detach(), error => error === outcome);
  await assert.rejects(lease.cdp.send('Runtime.evaluate'), error => error === outcome);
  assert.equal(fixture.calls.filter(method => method === 'Target.closeTarget').length, 1);
  assert.ok(!fixture.calls.includes('Target.detachFromTarget'));
  assert.ok(!fixture.calls.includes('Runtime.evaluate'));
});

test('whole-control disconnection rejects loading and cleanup with preserved error identities', async () => {
  const fixture = storageControlFixture({ load: false });
  const preparation = fixture.prepare();
  const result = preparation.then(() => 'loaded', error => error);
  await flushControlOperations();
  assert.ok(fixture.calls.includes('Page.navigate'));
  fixture.emit({ method: 'Inspector.detached' });
  await flushControlOperations();
  const outcome = await Promise.race([result, Promise.resolve('pending')]);
  assert.ok(outcome instanceof AggregateError, `Expected failed preparation and cleanup, received ${String(outcome)}`);
  assert.equal(outcome.errors.length, 2);
  assert.equal(outcome.errors[0].message, 'Native storage control disconnected');
  assert.equal(outcome.errors[1], outcome.errors[0]);
  assert.equal(fixture.listeners.size, 0);
  assert.ok(!fixture.calls.includes('Target.closeTarget'));
});

test('whole-control disconnection observes removal rejection before close response is awaited', async () => {
  const fixture = storageControlFixture({ deferClose: true });
  const lease = await fixture.prepare();
  const result = lease.release().then(() => 'destroyed', error => error);
  fixture.emit({ method: 'Inspector.detached' });
  await new Promise<void>(resolve => setImmediate(resolve));
  fixture.resolveClose({ success: true });
  await flushControlOperations();
  const outcome = await Promise.race([result, Promise.resolve('pending')]);
  assert.ok(outcome instanceof Error, `Expected rejected retirement, received ${String(outcome)}`);
  assert.equal(outcome.message, 'Native storage control disconnected');
  assert.equal(fixture.listeners.size, 0);
});

test('whole-control disconnection still rejects retirement while a destroyed target close response is pending', async () => {
  const fixture = storageControlFixture({ deferClose: true });
  const lease = await fixture.prepare();
  const retirement = lease.release();
  const result = assert.rejects(retirement, { message: 'Native storage control disconnected' });
  fixture.emit({ method: 'Target.targetDestroyed', params: { targetId: 'hidden' } });
  fixture.emit({ method: 'Inspector.detached' });
  fixture.resolveClose({ success: true });
  await result;
  assert.equal(fixture.listeners.size, 0);
});

test('whole-control disconnection closes subscriptions before later native close calls', async () => {
  const fixture = storageControlFixture();
  const lease = await fixture.prepare();
  fixture.emit({ method: 'Inspector.detached' });
  assert.equal(fixture.listeners.size, 0);
  assert.equal(getEventListeners(fixture.controller.signal, 'abort').length, 0);
  await assert.rejects(lease.release(), { message: 'Native storage control disconnected' });
  await assert.rejects(lease.cdp.detach(), { message: 'Native storage control disconnected' });
  await assert.rejects(lease.cdp.send('Runtime.evaluate'), { message: 'Native storage control disconnected' });
  assert.ok(!fixture.calls.includes('Target.closeTarget'));
  assert.ok(!fixture.calls.includes('Target.detachFromTarget'));
});

test('disconnection during preparation cleanup retains the original navigation failure', async () => {
  const navigateError = new Error('navigation failed');
  const fixture = storageControlFixture({ navigateError });
  const result = fixture.prepare().then(() => 'loaded', error => error);
  await flushControlOperations();
  assert.ok(fixture.calls.includes('Target.closeTarget'));
  fixture.emit({ method: 'Inspector.detached' });
  await flushControlOperations();
  const outcome = await Promise.race([result, Promise.resolve('pending')]);
  assert.ok(outcome instanceof AggregateError, `Expected failed preparation and cleanup, received ${String(outcome)}`);
  assert.equal(outcome.errors[0], navigateError);
  assert.equal(outcome.errors[1].message, 'Native storage control disconnected');
  assert.equal(fixture.listeners.size, 0);
});

test('preparation and close command failures retain both original errors', async () => {
  const navigateError = new Error('navigation failed');
  const closeError = new Error('close command failed');
  const fixture = storageControlFixture({ navigateError, closeError });
  await assert.rejects(fixture.prepare(), error => error instanceof AggregateError && error.errors[0] === navigateError && error.errors[1] === closeError);
  assert.equal(fixture.listeners.size, 0);
});

for (const scopedSession of ['global', 'foreign', 'control']) {
  test(`session-scoped Inspector.detached for ${scopedSession} preserves healthy target retirement`, async () => {
    const fixture = storageControlFixture();
    const lease = await fixture.prepare();
    let settled = false;
    const retirement = lease.release();
    const result = retirement.then(() => { settled = true; }, () => { settled = true; });
    await flushControlOperations();
    fixture.emit({ method: 'Inspector.detached', sessionId: scopedSession });
    await flushControlOperations();
    assert.equal(settled, false);
    assert.equal(fixture.listeners.size, 1);
    fixture.emit({ method: 'Target.targetDestroyed', params: { targetId: 'hidden' } });
    await assert.doesNotReject(retirement);
    await result;
    await lease.cdp.detach();
    assert.equal(fixture.listeners.size, 0);
    assert.ok(!fixture.calls.includes('Target.detachFromTarget'));
  });
}
