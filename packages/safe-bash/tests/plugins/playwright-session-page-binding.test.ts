import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createPlaywrightCli, createPlaywrightController } from '../../src/commands/playwright/index.js';
import type { PlaywrightContext, PlaywrightLease, PlaywrightPage } from '../../src/playwright/index.js';

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
  for (const name of ['first', 'second']) {
    const page = Object.assign(new EventEmitter(), {
      async goto() {}, url: () => `https://example.test/${name}`, async title() { return name; },
      frames: () => [], keyboard: { async press() { calls.push(`${name}:press`); } },
      async close() { pages.splice(pages.indexOf(page), 1); page.emit('close'); },
    }) as unknown as PlaywrightPage & EventEmitter;
    pages.push(page);
  }
  const context: PlaywrightContext = {
    pages: () => [...pages], async newPage() { assert.fail('host binding cannot allocate'); },
    async close() {}, on: events.on.bind(events), off: events.off.bind(events),
  };
  const lease: PlaywrightLease = {
    context, onClosed(listener) { closed.add(listener); return () => { closed.delete(listener); }; },
    async release() { calls.push('release'); for (const listener of closed) listener(); },
  };
  return { context, lease, pages, calls, events, disconnect() { for (const listener of closed) listener(); } };
}

function fixture() {
  const native = browser();
  let checkpoints = 0;
  const controller = createPlaywrightController({
    adapter: { browsers: { chromium: { headed: false } }, async acquire() { assert.fail('host binding cannot acquire'); } },
    persistence: {
      async restore() { assert.fail('host binding cannot restore'); },
      async checkpoint() { checkpoints++; }, async delete() {},
    },
  });
  const request = () => ({ name: 'owned', context: native.context, page: native.pages[0]! });
  const adopt = (policy: { expiresAt?: number; idleTimeoutMs?: number } = {}) => controller.restoreSession({
    name: 'owned', ...policy, async acquire() { return { lease: native.lease, selectedPage: native.pages[0]! }; },
  });
  const run = (args: string[]) => controller.run({ args: ['-s=owned', ...args], env: {}, signal: new AbortController().signal,
    async write() {}, async writeArtifact() {},
  });
  return { native, controller, request, adopt, run, checkpoints: () => checkpoints };
}

test('host page binding serializes separate capture and commit operations with agent work', async () => {
  const f = fixture();
  try {
    await f.adopt();
    const binding = f.controller.bindSessionPage(f.request());
    assert.ok(binding);
    assert.equal(Object.isFrozen(binding), true);
    const seen: string[] = [];
    assert.deepEqual(await binding.run(async ({ check }) => { check(); seen.push('capture'); return 7; }), { status: 'completed', value: 7 });
    const held = deferred();
    const entered = deferred();
    f.native.pages[0]!.keyboard.press = async () => { entered.resolve(); await held.promise; seen.push('agent'); };
    const running = f.run(['press', 'Enter']);
    await entered.promise;
    const committing = binding.run(async ({ check }) => { check(); seen.push('commit'); });
    assert.deepEqual(seen, ['capture']);
    held.resolve();
    await running;
    assert.deepEqual(await committing, { status: 'completed', value: undefined });
    assert.deepEqual(seen, ['capture', 'agent', 'commit']);
    assert.equal(f.checkpoints(), 1, 'only the agent command checkpoints');
    assert.equal(f.controller.inspectSessions()[0]?.selectedPage, f.native.pages[0]);
    assert.deepEqual(f.native.calls, []);
  } finally { await f.controller.dispose(); }
});

test('binding requires a live exact selected page and never allocates, restores or selects', async () => {
  const f = fixture();
  try {
    assert.equal(f.controller.bindSessionPage(f.request()), undefined);
    await f.adopt();
    const foreign = browser();
    for (const request of [
      { ...f.request(), name: 'missing' },
      { ...f.request(), context: foreign.context },
      { ...f.request(), page: foreign.pages[0]! },
      { ...f.request(), page: f.native.pages[1]! },
    ]) assert.equal(f.controller.bindSessionPage(request), undefined);
    const binding = f.controller.bindSessionPage(f.request())!;
    await f.native.pages[0]!.close();
    assert.deepEqual(await binding.run(async () => assert.fail('closed page callback')), { status: 'unavailable' });
    assert.equal(f.checkpoints(), 0);
    assert.deepEqual(f.native.calls, []);
  } finally { await f.controller.dispose(); }
});

test('a queued tab change rejects the old page before callback admission', async () => {
  const f = fixture();
  try {
    await f.adopt();
    const binding = f.controller.bindSessionPage(f.request())!;
    const selecting = f.controller.selectSessionPage({ ...f.request(), page: f.native.pages[1]! });
    const operation = binding.run(async () => assert.fail('selection changed before admission'));
    assert.equal(await selecting, true);
    assert.deepEqual(await operation, { status: 'unavailable' });
    assert.equal(f.controller.inspectSessions()[0]?.selectedPage, f.native.pages[1]);
  } finally { await f.controller.dispose(); }
});

test('binding cannot cross same-alias recreation even when native context and page are reused', async () => {
  const f = fixture();
  try {
    await f.adopt();
    const binding = f.controller.bindSessionPage(f.request())!;
    await f.run(['close']);
    await f.adopt();
    assert.deepEqual(await binding.run(async () => assert.fail('recreated session callback')), { status: 'unavailable' });
    const replacement = f.controller.bindSessionPage(f.request());
    assert.ok(replacement);
    assert.deepEqual(await replacement.run(async () => 'new session'), { status: 'completed', value: 'new session' });
  } finally { await f.controller.dispose(); }
});

for (const reason of [null, false, new Error('clipboard cancelled')]) test(`queued cancellation preserves ${String(reason)} and leaves the shared session open`, async () => {
  const f = fixture();
  const abort = new AbortController();
  const entered = deferred();
  const resume = deferred();
  try {
    await f.adopt();
    const binding = f.controller.bindSessionPage(f.request())!;
    const first = binding.run(async () => { entered.resolve(); await resume.promise; });
    await entered.promise;
    const cancelled = Promise.allSettled([binding.run(async () => assert.fail('cancelled callback'), { signal: abort.signal })]);
    abort.abort(reason);
    resume.resolve();
    await first;
    assert.deepEqual(await cancelled, [{ status: 'rejected', reason }]);
    assert.equal(f.controller.inspectSessions().length, 1);
    assert.deepEqual(f.native.calls, []);
  } finally { resume.resolve(); await f.controller.dispose(); }
});

test('entered cancellation holds the queue until the callback settles and cannot claim a no-op', async () => {
  const f = fixture();
  const abort = new AbortController();
  const entered = deferred();
  const resume = deferred();
  try {
    await f.adopt();
    const binding = f.controller.bindSessionPage(f.request())!;
    let nextEntered = false;
    const first = Promise.allSettled([binding.run(async ({ signal }) => {
      entered.resolve(); await resume.promise; assert.equal(signal.aborted, true); return 'possibly applied';
    }, { signal: abort.signal })]);
    await entered.promise;
    abort.abort(false);
    const next = binding.run(async () => { nextEntered = true; });
    await Promise.resolve();
    assert.equal(nextEntered, false);
    resume.resolve();
    assert.deepEqual(await first, [{ status: 'rejected', reason: false }]);
    await next;
    assert.equal(nextEntered, true);
    assert.deepEqual(f.native.calls, []);
  } finally { resume.resolve(); await f.controller.dispose(); }
});

test('page loss after callback admission rejects instead of returning unavailable', async () => {
  const f = fixture();
  try {
    await f.adopt();
    const binding = f.controller.bindSessionPage(f.request())!;
    let checked = false;
    await assert.rejects(binding.run(async ({ check }) => {
      await f.native.pages[0]!.close();
      assert.throws(check, /no longer available/);
      checked = true;
      return 'may have applied';
    }), /no longer available/);
    assert.equal(checked, true);
  } finally { await f.controller.dispose(); }
});

for (const closure of ['page', 'lease'] as const) test(`${closure} closure cancels an entered signal-aware callback and retires its work`, async () => {
  const f = fixture();
  const entered = deferred();
  const aborted = deferred();
  let signal: AbortSignal | undefined;
  let reentrantDisposal: Promise<void> | undefined;
  try {
    await f.adopt();
    const binding = f.controller.bindSessionPage(f.request())!;
    const listeners = (f.native.pages[0] as unknown as EventEmitter).listenerCount('close');
    const running = Promise.allSettled([binding.run(async scope => {
      signal = scope.signal;
      signal.addEventListener('abort', () => {
        reentrantDisposal = f.controller.dispose();
        aborted.resolve();
      }, { once: true });
      entered.resolve();
      await aborted.promise;
      signal.throwIfAborted();
    })]);
    await entered.promise;
    if (closure === 'page') await f.native.pages[0]!.close();
    else f.native.disconnect();
    assert.equal(signal?.aborted, true, 'closure must cancel without waiting for a caller deadline');
    assert.equal((await running)[0]?.status, 'rejected');
    await reentrantDisposal;
    assert.equal(f.native.calls.filter(call => call === 'release').length, 1);
    if (closure === 'lease') assert.ok((f.native.pages[0] as unknown as EventEmitter).listenerCount('close') <= listeners);
  } finally { aborted.resolve(); await f.controller.dispose(); }
});

test('host operations decline a yielded native dialog and resume after it is dismissed', async () => {
  const f = fixture();
  const resume = deferred();
  try {
    await f.adopt();
    const binding = f.controller.bindSessionPage(f.request())!;
    const page = f.native.pages[0]!;
    page.keyboard.press = async () => {
      f.native.events.emit('dialog', { page: () => page, type: () => 'confirm', message: () => 'Continue?', defaultValue: () => '',
        async accept() { resume.resolve(); }, async dismiss() { resume.resolve(); },
      });
      await resume.promise;
    };
    await f.run(['press', 'Enter']);
    assert.deepEqual(await binding.run(async () => assert.fail('native action still pending')), { status: 'unavailable' });
    await f.run(['dialog-dismiss']);
    assert.deepEqual(await binding.run(async () => 'after dialog'), { status: 'completed', value: 'after dialog' });
  } finally { resume.resolve(); await f.controller.dispose(); }
});

test('disposal cancels and awaits an admitted callback including its late failure', async () => {
  const f = fixture();
  const entered = deferred();
  const resume = deferred();
  try {
    await f.adopt();
    const binding = f.controller.bindSessionPage(f.request())!;
    let disposed = false;
    const first = Promise.allSettled([binding.run(async ({ signal }) => {
      entered.resolve(); await resume.promise; signal.throwIfAborted();
    })]);
    await entered.promise;
    const disposing = f.controller.dispose().then(() => { disposed = true; });
    await Promise.resolve();
    assert.equal(disposed, false);
    resume.resolve();
    const [result] = await first;
    assert.equal(result?.status, 'rejected');
    await disposing;
    assert.deepEqual(await binding.run(async () => assert.fail('disposed callback')), { status: 'unavailable' });
  } finally { resume.resolve(); await f.controller.dispose(); }
});

test('host activity pauses and renews idle expiry without reviving an expired session', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const f = fixture();
  try {
    await f.adopt({ expiresAt: 1100, idleTimeoutMs: 100 });
    const binding = f.controller.bindSessionPage(f.request())!;
    t.mock.timers.setTime(1090);
    await binding.run(async ({ check }) => {
      t.mock.timers.setTime(1200); check();
      assert.equal(f.controller.inspectSessions().length, 1);
    });
    assert.equal(f.controller.inspectSessions()[0]?.expiresAt, 1300);
    assert.equal(f.checkpoints(), 0);
    t.mock.timers.setTime(1300);
    assert.deepEqual(await binding.run(async () => assert.fail('expired callback')), { status: 'unavailable' });
  } finally { await f.controller.dispose(); }
});

test('CLI forwards the host-only page binding', async () => {
  const cli = createPlaywrightCli();
  const native = browser();
  try {
    await cli.restoreSession({ name: 'owned', async acquire() { return { lease: native.lease, selectedPage: native.pages[0]! }; } });
    const binding = cli.bindSessionPage({ name: 'owned', context: native.context, page: native.pages[0]! });
    assert.ok(binding);
    assert.deepEqual(await binding.run(async () => false), { status: 'completed', value: false });
  } finally { await cli.dispose(); }
});
