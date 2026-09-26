import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createPlaywrightCli, createPlaywrightController } from '../../src/commands/playwright/index.js';
import { PlaywrightCheckpointError, PlaywrightStorageReadError } from '../../src/playwright/checkpoint.js';
import type { PlaywrightContext, PlaywrightLease, PlaywrightPage, PlaywrightSessionCheckpoint } from '../../src/playwright/index.js';
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
  const pages: PlaywrightPage[] = [];
  const tabs = ['first', 'second', 'third'].map(name => {
    const node = { isConnected: true, tagName: 'BUTTON', textContent: name, getAttribute: () => null };
    const snapshot = createSnapshotFrame([{ node, native: {
      async evaluate<T, A>(callback: (element: typeof node, argument: A) => T, argument?: A) { return callback(node, argument!); },
      async click() { calls.push(`${name}:click`); }, async fill() {}, async dispose() {},
    } }]);
    const pageEvents = new EventEmitter();
    const page = Object.assign(pageEvents, {
      async goto() {}, url: () => `https://example.test/${name}`, async title() { return name; },
      frames: () => [snapshot.frame], mainFrame: () => snapshot.frame,
      keyboard: { async press() { calls.push(`${name}:press`); } },
      async close() { pages.splice(pages.indexOf(page), 1); pageEvents.emit('close'); },
    }) as unknown as PlaywrightPage;
    pages.push(page);
    return { page, events: pageEvents, snapshot };
  });
  const context: PlaywrightContext = {
    pages: () => [...pages],
    async newPage() { calls.push('newPage'); throw new Error('Unexpected page allocation'); },
    async close() { calls.push('close'); }, on: events.on.bind(events), off: events.off.bind(events),
  };
  const lease: PlaywrightLease = {
    context, onClosed(listener) { closed.add(listener); return () => { closed.delete(listener); }; },
    async release() { calls.push('release'); for (const listener of closed) listener(); },
  };
  return { context, lease, pages, tabs, calls };
}

function fixture() {
  const native = browser();
  const effects: string[] = [];
  const checkpoints: PlaywrightSessionCheckpoint[] = [];
  const controller = createPlaywrightController({
    adapter: { browsers: { chromium: { headed: false } }, async acquire() { effects.push('acquire'); throw new Error('Unexpected allocation'); } },
    persistence: {
      async restore() { effects.push('restore'); return undefined; },
      async checkpoint(session) { effects.push('checkpoint'); checkpoints.push(session); }, async delete() {},
    },
  });
  assert.equal(typeof controller.selectSessionPage, 'function');
  const run = async (args: string[]) => {
    let output = '';
    await controller.run({ args: ['-s=owned', ...args], env: {}, signal: new AbortController().signal,
      async write(text) { output += text; }, async writeArtifact() {},
    });
    return output;
  };
  return { native, controller, effects, checkpoints, run };
}

async function adopt(host: Pick<ReturnType<typeof createPlaywrightController>, 'restoreSession'>, native: ReturnType<typeof browser>,
  policy: { expiresAt?: number; idleTimeoutMs?: number } = {}) {
  await host.restoreSession({ name: 'owned', ...policy,
    async acquire() { return { lease: native.lease, selectedPage: native.pages[0]! }; },
  });
}

async function holdCommand(f: ReturnType<typeof fixture>, complete: () => void = () => {}) {
  const entered = deferred();
  const resume = deferred();
  f.native.pages[0]!.keyboard.press = async () => { entered.resolve(); await resume.promise; complete(); };
  const running = f.run(['press', 'Enter']);
  await entered.promise;
  return { resume: resume.resolve, running };
}

test('host selection shares the agent page, invalidates old refs, and checkpoints the selected identity', async () => {
  const f = fixture();
  try {
    await adopt(f.controller, f.native);
    const output = await f.run(['snapshot']);
    const ref = output.match(/ref=(e\d+)/)![1]!;
    const previous = f.controller.inspectSessions()[0]!;
    const page = f.native.pages[1]!;
    assert.equal(await f.controller.selectSessionPage({ name: 'owned', context: f.native.context, page }), true);
    assert.equal(f.controller.inspectSessions()[0]?.selectedPage, page);
    assert.equal(previous.selectedPage, f.native.pages[0]);
    assert.equal(f.checkpoints.at(-1)?.selectedPage, page);
    assert.equal(f.native.tabs[0]!.snapshot.disposedCapsules.length, 1);
    await f.run(['press', 'Enter']);
    assert.deepEqual(f.native.calls, ['second:press']);
    await assert.rejects(f.run(['click', ref]), /not found|stale/i);
    assert.equal(f.native.calls.includes('first:click'), false);
    assert.equal(f.effects.includes('acquire') || f.effects.includes('restore'), false);
  } finally { await f.controller.dispose(); }
});

test('unknown, foreign, and already closed page identities leave selection and persistence unchanged', async () => {
  const f = fixture();
  try {
    await adopt(f.controller, f.native);
    const foreign = browser();
    const page = f.native.pages[1]!;
    const requests = [
      { name: 'missing', context: f.native.context, page },
      { name: 'saved', context: f.native.context, page },
      { name: 'owned', context: foreign.context, page },
      { name: 'owned', context: f.native.context, page: foreign.pages[0]! },
    ];
    await page.close();
    requests.push({ name: 'owned', context: f.native.context, page });
    for (const request of requests) assert.equal(await f.controller.selectSessionPage(request), false);
    assert.equal(f.controller.inspectSessions()[0]?.selectedPage, f.native.pages[0]);
    assert.deepEqual(f.effects, []);
    assert.deepEqual(f.native.calls, []);
  } finally { await f.controller.dispose(); }
});

test('selection does not wait for acquisition to publish a session that was not live at invocation', async () => {
  const f = fixture();
  const entered = deferred();
  const resume = deferred();
  const restoring = f.controller.restoreSession({ name: 'owned', async acquire() {
    entered.resolve(); await resume.promise; return { lease: f.native.lease, selectedPage: f.native.pages[0]! };
  } });
  try {
    await entered.promise;
    const selecting = f.controller.selectSessionPage({ name: 'owned', context: f.native.context, page: f.native.pages[1]! });
    resume.resolve();
    assert.equal(await selecting, false);
    await restoring;
    assert.equal(f.controller.inspectSessions()[0]?.selectedPage, f.native.pages[0]);
    assert.deepEqual(f.effects, []);
  } finally { resume.resolve(); await restoring; await f.controller.dispose(); }
});

for (const change of ['reorder', 'close-other', 'close-target'] as const) test(`queued selection follows page identity after ${change}`, async () => {
  const f = fixture();
  let held: Awaited<ReturnType<typeof holdCommand>> | undefined;
  try {
    await adopt(f.controller, f.native);
    const page = f.native.pages[1]!;
    held = await holdCommand(f, () => {
      if (change === 'reorder') f.native.pages.reverse();
      else f.native.pages.splice(f.native.pages.indexOf(change === 'close-target' ? page : f.native.pages[0]!), 1);
    });
    const checkpoints = f.checkpoints.length;
    const selecting = f.controller.selectSessionPage({ name: 'owned', context: f.native.context, page });
    held.resume();
    await held.running;
    assert.equal(await selecting, change !== 'close-target');
    assert.equal(f.controller.inspectSessions()[0]?.selectedPage, change === 'close-target' ? f.native.tabs[0]!.page : page);
    assert.equal(f.checkpoints.length, checkpoints + 1 + (change === 'close-target' ? 0 : 1));
    assert.equal(f.effects.includes('acquire') || f.effects.includes('restore'), false);
  } finally { held?.resume(); await held?.running; await f.controller.dispose(); }
});

for (const reuseContext of [false, true]) test(`queued close and replacement rejects old session identity, context reused: ${reuseContext}`, async () => {
  const f = fixture();
  let held: Awaited<ReturnType<typeof holdCommand>> | undefined;
  try {
    await adopt(f.controller, f.native);
    const page = f.native.pages[1]!;
    held = await holdCommand(f);
    const closing = f.run(['close']);
    const replacement = reuseContext ? f.native : browser();
    const restoring = adopt(f.controller, replacement);
    const selecting = f.controller.selectSessionPage({ name: 'owned', context: f.native.context, page });
    held.resume();
    await Promise.all([held.running, closing, restoring]);
    const checkpoints = f.checkpoints.length;
    assert.equal(await selecting, false);
    assert.equal(f.controller.inspectSessions()[0]?.selectedPage, replacement.pages[0]);
    assert.equal(f.checkpoints.length, checkpoints);
    assert.equal(f.effects.includes('acquire') || f.effects.includes('restore'), false);
  } finally { held?.resume(); await held?.running; await f.controller.dispose(); }
});

for (const timing of ['before', 'queued'] as const) for (const reason of [null, false, new Error('host selection cancelled')]) {
  test(`selection preserves ${String(reason)} abort identity ${timing} without cancelling shared work`, async () => {
    const f = fixture();
    const abort = new AbortController();
    let held: Awaited<ReturnType<typeof holdCommand>> | undefined;
    try {
      await adopt(f.controller, f.native);
      if (timing === 'queued') held = await holdCommand(f);
      else abort.abort(reason);
      const selecting = f.controller.selectSessionPage({ name: 'owned', context: f.native.context, page: f.native.pages[1]!, signal: abort.signal });
      const outcome = Promise.allSettled([selecting]);
      abort.abort(reason);
      held?.resume();
      await held?.running;
      const [result] = await outcome;
      assert.equal(result?.status, 'rejected');
      if (result?.status === 'rejected') assert.equal(result.reason, reason);
      assert.equal(f.controller.inspectSessions()[0]?.selectedPage, f.native.pages[0]);
      assert.equal(f.native.calls.includes('release'), false);
    } finally { held?.resume(); await held?.running; await f.controller.dispose(); }
  });
}

for (const stage of ['initialization', 'invalidation'] as const) for (const change of ['close-target', 'abort'] as const) {
  test(`selection rechecks ${change} after awaiting ${stage}`, async () => {
    const f = fixture();
    const entered = deferred();
    const resume = deferred();
    const abort = new AbortController();
    const reason = { cancellation: 'host selection' };
    const page = f.native.pages[1]!;
    let outcome: Promise<PromiseSettledResult<boolean>[]> | undefined;
    try {
      if (stage === 'initialization') {
        const lease: PlaywrightLease = { ...f.native.lease,
          async executeCode(options) { if (options.page === page) { entered.resolve(); await resume.promise; } },
        };
        await f.controller.restoreSession({ name: 'owned', configuration: { initPages: [{ filename: 'init.js', source: 'export default () => {}' }] },
          async acquire() { return { lease, selectedPage: f.native.pages[0]! }; },
        });
      } else {
        await adopt(f.controller, f.native);
        await f.run(['snapshot']);
        f.native.tabs[0]!.snapshot.capsules[0]!.dispose = async () => { entered.resolve(); await resume.promise; };
      }
      const checkpoints = f.checkpoints.length;
      const listeners = f.native.tabs[0]!.events.listenerCount('close');
      outcome = Promise.allSettled([f.controller.selectSessionPage({ name: 'owned', context: f.native.context, page, signal: abort.signal })]);
      await entered.promise;
      if (change === 'abort') abort.abort(reason);
      else await page.close();
      resume.resolve();
      const [result] = await outcome;
      if (change === 'abort') { assert.equal(result?.status, 'rejected'); if (result?.status === 'rejected') assert.equal(result.reason, reason); }
      else assert.deepEqual(result, { status: 'fulfilled', value: false });
      assert.equal(f.controller.inspectSessions()[0]?.selectedPage, f.native.pages[0]);
      assert.equal(f.native.tabs[0]!.events.listenerCount('close'), listeners);
      assert.equal(f.checkpoints.length, checkpoints);
      await f.native.pages[0]!.close();
      assert.equal(f.controller.inspectSessions()[0]?.selectedPage, undefined);
    } finally { resume.resolve(); await outcome; await f.controller.dispose(); }
  });
}

test('selection cannot revive elapsed idle expiry or a disposed controller', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const f = fixture();
  try {
    await adopt(f.controller, f.native, { expiresAt: 1100, idleTimeoutMs: 100 });
    t.mock.timers.setTime(1100);
    const request = { name: 'owned', context: f.native.context, page: f.native.pages[1]! };
    assert.equal(await f.controller.selectSessionPage(request), false);
    assert.deepEqual(f.controller.inspectSessions(), []);
    assert.deepEqual(f.effects, []);
    await f.controller.dispose();
    assert.equal(await f.controller.selectSessionPage(request), false);
  } finally { await f.controller.dispose(); }
});

test('cancellation during checkpoint preserves its reason and the already selected live page', async () => {
  const native = browser();
  const entered = deferred();
  const resume = deferred();
  const abort = new AbortController();
  const controller = createPlaywrightController({ persistence: {
    async restore() { assert.fail('selection cannot restore'); }, async delete() {},
    async checkpoint(_session, signal) { entered.resolve(); await resume.promise; signal.throwIfAborted(); },
  } });
  let outcome: Promise<PromiseSettledResult<boolean>[]> | undefined;
  try {
    await adopt(controller, native);
    outcome = Promise.allSettled([controller.selectSessionPage({ name: 'owned', context: native.context, page: native.pages[1]!, signal: abort.signal })]);
    await entered.promise;
    abort.abort(false);
    resume.resolve();
    assert.deepEqual((await outcome)[0], { status: 'rejected', reason: false });
    assert.equal(controller.inspectSessions()[0]?.selectedPage, native.pages[1]);
    assert.equal(native.calls.includes('release'), false);
  } finally { resume.resolve(); await outcome; await controller.dispose(); }
});

test('an independent checkpoint failure after cancellation retires the session and preserves the caller reason', async () => {
  const native = browser();
  const entered = deferred();
  const resume = deferred();
  const abort = new AbortController();
  const reason = new Error('host selection cancelled');
  const failure = new Error('profile commit failed after cancellation');
  let checkpoints = 0;
  const controller = createPlaywrightController({ persistence: {
    async restore() { assert.fail('selection cannot restore'); }, async delete() {},
    async checkpoint() { if (checkpoints++ === 0) { entered.resolve(); await resume.promise; throw failure; } },
  } });
  let outcome: Promise<PromiseSettledResult<boolean>[]> | undefined;
  try {
    await adopt(controller, native);
    outcome = Promise.allSettled([controller.selectSessionPage({ name: 'owned', context: native.context, page: native.pages[1]!, signal: abort.signal })]);
    await entered.promise;
    abort.abort(reason);
    resume.resolve();
    const [result] = await outcome;
    assert.equal(result?.status, 'rejected');
    if (result?.status === 'rejected') assert.equal(result.reason, reason);
    assert.equal(native.calls.includes('release'), true);
    assert.deepEqual(controller.inspectSessions(), []);
  } finally { resume.resolve(); await outcome; await controller.dispose(); }
});

for (const stage of ['initialization', 'checkpoint'] as const) test(`a target closing during ${stage} only renews idle expiry after publication`, async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const native = browser();
  const entered = deferred();
  const resume = deferred();
  const page = native.pages[1]!;
  const checkpoints: PlaywrightSessionCheckpoint[] = [];
  const controller = createPlaywrightController({ persistence: {
    async restore() { assert.fail('selection cannot restore'); }, async delete() {},
    async checkpoint(session) {
      checkpoints.push(session);
      if (stage === 'checkpoint') { entered.resolve(); await resume.promise; }
    },
  } });
  const lease: PlaywrightLease = { ...native.lease,
    async executeCode(options) { if (stage === 'initialization' && options.page === page) { entered.resolve(); await resume.promise; } },
  };
  let selecting: Promise<boolean> | undefined;
  try {
    await controller.restoreSession({ name: 'owned', expiresAt: 1100, idleTimeoutMs: 100,
      configuration: { initPages: [{ filename: 'init.js', source: 'export default () => {}' }] },
      async acquire() { return { lease, selectedPage: native.pages[0]! }; },
    });
    t.mock.timers.setTime(1090);
    selecting = controller.selectSessionPage({ name: 'owned', context: native.context, page });
    await entered.promise;
    await page.close();
    resume.resolve();
    assert.equal(await selecting, false);
    assert.equal(controller.inspectSessions()[0]?.selectedPage, stage === 'checkpoint' ? undefined : native.pages[0]);
    assert.equal(controller.inspectSessions()[0]?.expiresAt, stage === 'checkpoint' ? 1190 : 1100);
    assert.equal(checkpoints.length, stage === 'checkpoint' ? 1 : 0);
    if (stage === 'checkpoint') assert.equal(checkpoints[0]?.selectedPage, page);
    assert.equal(native.calls.includes('release'), false);
  } finally { resume.resolve(); await selecting; await controller.dispose(); }
});

for (const cancelled of [false, true]) test(`a failed initializer retires its unhealthy session, caller cancelled: ${cancelled}`, async () => {
  const native = browser();
  const entered = deferred();
  const resume = deferred();
  const abort = new AbortController();
  const failure = new Error('initializer failed');
  const page = native.pages[1]!;
  const lease: PlaywrightLease = { ...native.lease,
    async executeCode(options) { if (options.page === page) { entered.resolve(); await resume.promise; throw failure; } },
  };
  const controller = createPlaywrightController();
  let outcome: Promise<PromiseSettledResult<boolean>[]> | undefined;
  try {
    await controller.restoreSession({ name: 'owned', configuration: { initPages: [{ filename: 'init.js', source: 'export default () => {}' }] },
      async acquire() { return { lease, selectedPage: native.pages[0]! }; },
    });
    outcome = Promise.allSettled([controller.selectSessionPage({ name: 'owned', context: native.context, page, signal: abort.signal })]);
    await entered.promise;
    if (cancelled) abort.abort(false);
    resume.resolve();
    const [result] = await outcome;
    assert.equal(result?.status, 'rejected');
    if (result?.status === 'rejected') {
      if (cancelled) assert.equal(result.reason, false);
      else { assert.ok(result.reason instanceof Error); assert.equal(result.reason.cause, failure); }
    }
    assert.equal(native.calls.includes('release'), true);
    assert.deepEqual(controller.inspectSessions(), []);
  } finally { resume.resolve(); await outcome; await controller.dispose(); }
});

for (const storageReadFailure of [false, true]) test(`selection retains ordinary checkpoint failure policy, storage read: ${storageReadFailure}`, async () => {
  const native = browser();
  const failure = storageReadFailure ? new PlaywrightStorageReadError('profile read failed') : new Error('profile commit failed');
  let failed = false;
  const controller = createPlaywrightController({ persistence: {
    async restore() { assert.fail('selection cannot restore'); }, async delete() {},
    async checkpoint() { if (!failed) { failed = true; throw failure; } },
  } });
  try {
    await adopt(controller, native);
    await assert.rejects(controller.selectSessionPage({ name: 'owned', context: native.context, page: native.pages[1]! }), error => {
      if (storageReadFailure) { assert.ok(error instanceof PlaywrightCheckpointError); assert.equal(error.cause, failure); }
      else assert.equal(error, failure);
      return true;
    });
    assert.equal(native.calls.includes('release'), !storageReadFailure);
    assert.equal(controller.inspectSessions().length, storageReadFailure ? 1 : 0);
  } finally { await controller.dispose(); }
});

test('CLI exposes live identity selection and successful activity renews idle expiry', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const native = browser();
  const cli = createPlaywrightCli();
  try {
    await adopt(cli, native, { expiresAt: 1100, idleTimeoutMs: 100 });
    t.mock.timers.setTime(1090);
    assert.equal(await cli.selectSessionPage({ name: 'owned', context: native.context, page: native.pages[1]! }), true);
    assert.equal(cli.inspectSessions()[0]?.selectedPage, native.pages[1]);
    assert.equal(cli.inspectSessions()[0]?.expiresAt, 1190);
  } finally { await cli.dispose(); }
});
