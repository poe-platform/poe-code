import assert from 'node:assert/strict';
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
