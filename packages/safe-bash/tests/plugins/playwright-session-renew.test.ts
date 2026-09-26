import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createPlaywrightCli, createPlaywrightController } from '../../src/commands/playwright/index.js';
import type { PlaywrightContext, PlaywrightLease, PlaywrightPage } from '../../src/playwright/index.js';
import { createSnapshotFrame } from '../helpers/playwright-snapshot.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function browser() {
  const events = new EventEmitter();
  const closed = new Set<() => void>();
  const calls: string[] = [];
  const snapshot = createSnapshotFrame([]);
  const page = {
    async goto() { calls.push('goto'); }, url: () => 'about:blank',
    async title() { return ''; }, frames: () => [snapshot.frame],
    keyboard: { async press() { calls.push('press'); } }, on() {}, off() {},
  } as unknown as PlaywrightPage;
  const pages = [page];
  const context: PlaywrightContext = {
    pages() { calls.push('pages'); return pages; },
    async newPage() { calls.push('newPage'); return page; },
    async close() { calls.push('close'); },
    on: events.on.bind(events), off: events.off.bind(events),
  };
  const lease: PlaywrightLease = {
    context,
    onClosed(listener) { closed.add(listener); return () => { closed.delete(listener); }; },
    async release() { calls.push('release'); },
  };
  return { context, lease, page, pages, events, calls,
    close() { for (const listener of closed) listener(); },
  };
}

function fixture() {
  const native = browser();
  const effects: string[] = [];
  const controller = createPlaywrightController({
    adapter: { browsers: { chromium: { headed: false } }, async acquire() { effects.push('acquire'); return native.lease; } },
    persistence: {
      async list() { effects.push('list'); return [{ name: 'saved' }]; },
      async restore() { effects.push('restore'); return { lease: native.lease }; },
      async checkpoint() { effects.push('checkpoint'); }, async delete() { effects.push('delete'); },
    },
  });
  const run = (args: string[]) => controller.run({ args, env: {}, signal: new AbortController().signal,
    async write() {}, async writeArtifact() {},
  });
  return { native, controller, effects, run };
}

async function adopt(host: Pick<ReturnType<typeof createPlaywrightController>, 'restoreSession'>, native: ReturnType<typeof browser>,
  policy: { expiresAt?: number; idleTimeoutMs?: number } = { expiresAt: 1100, idleTimeoutMs: 100 }) {
  await host.restoreSession({ name: 'owned', ...policy,
    async acquire() { return { lease: native.lease, selectedPage: native.page }; },
  });
}

test('host renewal is synchronous, matches the exact context, and only updates idle metadata', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const f = fixture();
  try {
    await adopt(f.controller, f.native);
    const [before] = f.controller.inspectSessions();
    const calls = [...f.native.calls];
    t.mock.timers.setTime(1090);
    assert.equal(f.controller.renewSession({ name: 'owned', context: { ...f.native.context } }), false);
    assert.equal(f.controller.inspectSessions()[0]?.expiresAt, 1100);
    assert.equal(f.controller.renewSession({ name: 'owned', context: f.native.context }), true);
    assert.equal(f.controller.inspectSessions()[0]?.expiresAt, 1190);
    assert.equal(before?.expiresAt, 1100, 'previous inspection remains an immutable snapshot');
    assert.deepEqual(f.native.calls, calls, 'renewal must not call the browser');
    assert.deepEqual(f.effects, [], 'renewal must not allocate, restore, or checkpoint');
  } finally { await f.controller.dispose(); }
});

test('missing and cold saved sessions cannot be restored or allocated by renewal', async () => {
  const f = fixture();
  try {
    for (const name of ['missing', 'saved']) assert.equal(f.controller.renewSession({ name, context: f.native.context }), false);
    assert.deepEqual(f.controller.inspectSessions(), []);
    assert.deepEqual(f.native.calls, []);
    assert.deepEqual(f.effects, []);
  } finally { await f.controller.dispose(); }
});

test('a session still being acquired cannot be renewed', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const f = fixture();
  const entered = deferred();
  const resume = deferred();
  const restoring = f.controller.restoreSession({ name: 'owned', expiresAt: 1100, idleTimeoutMs: 100,
    async acquire() { entered.resolve(); await resume.promise; return { lease: f.native.lease }; },
  });
  try {
    await entered.promise;
    assert.equal(f.controller.renewSession({ name: 'owned', context: f.native.context }), false);
    assert.deepEqual(f.controller.inspectSessions(), []);
  } finally { resume.resolve(); await restoring; await f.controller.dispose(); }
});

for (const now of [1100, 1101]) test(`renewal cannot revive an elapsed deadline at ${now}`, async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const f = fixture();
  try {
    await adopt(f.controller, f.native);
    t.mock.timers.setTime(now);
    const calls = [...f.native.calls];
    assert.equal(f.controller.renewSession({ name: 'owned', context: f.native.context }), false);
    assert.deepEqual(f.controller.inspectSessions(), []);
    assert.deepEqual(f.native.calls, calls);
    assert.deepEqual(f.effects, []);
  } finally { await f.controller.dispose(); }
});

test('repeated renewal replaces the expiry timer and the session expires when renewal stops', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const f = fixture();
  try {
    await adopt(f.controller, f.native);
    for (const expiresAt of [1180, 1260]) {
      t.mock.timers.tick(80);
      await setImmediate();
      assert.equal(f.controller.renewSession({ name: 'owned', context: f.native.context }), true);
      assert.equal(f.controller.inspectSessions()[0]?.expiresAt, expiresAt);
    }
    t.mock.timers.tick(99);
    await setImmediate();
    assert.equal(f.native.calls.includes('release'), false);
    t.mock.timers.tick(1);
    await setImmediate();
    assert.deepEqual(f.controller.inspectSessions(), []);
    assert.equal(f.native.calls.filter(call => call === 'release').length, 1);
    assert.equal(f.controller.renewSession({ name: 'owned', context: f.native.context }), false);
    assert.deepEqual(f.effects, []);
  } finally { await f.controller.dispose(); }
});

test('closing and closed sessions cannot be renewed, including after same-alias replacement', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const f = fixture();
  const closing = deferred();
  const released = deferred();
  f.native.lease.release = async () => { closing.resolve(); await released.promise; };
  try {
    await adopt(f.controller, f.native);
    f.native.close();
    await closing.promise;
    assert.equal(f.controller.renewSession({ name: 'owned', context: f.native.context }), false);
    released.resolve();
    await setImmediate();
    assert.equal(f.controller.renewSession({ name: 'owned', context: f.native.context }), false);
    const replacement = browser();
    await adopt(f.controller, replacement);
    t.mock.timers.setTime(1090);
    assert.equal(f.controller.renewSession({ name: 'owned', context: f.native.context }), false);
    assert.equal(f.controller.inspectSessions()[0]?.expiresAt, 1100);
    assert.equal(f.controller.renewSession({ name: 'owned', context: replacement.context }), true);
    assert.equal(f.controller.inspectSessions()[0]?.expiresAt, 1190);
  } finally { released.resolve(); await f.controller.dispose(); }
});

test('disposal prevents renewal synchronously before asynchronous release starts', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const f = fixture();
  await adopt(f.controller, f.native);
  const disposal = f.controller.dispose();
  assert.equal(f.controller.renewSession({ name: 'owned', context: f.native.context }), false);
  await disposal;
  assert.equal(f.controller.renewSession({ name: 'owned', context: f.native.context }), false);
});

test('failed page initialization cannot be renewed while the context is still retained', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const native = browser();
  let failed = false;
  const lease: PlaywrightLease = { ...native.lease, async executeCode() { if (failed) throw new Error('initializer failed'); } };
  const controller = createPlaywrightController();
  try {
    await controller.restoreSession({ name: 'owned', expiresAt: 1100, idleTimeoutMs: 100,
      configuration: { initPages: [{ filename: 'init.js', source: 'export default () => {}' }] },
      async acquire() { return { lease, selectedPage: native.page }; },
    });
    failed = true;
    const popup = { ...native.page };
    native.pages.push(popup);
    native.events.emit('page', popup);
    await setImmediate();
    assert.equal(controller.renewSession({ name: 'owned', context: native.context }), false);
    assert.equal(native.calls.includes('release'), false, 'failure exists before retirement');
  } finally { await controller.dispose(); }
});

test('renewal and inspection preserve paused idle expiry until native command completion', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const f = fixture();
  const entered = deferred();
  const resume = deferred();
  let running: Promise<void> | undefined;
  try {
    await adopt(f.controller, f.native);
    f.native.page.keyboard.press = async () => { entered.resolve(); await resume.promise; };
    running = f.run(['-s=owned', 'press', 'Enter']);
    await entered.promise;
    t.mock.timers.tick(200);
    const timers = t.mock.method(globalThis, 'setTimeout');
    assert.equal(f.controller.inspectSessions()[0]?.context, f.native.context);
    assert.equal(f.controller.renewSession({ name: 'owned', context: f.native.context }), true);
    assert.equal(f.controller.inspectSessions()[0]?.expiresAt, 1300);
    assert.equal(timers.mock.callCount(), 0, 'renewal must not arm idle expiry during native work');
    t.mock.timers.tick(200);
    await setImmediate();
    assert.equal(f.controller.inspectSessions()[0]?.context, f.native.context);
    assert.equal(f.native.calls.includes('release'), false);
    resume.resolve();
    await running;
    assert.equal(f.controller.inspectSessions()[0]?.expiresAt, 1500, 'completion establishes the final idle deadline');
    t.mock.timers.tick(100);
    await setImmediate();
    assert.deepEqual(f.controller.inspectSessions(), []);
    assert.equal(f.native.calls.filter(call => call === 'release').length, 1);
  } finally { resume.resolve(); await running; await f.controller.dispose(); }
});

for (const idleTimeoutMs of [undefined, 0]) test(`renewal preserves disabled idle expiry (${idleTimeoutMs})`, async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const native = browser();
  const cli = createPlaywrightCli();
  try {
    await adopt(cli, native, idleTimeoutMs === undefined ? {} : { idleTimeoutMs });
    assert.equal(cli.renewSession({ name: 'owned', context: native.context }), true);
    assert.equal(cli.inspectSessions()[0]?.expiresAt, undefined);
  } finally { await cli.dispose(); }
});

test('CLI exposes the same synchronous exact-context renewal host API', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const native = browser();
  const cli = createPlaywrightCli();
  try {
    await adopt(cli, native);
    t.mock.timers.setTime(1090);
    assert.equal(cli.renewSession({ name: 'owned', context: browser().context }), false);
    assert.equal(cli.renewSession({ name: 'owned', context: native.context }), true);
    assert.equal(cli.inspectSessions()[0]?.expiresAt, 1190);
    await cli.dispose();
    assert.equal(cli.renewSession({ name: 'owned', context: native.context }), false);
  } finally { await cli.dispose(); }
});
