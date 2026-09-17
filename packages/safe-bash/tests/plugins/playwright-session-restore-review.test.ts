import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createPlaywrightCli, createPlaywrightController } from '../../src/commands/playwright/index.js';
import type { PlaywrightAdapter, PlaywrightContext, PlaywrightElementHandle, PlaywrightLease, PlaywrightPage } from '../../src/playwright/index.js';
import { Shell } from '../../src/shell/index.js';
import { MemoryFileSystem } from '../../src/fs/memory/index.js';
import { createSnapshotFrame } from '../helpers/playwright-snapshot.js';

function deferred<Value = void>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(complete => { resolve = complete; });
  return { promise, resolve };
}

function browser() {
  const contextEvents = new EventEmitter();
  const pageEvents = new EventEmitter();
  const closedListeners = new Set<() => void>();
  const closedHistory: (() => void)[] = [];
  const calls = { releases: 0, acquisitions: 0, newPages: 0, contextCloses: 0, clicks: 0 };
  const node = { isConnected: true, tagName: 'BUTTON', textContent: 'Save', getAttribute: () => null };
  const native: PlaywrightElementHandle = {
    async click() { calls.clicks++; }, async fill() {}, async dispose() {},
    async evaluate(callback) { return callback(node); },
  };
  const snapshot = createSnapshotFrame([{ node, native }]);
  const pages: PlaywrightPage[] = [];
  const page = Object.assign(pageEvents, {
    async goto() {}, url: () => 'https://example.test/retained',
    frames: () => [snapshot.frame],
    locator: () => ({ async click() {}, async fill() {}, async ariaSnapshot() { return ''; } }),
    keyboard: { async press() {} }, async screenshot() { return new Uint8Array(); },
    async close() { pages.splice(pages.indexOf(page), 1); pageEvents.emit('close'); },
  }) satisfies PlaywrightPage;
  pages.push(page);
  const context = Object.assign(contextEvents, {
    async newPage(): Promise<PlaywrightPage> { calls.newPages++; throw new Error('restore must not create a page'); },
    pages: () => [...pages], async close() { calls.contextCloses++; },
  }) satisfies PlaywrightContext;
  const lease: PlaywrightLease = {
    context,
    onClosed(listener) {
      closedListeners.add(listener);
      closedHistory.push(listener);
      return () => { closedListeners.delete(listener); };
    },
    async release() { calls.releases++; },
  };
  const adapter: PlaywrightAdapter = {
    browsers: { chromium: { headed: false } },
    async acquire() { calls.acquisitions++; throw new Error('restore must not acquire a new browser'); },
  };
  return { adapter, lease, context, page, pages, pageEvents, contextEvents, closedListeners, closedHistory, calls, snapshot };
}

async function run(controller: ReturnType<typeof createPlaywrightController>, args: string[]) {
  let output = '';
  await controller.run({ args, env: {}, signal: new AbortController().signal, write: async text => { output += text; } });
  return output;
}

test('dispose drains late restore acquisition and lease cleanup without exposing a checkpoint', async () => {
  const host = browser();
  const entered = deferred();
  const deliver = deferred();
  const cleanupEntered = deferred();
  const cleanupRelease = deferred();
  const controller = createPlaywrightController({ adapter: host.adapter });
  let acquisitionSignal: AbortSignal | undefined;
  const restore = controller.restoreSession({ name: 'owned', async acquire({ signal }) {
    acquisitionSignal = signal;
    entered.resolve();
    await deliver.promise;
    return { lease: { ...host.lease, async release() {
      cleanupEntered.resolve();
      await cleanupRelease.promise;
      await host.lease.release();
    } }, selectedPage: host.page };
  } });
  const restored = Promise.allSettled([restore]);
  await entered.promise;
  const disposal = controller.dispose();
  let disposed = false;
  void disposal.then(() => { disposed = true; }, () => { disposed = true; });
  try {
    assert.equal(controller.dispose(), disposal);
    assert.equal(acquisitionSignal!.aborted, true);
    assert.deepEqual(controller.inspectSessions(), []);
    deliver.resolve();
    await cleanupEntered.promise;
    await nextTurn();
    assert.equal(disposed, false, 'dispose must wait for the late lease to retire');
    await assert.rejects(controller.restoreSession({ name: 'later', async acquire() {
      assert.fail('disposed controller must not acquire');
    } }), /disposed/);
  } finally { deliver.resolve(); cleanupRelease.resolve(); await Promise.all([restored, disposal]); }
  assert.deepEqual(await restored, [{ status: 'rejected', reason: acquisitionSignal!.reason }]);
  assert.deepEqual(host.calls, { releases: 1, acquisitions: 0, newPages: 0, contextCloses: 0, clicks: 0 });
});

test('restore cancellation keeps the falsey reason when the acquisition rejects late', async () => {
  const controller = createPlaywrightController();
  const abort = new AbortController();
  const entered = deferred();
  const release = deferred();
  const restored = Promise.allSettled([controller.restoreSession({ name: 'owned', signal: abort.signal,
    async acquire() { entered.resolve(); await release.promise; throw new Error('late reconnect failure'); },
  })]);
  try {
    await entered.promise;
    abort.abort(false);
    release.resolve();
    assert.deepEqual(await restored, [{ status: 'rejected', reason: false }]);
    assert.deepEqual(controller.inspectSessions(), []);
  } finally { release.resolve(); await restored; await controller.dispose(); }
});

test('cancelled restore preserves both cancellation and late lease cleanup failure', async () => {
  const host = browser();
  const controller = createPlaywrightController({ adapter: host.adapter });
  const abort = new AbortController();
  const cleanupFailure = new Error('lease release failed');
  try {
    const [result] = await Promise.allSettled([controller.restoreSession({ name: 'owned', signal: abort.signal,
      async acquire() {
        abort.abort(0);
        return { lease: { ...host.lease, async release() { await host.lease.release(); throw cleanupFailure; } } };
      },
    })]);
    assert.equal(result!.status, 'rejected');
    if (result!.status === 'rejected') {
      assert.ok(result!.reason instanceof AggregateError);
      assert.deepEqual(result!.reason.errors, [0, cleanupFailure]);
    }
    assert.equal(host.calls.releases, 1);
    assert.deepEqual(controller.inspectSessions(), []);
  } finally { await Promise.allSettled([controller.dispose()]); }
});

test('pending restore owns capacity and cancelled same-name queue entries never acquire', async () => {
  const host = browser();
  const entered = deferred();
  const release = deferred();
  const abort = new AbortController();
  const controller = createPlaywrightController({ adapter: host.adapter, limits: { maxSessions: 1 } });
  const first = controller.restoreSession({ name: 'owned', async acquire() {
    entered.resolve(); await release.promise; return { lease: host.lease, selectedPage: host.page };
  } });
  await entered.promise;
  const queued = Promise.allSettled([controller.restoreSession({ name: 'owned', signal: abort.signal,
    async acquire() { assert.fail('cancelled queued restore must not acquire'); },
  })]);
  try {
    await assert.rejects(controller.restoreSession({ name: 'other', async acquire() {
      assert.fail('capacity rejection must precede acquisition');
    } }), /capacity/);
    abort.abort(0);
    release.resolve();
    await first;
    assert.deepEqual(await queued, [{ status: 'rejected', reason: 0 }]);
    assert.equal(controller.inspectSessions()[0]!.name, 'owned');
    assert.equal(host.calls.releases, 0);
  } finally { release.resolve(); await Promise.allSettled([first, queued]); await controller.dispose(); }
});

test('expiry during reconnect retires the delivered lease and restores capacity', async context => {
  const host = browser();
  let now = 1000;
  context.mock.method(Date, 'now', () => now);
  const controller = createPlaywrightController({ adapter: host.adapter, limits: { maxSessions: 1 } });
  try {
    await assert.rejects(controller.restoreSession({ name: 'expired', expiresAt: 1001, async acquire() {
      now = 1001;
      return { lease: host.lease, selectedPage: host.page };
    } }), /expired/);
    assert.equal(host.calls.releases, 1);
    assert.deepEqual(controller.inspectSessions(), []);
    const next = browser();
    await controller.restoreSession({ name: 'next', async acquire() { return { lease: next.lease }; } });
    assert.equal(controller.inspectSessions()[0]!.name, 'next');
  } finally { await controller.dispose(); }
});

test('expired session cleanup completes before replacement acquisition is admitted', async context => {
  const host = browser();
  let now = 1000;
  context.mock.method(Date, 'now', () => now);
  const entered = deferred();
  const release = deferred();
  const controller = createPlaywrightController({ adapter: host.adapter, limits: { maxSessions: 1 } });
  await controller.restoreSession({ name: 'old', expiresAt: 1001, async acquire() { return {
    lease: { ...host.lease, async release() { entered.resolve(); await release.promise; await host.lease.release(); } },
  }; } });
  now = 1001;
  assert.deepEqual(controller.inspectSessions(), []);
  const next = browser();
  let acquisitions = 0;
  const restoring = controller.restoreSession({ name: 'next', async acquire() { acquisitions++; return { lease: next.lease }; } });
  try {
    await entered.promise;
    await nextTurn();
    assert.equal(acquisitions, 0);
  } finally { release.resolve(); await restoring; await controller.dispose(); }
  assert.equal(host.calls.releases, 1);
  assert.equal(next.calls.releases, 1);
});

test('restore rejects a lease without release rather than publishing an unretirable checkpoint', async () => {
  const host = browser();
  const controller = createPlaywrightController({ adapter: host.adapter });
  const { release: ignoredRelease, ...invalid } = host.lease;
  try {
    await assert.rejects(controller.restoreSession({ name: 'invalid', async acquire() {
      return { lease: invalid as PlaywrightLease, selectedPage: host.page };
    } }));
    assert.deepEqual(controller.inspectSessions(), []);
  } finally { await Promise.allSettled([controller.dispose()]); }
});

test('selected page disappearing during restore cannot be accepted from a stale pages snapshot', async context => {
  const host = browser();
  const controller = createPlaywrightController({ adapter: host.adapter });
  context.mock.method(host.context, 'pages', () => {
    const captured = [...host.pages];
    queueMicrotask(() => { host.pages.length = 0; host.pageEvents.emit('close'); });
    return captured;
  });
  try {
    await assert.rejects(controller.restoreSession({ name: 'owned', async acquire() {
      return { lease: host.lease, selectedPage: host.page };
    } }));
    assert.equal(host.calls.releases, 1);
    assert.deepEqual(controller.inspectSessions(), []);
  } finally { await controller.dispose(); }
});

test('restored session page-detachment error must not skip owned lease release', async context => {
  const host = browser();
  const controller = createPlaywrightController({ adapter: host.adapter });
  await controller.restoreSession({ name: 'owned', async acquire() { return { lease: host.lease, selectedPage: host.page }; } });
  const failure = new Error('page listener detachment failed');
  context.mock.method(host.page, 'off', () => { throw failure; });
  const [disposal] = await Promise.allSettled([controller.dispose()]);
  assert.equal(disposal!.status, 'rejected');
  assert.equal(host.calls.releases, 1, 'other cleanup must run even when page.off throws');
  assert.equal(host.closedListeners.size, 0);
  assert.deepEqual(controller.inspectSessions(), []);
});

test('synchronous loss notification during restore retires exactly once and never publishes', async () => {
  const host = browser();
  const controller = createPlaywrightController({ adapter: host.adapter });
  try {
    await assert.rejects(controller.restoreSession({ name: 'owned', async acquire() { return {
      lease: { ...host.lease, onClosed(listener) {
        const unsubscribe = host.lease.onClosed(listener);
        listener();
        return unsubscribe;
      } }, selectedPage: host.page,
    }; } }), /closed/);
    assert.equal(host.calls.releases, 1);
    assert.equal(host.closedListeners.size, 0);
    assert.deepEqual(controller.inspectSessions(), []);
  } finally { await controller.dispose(); }
  assert.equal(host.calls.releases, 1);
});

test('restored tab overflow rejects before checkpointing and removes its loss listeners', async () => {
  const host = browser();
  host.pages.push(browser().page);
  const controller = createPlaywrightController({ adapter: host.adapter, limits: { maxTabs: 1 } });
  try {
    await assert.rejects(controller.restoreSession({ name: 'owned', async acquire() { return { lease: host.lease }; } }), /tab limit/);
    assert.deepEqual(controller.inspectSessions(), []);
    assert.equal(host.calls.releases, 1);
    assert.equal(host.contextEvents.listenerCount('page'), 0);
    assert.equal(host.closedListeners.size, 0);
  } finally { await controller.dispose(); }
});

test('same-name restoration after loss rejects old refs and ignores the old lease callback', async () => {
  const old = browser();
  const next = browser();
  const controller = createPlaywrightController({ adapter: old.adapter });
  try {
    await controller.restoreSession({ name: 'owned', async acquire() { return { lease: old.lease, selectedPage: old.page }; } });
    const snapshot = await run(controller, ['-s=owned', 'snapshot']);
    const reference = snapshot.split('[ref=')[1]?.split(']')[0];
    assert.ok(reference);
    old.closedHistory[0]!();
    await nextTurn();
    assert.equal(old.calls.releases, 1);
    await controller.restoreSession({ name: 'owned', async acquire() { return { lease: next.lease, selectedPage: next.page }; } });
    await run(controller, ['-s=owned', 'snapshot']);
    old.closedHistory[0]!();
    await assert.rejects(run(controller, ['-s=owned', 'click', reference]), /stale snapshot ref/);
    assert.equal(next.calls.clicks, 0);
    assert.equal(next.calls.releases, 0);
    assert.equal(controller.inspectSessions()[0]!.context, next.context);
    assert.equal(old.snapshot.disposedCapsules.length, old.snapshot.capsules.length);
  } finally { await controller.dispose(); }
});

test('checkpoint inspection does not retain a selected page after its close event', async () => {
  const host = browser();
  const controller = createPlaywrightController({ adapter: host.adapter });
  try {
    await controller.restoreSession({ name: 'owned', async acquire() { return { lease: host.lease, selectedPage: host.page }; } });
    const previous = controller.inspectSessions()[0]!;
    await host.page.close();
    assert.equal(previous.selectedPage, host.page, 'already issued checkpoints remain immutable snapshots');
    assert.equal(controller.inspectSessions()[0]!.selectedPage, undefined, 'new checkpoints must not select a closed tab');
    assert.equal(host.calls.releases, 0, 'page loss must not terminate its still-owned context');
  } finally { await controller.dispose(); }
});

test('CLI checkpoints remain host-only and guest commands cannot request restoration metadata', async () => {
  const host = browser();
  const secret = 'host-provider-private-token';
  Object.assign(host.context, { providerToken: secret });
  const cli = createPlaywrightCli({ adapter: host.adapter });
  const shell = new Shell({ fs: new MemoryFileSystem() });
  shell.use(cli.plugin);
  try {
    await cli.restoreSession({ name: 'owned', expiresAt: Date.now() + 60_000, async acquire() {
      return { lease: host.lease, selectedPage: host.page };
    } });
    const checkpoints = cli.inspectSessions();
    assert.ok(Object.isFrozen(checkpoints));
    assert.ok(Object.isFrozen(checkpoints[0]));
    assert.deepEqual(Object.keys(checkpoints[0]!).sort(), ['context', 'expiresAt', 'name', 'selectedPage']);
    const output = await shell.exec('playwright-cli list');
    assert.equal(output.exitCode, 0);
    assert.equal(output.stdout, 'owned\topen\n');
    for (const command of ['restore-session', 'inspect-sessions']) {
      const refused = await shell.exec(`playwright-cli ${command}`);
      assert.equal(refused.exitCode, 1);
      assert.ok(!`${refused.stdout}${refused.stderr}`.includes(secret));
    }
    const help = await shell.exec('playwright-cli --help');
    assert.ok(!help.stdout.includes(secret));
    assert.ok(!help.stdout.includes('restoreSession'));
    assert.equal(host.calls.acquisitions, 0);
    assert.equal(host.calls.newPages, 0);
  } finally { await shell.dispose(); }
  assert.equal(host.calls.releases, 1);
});

test('expired-session cleanup failure does not settle restoration before sibling lease cleanup finishes', async context => {
  const failed = browser();
  const delayed = browser();
  const cleanupFailure = new Error('first expired lease cleanup failed');
  const cleanupEntered = deferred();
  const cleanupRelease = deferred();
  let now = 1000;
  context.mock.method(Date, 'now', () => now);
  const controller = createPlaywrightController({ adapter: failed.adapter, limits: { maxSessions: 2 } });
  await controller.restoreSession({ name: 'failed', expiresAt: 1001, async acquire() { return {
    lease: { ...failed.lease, async release() { await failed.lease.release(); throw cleanupFailure; } },
  }; } });
  await controller.restoreSession({ name: 'delayed', expiresAt: 1001, async acquire() { return {
    lease: { ...delayed.lease, async release() {
      cleanupEntered.resolve();
      await cleanupRelease.promise;
      await delayed.lease.release();
    } },
  }; } });
  now = 1001;
  let acquisitions = 0;
  let settled = false;
  const result = Promise.allSettled([controller.restoreSession({ name: 'next', async acquire() {
    acquisitions++;
    assert.fail('failed expiry cleanup must not admit another lease');
  } })]);
  void result.then(() => { settled = true; });
  try {
    await cleanupEntered.promise;
    await nextTurn();
    assert.equal(failed.calls.releases, 1);
    assert.equal(delayed.calls.releases, 0);
    assert.equal(acquisitions, 0);
    assert.equal(settled, false, 'restoration must drain every admitted expired lease before reporting cleanup failure');
  } finally {
    cleanupRelease.resolve();
    await result;
    await Promise.allSettled([controller.dispose()]);
  }
  const [outcome] = await result;
  assert.equal(outcome!.status, 'rejected');
  if (outcome!.status === 'rejected') {
    assert.ok(outcome!.reason === cleanupFailure
      || outcome!.reason instanceof AggregateError && outcome!.reason.errors.includes(cleanupFailure));
  }
  assert.equal(failed.calls.releases, 1);
  assert.equal(delayed.calls.releases, 1);
  assert.equal(acquisitions, 0);
});
