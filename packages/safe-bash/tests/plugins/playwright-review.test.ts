import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlaywrightController, type PlaywrightAdapter, type PlaywrightLease, type PlaywrightPage } from '../../src/playwright/index.js';

test('capacity preflight remains valid when a closed session is reopened concurrently with a new session', async () => {
  const acquired: string[] = [];
  const page = { goto: async () => {} } as unknown as PlaywrightPage;
  const adapter: PlaywrightAdapter = {
    browsers: { chromium: { headed: false } },
    async acquire(options) {
      acquired.push(options.session);
      return {
        context: { newPage: async () => page, pages: () => [page], close: async () => {}, on() {}, off() {} },
        onClosed: () => () => {},
        release: async () => {},
      } satisfies PlaywrightLease;
    },
  };
  const controller = createPlaywrightController({ adapter, limits: { maxSessions: 1 } });
  const run = (args: string[]) => controller.run({ args, env: {}, signal: new AbortController().signal, write: async () => {} });
  await run(['--session=a', 'open']);
  await run(['--session=a', 'close']);
  const results = await Promise.allSettled([run(['--session=a', 'open']), run(['--session=b', 'open'])]);
  await controller.dispose();
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(acquired.length, 2);
});

test('cancelled reference actions preserve deferred handle disposal failures', async () => {
  const cancellation = new AbortController();
  const cleanupError = new Error('deferred handle disposal failed');
  let startAction!: () => void;
  let releaseAction!: () => void;
  const actionStarted = new Promise<void>(resolve => { startAction = resolve; });
  const actionReleased = new Promise<void>(resolve => { releaseAction = resolve; });
  let disposals = 0;
  const handle = {
    async evaluate(callback: (node: unknown) => unknown) {
      return callback({ isConnected: true, tagName: 'BUTTON', textContent: 'Save', getAttribute: () => null });
    },
    async click() { startAction(); await actionReleased; },
    async dispose() { disposals++; throw cleanupError; },
  };
  const page = {
    goto: async () => {}, on() {}, off() {},
    frames: () => [{ locator: () => ({ elementHandles: async () => [handle] }) }],
  } as unknown as PlaywrightPage;
  const controller = createPlaywrightController({ adapter: {
    browsers: { chromium: { headed: false } },
    async acquire() {
      return {
        context: { newPage: async () => page, pages: () => [page], close: async () => {}, on() {}, off() {} },
        onClosed: () => () => {},
        release: async () => { releaseAction(); },
      } satisfies PlaywrightLease;
    },
  } });
  const run = (args: string[]) => controller.run({ args, env: {}, signal: cancellation.signal, write: async () => {} });
  try {
    await run(['open']);
    await run(['snapshot']);
    const outcome = run(['click', 'e1']).then(() => undefined, error => error);
    await actionStarted;
    cancellation.abort(new Error('cancelled action'));
    const failure = await outcome;
    assert.equal(disposals, 1);
    assert.ok(failure instanceof AggregateError, 'cancellation must not erase deferred disposal failure');
    assert.equal(failure.errors[0], cancellation.signal.reason);
    assert.ok(failure.errors[1] instanceof AggregateError);
    assert.ok(failure.errors[1].errors.includes(cleanupError));
  } finally {
    releaseAction();
    await controller.dispose().catch(() => {});
  }
});
