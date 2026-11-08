import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlaywrightStorageOriginPreparer, type PlaywrightStorageControlEvent } from './playwright/native-storage-targets.js';
import type { PlaywrightContext } from './playwright/adapter.js';

function fixture(options: { metadata?: boolean; load?: boolean; timeoutMs?: number } = {}) {
  const listeners = new Set<(event: PlaywrightStorageControlEvent) => void>();
  const emit = (event: PlaywrightStorageControlEvent) => { for (const listener of listeners) listener(event); };
  const calls: string[] = [];
  const controller = new AbortController();
  let targetUrl = 'about:blank';
  const metadata = (targetId = 'private', browserContextId = 'context', url = 'https://storage.example/') => {
    if (targetId === 'private' && browserContextId === 'context') targetUrl = url;
    emit({ method: 'Target.targetInfoChanged', params: { targetInfo: { targetId, browserContextId, url } } });
  };
  const load = () => emit({ method: 'Page.lifecycleEvent', sessionId: 'session', params: { name: 'load', frameId: 'frame', loaderId: 'requested' } });
  const prepare = createPlaywrightStorageOriginPreparer({
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async send(method) {
      calls.push(method);
      if (method === 'Target.createTarget') return { targetId: 'private' };
      if (method === 'Target.attachToTarget') return { sessionId: 'session' };
      if (method === 'Target.getTargetInfo') return { targetInfo: { targetId: 'private', browserContextId: 'context', url: targetUrl } };
      if (method === 'Page.navigate') {
        if (options.metadata) metadata();
        if (options.load !== false) load();
        return { frameId: 'frame', loaderId: 'requested' };
      }
      if (method === 'Target.closeTarget') { emit({ method: 'Target.targetDestroyed', params: { targetId: 'private' } }); return { success: true }; }
      return {};
    },
  }, { beginCreation() { return { commit() {}, fail() {}, rollback() {} }; } }, options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs });
  return { emit, metadata, load, calls, listeners, controller, prepare: () => prepare({ context: {} as PlaywrightContext, browserContextId: 'context', origin: 'https://storage.example', signal: controller.signal }) };
}

async function flush() {
  for (let turn = 0; turn < 40; turn++) await Promise.resolve();
}

test('storage preparation joins the requested loader and delayed target origin metadata', async () => {
  const control = fixture();
  let settled = false;
  const preparation = control.prepare().then(lease => { settled = true; return lease; });
  await flush();
  try {
    assert.equal(settled, false, 'A completed loader must not expose a target with stale origin metadata');
    control.metadata('foreign');
    control.metadata('private', 'context', 'about:blank');
    await flush();
    assert.equal(settled, false);
    assert.ok(!control.calls.includes('Fetch.disable'));
  } finally {
    control.metadata();
    const lease = await preparation;
    assert.deepEqual(await lease.cdp.send('Target.getTargetInfo'), { targetInfo: { targetId: 'private', browserContextId: 'context', url: 'https://storage.example/' } });
    await lease.release();
  }
  assert.equal(control.listeners.size, 0);
  assert.equal(control.calls.filter(method => method === 'Target.closeTarget').length, 1);
});

test('target metadata arriving before the navigation reply still waits for the requested loader', async () => {
  const control = fixture({ metadata: true, load: false });
  let settled = false;
  const preparation = control.prepare().then(lease => { settled = true; return lease; });
  await flush();
  assert.equal(settled, false);
  control.emit({ method: 'Page.lifecycleEvent', sessionId: 'session', params: { name: 'load', loaderId: 'blank-loader' } });
  await flush();
  assert.equal(settled, false);
  control.load();
  const lease = await preparation;
  await lease.release();
  assert.equal(control.listeners.size, 0);
});

test('target metadata for the owned target rejects a changed browser context', async () => {
  const control = fixture();
  const preparation = control.prepare();
  const outcome = assert.rejects(preparation, { message: 'Native storage target identity mismatch' });
  await flush();
  control.metadata('private', 'foreign');
  await outcome;
  assert.equal(control.listeners.size, 0);
  assert.equal(control.calls.filter(method => method === 'Target.closeTarget').length, 1);
});

test('abort while awaiting target metadata retires the private target', async () => {
  const control = fixture();
  const preparation = control.prepare();
  const outcome = assert.rejects(preparation, { message: 'cancelled' });
  await flush();
  control.controller.abort(new Error('cancelled'));
  await outcome;
  assert.equal(control.listeners.size, 0);
  assert.equal(control.calls.filter(method => method === 'Target.closeTarget').length, 1);
});

test('control disconnection while awaiting target metadata cannot report successful cleanup', async () => {
  const control = fixture();
  const outcome = assert.rejects(control.prepare(), error => error instanceof AggregateError && error.errors.every(cause => cause.message === 'Native storage control disconnected'));
  await flush();
  control.emit({ method: 'Inspector.detached' });
  await outcome;
  assert.equal(control.listeners.size, 0);
  assert.ok(!control.calls.includes('Target.closeTarget'));
});

test('metadata readiness shares the existing navigation deadline', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const control = fixture({ timeoutMs: 100 });
  const outcome = assert.rejects(control.prepare(), error => error instanceof Error && error.cause instanceof Error && error.cause.message === 'Native storage navigation load timed out');
  await flush();
  context.mock.timers.tick(100);
  await outcome;
  assert.equal(control.listeners.size, 0);
  assert.equal(control.calls.filter(method => method === 'Target.closeTarget').length, 1);
});

test('unexpected target origin metadata remains a fatal validation failure', async () => {
  const control = fixture();
  const outcome = assert.rejects(control.prepare(), { message: 'Native storage target origin mismatch' });
  await flush();
  control.metadata('private', 'context', 'https://foreign.example/');
  await outcome;
  assert.equal(control.listeners.size, 0);
  assert.equal(control.calls.filter(method => method === 'Target.closeTarget').length, 1);
});
