import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlaywrightController } from '../../src/playwright/index.js';
import type { PlaywrightAdapter, PlaywrightLease, PlaywrightPage } from '../../src/playwright/index.js';
import type { SnapshotNode } from '../../src/playwright/adapter.js';
import { createSnapshotFrame } from '../helpers/playwright-snapshot.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(maxSessions = 2) {
  const events: string[] = [];
  const leases: { lease: PlaywrightLease; lost(): void; releases: number; callbacks: (() => void)[] }[] = [];
  const adapter: PlaywrightAdapter = {
    browsers: { chromium: { headed: false }, firefox: { headed: true } },
    async acquire(request) {
      events.push(`acquire:${request.session}:${request.browser}:${request.headless}`);
      const listeners = new Set<() => void>();
      const page = { goto: async (url: string) => { events.push(`goto:${request.session}:${url}`); }, url: () => 'about:blank' } as PlaywrightPage;
      const item = {
        releases: 0,
        callbacks: [] as (() => void)[],
        lost() { for (const listener of listeners) listener(); },
        lease: {
          context: { newPage: async () => page, pages: () => [page], close: async () => {}, on() {}, off() {} },
          onClosed(listener: () => void) { item.callbacks.push(listener); listeners.add(listener); return () => { listeners.delete(listener); }; },
          async release() { item.releases++; item.lost(); },
        } satisfies PlaywrightLease,
      };
      leases.push(item);
      return item.lease;
    },
  };
  const controller = createPlaywrightController({ adapter, limits: { maxSessions } });
  const run = (args: string[], overrides = {}) => controller.run({ args, env: {}, signal: new AbortController().signal, write: async (text: string) => { events.push(`out:${text}`); }, ...overrides });
  return { controller, adapter, events, leases, run };
}

for (const actionTimeout of [0, 1500]) test(`init-page and run-code keep action timeout ${actionTimeout} separate from the whole-program deadline`, async () => {
  const f = fixture();
  const actionTimeouts: number[] = [];
  const codeTimeouts: number[] = [];
  const controller = createPlaywrightController({ adapter: { ...f.adapter, async acquire(request) {
    const lease = await f.adapter.acquire(request);
    Object.assign(lease.context, { setDefaultTimeout(timeout: number) { actionTimeouts.push(timeout); } });
    return { ...lease, async executeCode(options) {
      codeTimeouts.push(options.timeoutMs);
      if (options.timeoutMs < 3000) throw new Error('Run-code deadline exceeded during isolated module startup');
    } };
  } } });
  const run = (args: string[]) => controller.run({ args, env: {}, signal: new AbortController().signal, async write() {}, async readArtifact(path) {
    return new TextEncoder().encode(path === 'config.ini' ? `timeouts.action=${actionTimeout}\nbrowser.initPage[]=init.cjs` : 'exports.default = async ({ page }) => page.title();');
  } });
  try {
    await run(['open', '--config=config.ini']);
    await run(['run-code', 'async page => page.title()']);
    assert.deepEqual(actionTimeouts, [actionTimeout]);
    assert.deepEqual(codeTimeouts, [30000, 30000]);
  } finally { await controller.dispose(); await f.controller.dispose(); }
});

test('failed native JSON capture retires its session before another open', async () => {
  const f = fixture();
  try {
    await f.run(['open']);
    const owned = f.leases[0]!;
    const page = owned.lease.context.pages()[0]!;
    Object.assign(page, { on() {}, off() {} });
    const failure = new Error('native JSON snapshot timed out');
    Object.defineProperty(owned.lease, 'captureSnapshotJSON', { value: async () => { throw failure; } });
    await assert.rejects(f.run(['snapshot', '--json']), error => error === failure);
    assert.equal(owned.releases, 1);
    assert.deepEqual(f.controller.inspectSessions(), []);
    await f.run(['open']);
    assert.equal(f.leases.length, 2);
  } finally { await f.controller.dispose(); }
});

for (const command of ['close', 'goto'] as const) test(`failed live trace capture still retires resources during ${command}`, async () => {
  const f = fixture();
  await f.run(['open']);
  const owned = f.leases[0]!;
  let name = '';
  let failed = false;
  Object.defineProperty(owned.lease.context, 'tracing', { value: {
    async start(options: { name: string }) { name = options.name; }, async stop() {},
  } });
  Object.defineProperty(owned.lease, 'captureTrace', { value: async () => {
    if (failed) throw new Error('capture failed');
    return { files: [{ path: `${name}.trace`, bytes: new Uint8Array() }, { path: `${name}.network`, bytes: new Uint8Array() }] };
  } });
  try {
    await f.run(['tracing-start'], { writeArtifact: async () => {} });
    failed = true;
    await assert.rejects(f.run(command === 'goto' ? ['goto', 'https://example.test'] : ['close'], { writeArtifact: async () => {} }), /capture failed/);
    assert.equal(owned.releases, 1);
    assert.deepEqual(f.controller.inspectSessions(), []);
  } finally { await f.controller.dispose(); }
});

test('available trace transport does not require artifact writes until recording starts', async () => {
  const f = fixture();
  try {
    await f.run(['open']);
    Object.defineProperty(f.leases[0]!.lease, 'captureTrace', { value: async () => { throw new Error('no recording must not capture'); } });
    await f.run(['goto', 'https://example.test']);
    assert.equal(f.leases[0]!.releases, 0);
  } finally { await f.controller.dispose(); }
});

test('native trace shutdown finishes before browser release after a capture failure', async () => {
  const f = fixture();
  await f.run(['open']);
  const owned = f.leases[0]!;
  const stopping = deferred<void>();
  const finish = deferred<void>();
  Object.defineProperty(owned.lease.context, 'tracing', { value: {
    async start() {}, async stop() { stopping.resolve(); await finish.promise; if (owned.releases) throw new Error('trace browser closed too early'); },
  } });
  Object.defineProperty(owned.lease, 'captureTrace', { value: async () => { throw new Error('original trace capture failure'); } });
  const result = f.run(['tracing-start'], { writeArtifact: async () => {} }).then(() => undefined, error => error);
  await stopping.promise;
  const prematureRelease = owned.releases;
  finish.resolve();
  const failure: unknown = await result;
  try {
    assert.equal(prematureRelease, 0);
    assert.ok(failure instanceof Error);
    assert.match(failure.message, /original trace capture failure/);
    assert.equal(owned.releases, 1);
  } finally { await f.controller.dispose().catch(() => {}); }
});

for (const command of ['click', 'fill', 'custom'] as const) {
  for (const cancel of [false, true]) test(`${command} keeps a navigating target alive until ${cancel ? 'cancellation' : 'the action settles'}`, async () => {
    const cancellation = new AbortController();
    const navigation = deferred<void>();
    const loaded = deferred<void>();
    const disposed = deferred<void>();
    const listeners = new Set<() => void>();
    let disposals = 0;
    let releases = 0;
    let latestRef = '';
    const action = async () => {
      for (const listener of listeners) listener();
      navigation.resolve();
      await Promise.race([loaded.promise, disposed.promise.then(() => { throw new Error('Target page, context or browser has been closed'); })]);
    };
    const node = { isConnected: true, tagName: 'BUTTON', textContent: 'Save', getAttribute: () => null };
    const handle = {
      async evaluate<T>(callback: (node: SnapshotNode) => T) { return callback(node); },
      click: action, fill: action,
      async dispose() { disposals++; disposed.resolve(); },
    };
    const snapshot = createSnapshotFrame([{ node, native: handle }]);
    const page = {
      goto: async () => {}, url: () => 'https://example.test/save',
      on: (event: string, listener: () => void) => { if (event === 'framenavigated') listeners.add(listener); },
      off: (_event: string, listener: () => void) => { listeners.delete(listener); },
      frames: () => [snapshot.frame],
    } as unknown as PlaywrightPage;
    const controller = createPlaywrightController({
      adapter: { browsers: { chromium: { headed: false } }, async acquire() {
        return { context: { newPage: async () => page, pages: () => [page], close: async () => {}, on() {}, off() {} },
          onClosed: () => () => {}, release: async () => { releases++; loaded.resolve(); } };
      } },
      ...(command === 'custom' ? { abilities: { open: true as const, snapshot: true as const, click: {
        scope: 'session' as const,
        async execute(request: import('../../src/playwright/index.js').PlaywrightAbilityRequest) {
          await (await request.browserSession!.resolveTarget(latestRef)).click();
          if (!cancel) await request.browserSession!.selectPage(page);
        },
      } } } : {}),
    });
    const run = (args: string[]) => controller.run({ args, env: {}, signal: cancellation.signal, write: async text => { latestRef = text.match(/ref=(e\d+)/)?.[1] ?? latestRef; } });
    try {
      await run(['open']);
      await run(['snapshot']);
      assert.equal(snapshot.acquiredElements.length, 0);
      const priorCapsuleDisposals = snapshot.disposedCapsules.length;
      const pending = run(command === 'fill' ? ['fill', latestRef, 'value'] : ['click', latestRef]);
      const outcome = pending.then(() => undefined, error => error);
      await navigation.promise;
      await new Promise(resolve => setImmediate(resolve));
      const prematureDisposals = disposals;
      if (cancel) cancellation.abort(new Error('cancelled navigating action'));
      else loaded.resolve();
      if (cancel) assert.equal(await outcome, cancellation.signal.reason);
      else assert.equal(await outcome, undefined);
      assert.equal(prematureDisposals, 0);
      assert.equal(disposals, 1);
      assert.equal(snapshot.disposedCapsules.length, priorCapsuleDisposals + 1);
      assert.equal(releases, cancel ? 1 : 0);
      if (!cancel) await run(['snapshot']);
    } finally { loaded.resolve(); await controller.dispose(); }
    assert.equal(releases, 1);
  });
}

test('SDK help needs no adapter, artifact sink or valid session environment', async () => {
  const controller = createPlaywrightController();
  try {
    let output = '';
    await controller.run({ args: ['--help', 'snapshot'], env: { PLAYWRIGHT_CLI_SESSION: 'invalid session' }, signal: new AbortController().signal, write: async text => { output += text; } });
    assert.ok(output.startsWith('playwright-cli snapshot [target]'));
    assert.ok(!output.includes('Not enabled by this client'));
    assert.ok(output.includes('--filename'));
    const signal = AbortSignal.abort(new Error('cancelled help'));
    await assert.rejects(controller.run({ args: ['--help'], env: {}, signal, write: async () => { throw new Error('unexpected write'); } }), /cancelled help/);
  } finally { await controller.dispose(); }
});

test('session selection, retained ownership, explicit engine, and idempotent disposal', async () => {
  const f = fixture(3);
  await f.run(['open']);
  await f.run(['open'], { env: { PLAYWRIGHT_CLI_SESSION: 'exported' } });
  await f.run(['--session=flag', 'open', '--browser=firefox', '--headed'], { env: { PLAYWRIGHT_CLI_SESSION: 'ignored' } });
  assert.deepEqual(f.events.filter(e => e.startsWith('acquire')), ['acquire:default:chromium:true', 'acquire:exported:chromium:true', 'acquire:flag:firefox:false']);
  assert.equal(f.leases.every(l => l.releases === 0), true);
  await f.run(['-s', 'flag', 'goto', 'https://example.com']);
  await f.run(['list']);
  assert.match(f.events.at(-1)!, /flag:[\s\S]*status: open/);
  const disposal = f.controller.dispose();
  assert.equal(disposal, f.controller.dispose());
  await disposal;
  assert.equal(f.leases.every(l => l.releases === 1), true);
  await assert.rejects(f.run(['open']), /disposed/);
});

test('navigation forwards native URL schemes and normalizes bare hostnames', async () => {
  const f = fixture();
  const inputs = [
    ['data:text/html,<h1>Hello</h1>', 'data:text/html,<h1>Hello</h1>'],
    ['file:///tmp/page.html', 'file:///tmp/page.html'],
    ['about:blank#section', 'about:blank#section'],
    ['javascript:void(0)', 'javascript:void(0)'],
    ['custom-browser:resource', 'custom-browser:resource'],
    ['poe.com', 'https://poe.com'],
    ['localhost/page', 'http://localhost/page'],
  ];
  try {
    for (const command of ['open', 'goto', 'tab-new']) {
      if (command !== 'open') await f.run(['open']);
      for (const [input, expected] of inputs) {
        await f.run([command, input!]);
        assert.ok(f.events.includes(`goto:default:${expected}`), `${command} must pass ${input} to the native provider`);
        f.events.length = 0;
      }
    }
  } finally { await f.controller.dispose(); }
});

test('navigation retries its stale automatic snapshot without replaying the navigation', async () => {
  const f = fixture();
  const acquire = f.adapter.acquire.bind(f.adapter);
  let captures = 0;
  f.adapter.acquire = async request => {
    const lease = await acquire(request);
    const listeners = new Set<() => void>();
    Object.assign(lease.context.pages()[0]!, {
      on(event: string, listener: () => void) { if (event === 'framenavigated') listeners.add(listener); },
      off(event: string, listener: () => void) { if (event === 'framenavigated') listeners.delete(listener); },
      async _snapshotForAI() {
        if (++captures === 2) for (const listener of listeners) listener();
        return { full: '- button "Ready" [ref=e1]' };
      },
    });
    return lease;
  };
  try {
    await f.run(['open']);
    await f.run(['goto', 'https://example.test']);
    assert.equal(captures, 3);
    assert.equal(f.events.filter(event => event === 'goto:default:https://example.test').length, 1);
    assert.equal(f.leases[0]!.releases, 0);
  } finally { await f.controller.dispose(); }
});

test('invalid arguments, unsupported engines/options and invalid limits have no effects', async () => {
  const f = fixture();
  for (const args of [['open', '--browser=webkit'], ['open', '--headed'], ['open', '--browser=unknown'], ['open', '--idle-timeout=-1'], ['open', '--session=../bad'], ['goto'], ['close', 'extra'], ['open', '--browser']]) {
    await assert.rejects(f.run(args));
  }
  assert.deepEqual(f.events, []);
  assert.throws(() => createPlaywrightController({ adapter: f.adapter, limits: { maxSessions: 0 } }));
});

test('capacity is reserved during acquisition and sessions serialize independently', async () => {
  const f = fixture(1);
  const gate = deferred<PlaywrightLease>();
  const original = f.adapter.acquire.bind(f.adapter);
  const admitted = deferred<void>();
  f.adapter.acquire = async request => { await original(request); admitted.resolve(); return gate.promise; };
  const opening = f.run(['-s=a', 'open']);
  await admitted.promise;
  await assert.rejects(f.run(['-s=b', 'open']), /capacity/);
  const navigation = f.run(['-s=a', 'goto', 'https://example.com']);
  assert.equal(f.events.some(e => e.startsWith('goto')), false);
  gate.resolve(f.leases[0]!.lease);
  await opening;
  await navigation;
  await f.controller.dispose();
});

test('cleanup is registered before acquisition; failed and late acquisitions are drained', async () => {
  const f = fixture();
  const gate = deferred<PlaywrightLease>();
  const admitted = deferred<void>();
  const original = f.adapter.acquire.bind(f.adapter);
  f.adapter.acquire = async request => { assert.equal(f.events[0], 'cleanup'); await original(request); admitted.resolve(); return gate.promise; };
  let cleanup!: () => Promise<void>;
  const opening = f.run(['open'], { registerCleanup(fn: () => Promise<void>) { f.events.push('cleanup'); cleanup = fn; } });
  await admitted.promise;
  const completion = cleanup();
  assert.equal(completion, cleanup());
  gate.resolve(f.leases[0]!.lease);
  await assert.rejects(opening);
  await completion;
  assert.equal(f.leases[0]!.releases, 1);
  const failure = new Error('acquisition failed');
  f.adapter.acquire = async () => { throw failure; };
  await assert.rejects(f.run(['open']), error => error === failure);
  await f.controller.dispose();
});

test('successful invocation cleanup and later command abort leave retained sessions open', async () => {
  const f = fixture();
  let cleanup!: () => Promise<void>;
  const signal = new AbortController();
  await f.run(['open'], { signal: signal.signal, registerCleanup(fn: () => Promise<void>) { cleanup = fn; } });
  await cleanup();
  signal.abort();
  assert.equal(f.leases[0]!.releases, 0);
  await f.controller.dispose();
});

test('close/open races and old closure notifications cannot retire replacement generations', async () => {
  const f = fixture();
  await f.run(['open']);
  const old = f.leases[0]!;
  await f.run(['close']);
  await f.run(['open']);
  const closing = f.run(['close']);
  const opening = f.run(['open']);
  await Promise.all([closing, opening]);
  f.leases[1]!.lost();
  await f.run(['goto', 'https://example.com']);
  assert.equal(f.leases[2]!.releases, 0);
  old.callbacks[0]!();
  await f.run(['goto', 'https://example.com']);
  assert.equal(f.leases[2]!.releases, 0);
  await f.controller.dispose();
});

test('remote loss requires explicit reopen and never replays navigation', async () => {
  const f = fixture();
  await f.run(['open']);
  f.leases[0]!.lost();
  await assert.rejects(f.run(['goto', 'https://example.com']), /closed/);
  assert.equal(f.events.some(e => e.startsWith('goto')), false);
  await f.run(['open']);
  await f.controller.dispose();
  assert.equal(f.leases.every(l => l.releases === 1), true);
});

test('dispose during acquisition closes admission and retires late resources', async () => {
  const f = fixture();
  const gate = deferred<PlaywrightLease>();
  const admitted = deferred<void>();
  const original = f.adapter.acquire.bind(f.adapter);
  f.adapter.acquire = async request => { await original(request); admitted.resolve(); return gate.promise; };
  const opening = f.run(['open']);
  await admitted.promise;
  const disposal = f.controller.dispose();
  await assert.rejects(f.run(['open']), /disposed/);
  gate.resolve(f.leases[0]!.lease);
  await assert.rejects(opening);
  await disposal;
  assert.equal(f.leases[0]!.releases, 1);
});

test('active cancellation releases a context to unblock navigation and observes late failure', async () => {
  const f = fixture();
  await f.run(['open']);
  const entered = deferred<void>();
  const navigation = deferred<unknown>();
  f.leases[0]!.lease.context.pages()[0]!.goto = () => { entered.resolve(); return navigation.promise; };
  f.leases[0]!.lease.release = async () => { f.leases[0]!.releases++; navigation.reject(new Error('context closed')); };
  const abort = new AbortController();
  const command = f.run(['goto', 'https://example.com'], { signal: abort.signal });
  await entered.promise;
  const reason = new Error('cancelled');
  abort.abort(reason);
  await assert.rejects(command, error => error === reason);
  await f.controller.dispose();
  assert.equal(f.leases[0]!.releases, 1);
});

test('acquisition and cleanup failures retain both causes', async () => {
  const f = fixture();
  const original = f.adapter.acquire.bind(f.adapter);
  const failure = new Error('new page failed');
  const cleanup = new Error('release failed');
  f.adapter.acquire = async request => {
    const lease = await original(request);
    lease.context.newPage = async () => { throw failure; };
    lease.release = async () => { throw cleanup; };
    return lease;
  };
  await assert.rejects(f.run(['open']), error => error instanceof AggregateError && error.errors[0] === failure && error.errors[1] === cleanup);
  const disposal = f.controller.dispose();
  await assert.rejects(disposal);
  assert.equal(disposal, f.controller.dispose());
});

test('close-all drains an open admitted before its acquiring record is created', async () => {
  const f = fixture();
  const opening = f.run(['open']);
  const closing = f.run(['close-all']);
  await Promise.all([opening, closing]);
  assert.equal(f.leases[0]!.releases, 1);
  await f.controller.dispose();
});

test('output failure prevents ownership transfer and releases exactly once', async () => {
  const f = fixture();
  const failure = new Error('destination closed');
  await assert.rejects(f.run(['open'], { write: async () => { throw failure; } }), error => error === failure);
  assert.equal(f.leases[0]!.releases, 1);
  await f.controller.dispose();
});

test('remote loss during output prevents open and goto from reporting success', async () => {
  for (const command of ['open', 'goto']) {
    const f = fixture();
    if (command === 'goto') await f.run(['open']);
    await assert.rejects(f.run(command === 'open' ? ['open'] : ['goto', 'https://example.com'], {
      write: async () => { f.leases[0]!.lost(); },
    }), /Session closed/);
    assert.equal(f.leases[0]!.releases, 1);
    await assert.rejects(f.run(['goto', 'https://example.com']), /reopen explicitly/);
    await f.controller.dispose();
  }
});

test('unimplemented config and billing options are refused rather than silently ignored', () => {
  const f = fixture();
  for (const options of [{ adapter: f.adapter, limits: { maxTabsPerSession: 3 } }, { adapter: f.adapter, idleTimeoutMs: 100 }, { adapter: f.adapter, billing: { intervalMs: 1000, onUsage: async () => {} } }]) {
    assert.throws(() => createPlaywrightController(options as unknown as Parameters<typeof createPlaywrightController>[0]));
  }
  assert.deepEqual(f.events, []);
});

test('list exposes only open browsers while close serializes before replacement', async () => {
  const f = fixture();
  const gate = deferred<PlaywrightLease>();
  const entered = deferred<void>();
  const original = f.adapter.acquire.bind(f.adapter);
  f.adapter.acquire = async request => { await original(request); entered.resolve(); return gate.promise; };
  const opening = f.run(['open']);
  await entered.promise;
  await f.run(['list']);
  assert.equal(f.events.at(-1), 'out:  (no browsers)\n');
  gate.resolve(f.leases[0]!.lease);
  await opening;
  await f.run(['list']);
  assert.equal(f.events.at(-1), 'out:### Browsers\n- default:\n  - status: open\n');
  const retiring = deferred<void>();
  const started = deferred<void>();
  f.leases[0]!.lease.release = async () => { f.leases[0]!.releases++; started.resolve(); await retiring.promise; };
  const closing = f.run(['close']);
  await started.promise;
  await f.run(['list']);
  assert.equal(f.events.at(-1), 'out:  (no browsers)\n');
  retiring.resolve();
  await closing;
  await f.run(['list']);
  assert.equal(f.events.at(-1), 'out:  (no browsers)\n');
  await f.controller.dispose();
});

test('separate sessions perform navigation concurrently; queued cancellation does not retire their predecessor', async () => {
  const f = fixture();
  await Promise.all([f.run(['-s=a', 'open']), f.run(['-s=b', 'open'])]);
  const navigation = deferred<unknown>();
  const enteredA = deferred<void>();
  const enteredB = deferred<void>();
  f.leases[0]!.lease.context.pages()[0]!.goto = () => { enteredA.resolve(); return navigation.promise; };
  f.leases[1]!.lease.context.pages()[0]!.goto = () => { enteredB.resolve(); return navigation.promise; };
  const commands = [f.run(['-s=a', 'goto', 'https://example.com']), f.run(['-s=b', 'goto', 'https://example.com'])];
  await Promise.all([enteredA.promise, enteredB.promise]);
  const abort = new AbortController();
  const queued = f.run(['-s=a', 'goto', 'https://example.org'], { signal: abort.signal });
  abort.abort(new Error('queued cancelled'));
  assert.equal(f.leases.every(l => l.releases === 0), true);
  navigation.resolve(undefined);
  await Promise.all(commands);
  await assert.rejects(queued, /queued cancelled/);
  assert.equal(f.leases.every(l => l.releases === 0), true);
  await f.controller.dispose();
});

test('a queued reopen waits for failed-open retirement before acquiring its replacement', async () => {
  const f = fixture();
  const original = f.adapter.acquire.bind(f.adapter);
  let count = 0;
  f.adapter.acquire = async request => {
    const lease = await original(request);
    if (count++ === 0) lease.context.newPage = async () => { throw new Error('first open failed'); };
    return lease;
  };
  const first = f.run(['open']);
  const replacement = f.run(['open']);
  await assert.rejects(first, /first open failed/);
  await replacement;
  assert.equal(f.leases[0]!.releases, 1);
  assert.equal(f.leases[1]!.releases, 0);
  await f.controller.dispose();
});

test('late acquisition rejection after cancellation is observed and invocation cleanup drains it', async () => {
  const f = fixture();
  const acquisition = deferred<PlaywrightLease>();
  const entered = deferred<void>();
  f.adapter.acquire = async () => { entered.resolve(); return acquisition.promise; };
  const abort = new AbortController();
  let cleanup!: () => Promise<void>;
  const opening = f.run(['open'], { signal: abort.signal, registerCleanup(fn: () => Promise<void>) { cleanup = fn; } });
  await entered.promise;
  const reason = new Error('cancelled acquisition');
  abort.abort(reason);
  const completion = cleanup();
  acquisition.reject(new Error('late remote acquisition failure'));
  await assert.rejects(opening, error => error === reason);
  await completion;
  assert.equal(f.leases.length, 0);
  await f.controller.dispose();
});

test('invocation cleanup installs shared completion before reentrant acquisition abort listeners', async () => {
  const f = fixture();
  const acquisition = deferred<PlaywrightLease>();
  const entered = deferred<void>();
  let cleanup!: () => Promise<void>;
  let reentrant: Promise<void> | undefined;
  f.adapter.acquire = async request => {
    request.signal.addEventListener('abort', () => { reentrant = cleanup(); }, { once: true });
    entered.resolve();
    return acquisition.promise;
  };
  const opening = f.run(['open'], { registerCleanup(fn: () => Promise<void>) { cleanup = fn; } });
  await entered.promise;
  const completion = cleanup();
  assert.equal(completion, reentrant);
  acquisition.reject(new Error('host aborted'));
  await assert.rejects(opening);
  await completion;
  await f.controller.dispose();
});

test('cancelled close-all does not close sessions when its queued work is admitted later', async () => {
  const f = fixture();
  await f.run(['open']);
  const entered = deferred<void>();
  const navigation = deferred<unknown>();
  f.leases[0]!.lease.context.pages()[0]!.goto = () => { entered.resolve(); return navigation.promise; };
  const navigating = f.run(['goto', 'https://example.com']);
  await entered.promise;
  const abort = new AbortController();
  const closing = f.run(['close-all'], { signal: abort.signal });
  const reason = new Error('cancelled close-all');
  abort.abort(reason);
  const rejected = assert.rejects(closing, error => error === reason);
  navigation.resolve(undefined);
  await navigating;
  await rejected;
  assert.equal(f.leases[0]!.releases, 0);
  await f.run(['goto', 'https://example.org']);
  await f.controller.dispose();
});

test('invocation cleanup prevents queued close-all effects and drains its work', async () => {
  const f = fixture();
  await f.run(['open']);
  const entered = deferred<void>();
  const navigation = deferred<unknown>();
  f.leases[0]!.lease.context.pages()[0]!.goto = () => { entered.resolve(); return navigation.promise; };
  const navigating = f.run(['goto', 'https://example.com']);
  await entered.promise;
  let cleanup!: () => Promise<void>;
  const closing = f.run(['close-all'], { registerCleanup(fn: () => Promise<void>) { cleanup = fn; } });
  const completion = cleanup();
  assert.equal(completion, cleanup());
  const rejected = assert.rejects(closing, error => (error instanceof AggregateError ? error.errors : [error])
    .every((cause: unknown) => cause instanceof Error && cause.message === 'Playwright invocation cleaned up'));
  navigation.resolve(undefined);
  await navigating;
  await rejected;
  await completion;
  assert.equal(f.leases[0]!.releases, 0);
  await f.controller.dispose();
});

test('screenshots reject oversized producer geometry before capture or artifact writes', async () => {
  const current = fixture();
  await current.run(['open']);
  const page = await current.leases[0]!.lease.context.newPage();
  let captures = 0;
  let writes = 0;
  Object.assign(page, { evaluate: async () => ({ width: 4096, height: 4096 }) });
  page.screenshot = async () => { captures++; return new Uint8Array([1]); };
  await assert.rejects(current.run(['screenshot', '--full-page'], { writeArtifact: async () => { writes++; } }), /Screenshot pixel limit exceeded/);
  assert.equal(captures, 0);
  assert.equal(writes, 0);
  assert.equal(current.leases[0]!.releases, 0);
  await current.run(['goto', 'https://example.test/recovery']);
  await current.controller.dispose();
});

test('screenshots fix CSS geometry before calling the native producer', async () => {
  const current = fixture();
  await current.run(['open']);
  const page = await current.leases[0]!.lease.context.newPage();
  const captures: unknown[] = [];
  Object.assign(page, { evaluate: async () => ({ width: 8, height: 8 }) });
  page.screenshot = async options => { captures.push(options); return new Uint8Array([1]); };
  await current.run(['screenshot'], { writeArtifact: async () => {} });
  assert.deepEqual(captures, [{ type: 'png', fullPage: false, timeout: 5000, scale: 'css', clip: { x: 0, y: 0, width: 8, height: 8 } }]);
  await current.controller.dispose();
});

test('cancellation drains retained-session screenshots without publishing late artifacts', async () => {
  const f = fixture();
  await f.run(['open']);
  const page = await f.leases[0]!.lease.context.newPage();
  const entered = deferred<void>();
  const gate = deferred<Uint8Array>();
  page.evaluate = async <Result>() => ({ width: 1280, height: 720 }) as Result;
  page.screenshot = async () => { entered.resolve(); return gate.promise; };
  const original = f.leases[0]!.lease.release;
  f.leases[0]!.lease.release = async () => { await original(); gate.resolve(new Uint8Array([1])); };
  let writes = 0;
  const abort = new AbortController();
  const running = f.run(['screenshot'], { signal: abort.signal, writeArtifact: async () => { writes++; } });
  const rejection = assert.rejects(running, /stop screenshot/);
  await entered.promise;
  abort.abort(new Error('stop screenshot'));
  // Deterministic evidence without a test timeout: cancellation must begin
  // retirement immediately, so unblock only to report a failed expectation.
  await new Promise<void>(resolve => setImmediate(resolve));
  const released = f.leases[0]!.releases;
  gate.resolve(new Uint8Array([1]));
  await rejection;
  assert.equal(released, 1);
  assert.equal(writes, 0);
  await f.controller.dispose();
});
