import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindPlaywrightRoutePolicy, capturePlaywrightRoutes, playwrightRouteAbilities, type PlaywrightRouteHandler } from '../../src/playwright/route-capabilities.js';
import type { PlaywrightAbilityRequest } from '../../src/playwright/abilities.js';
import type { PlaywrightContext } from '../../src/playwright/adapter.js';
import type { PlaywrightPolicyRequest } from '../../src/playwright/network-policy.js';
import { playwrightStandardAbilities } from '../../src/playwright/standard-capabilities.js';
import { bindPlaywrightRoutePolicy as publicBindPlaywrightRoutePolicy } from '../../src/playwright/index.js';

function fixture() {
  const handlers: { pattern: string; handler: PlaywrightRouteHandler }[] = [];
  const cleanups: (() => Promise<void>)[] = [];
  let fail = false;
  let registration: Promise<void> | undefined;
  const context = {
    async setOffline() {},
    async route(pattern: string, handler: PlaywrightRouteHandler) { if (fail) throw new Error('registration failed'); await registration; handlers.push({ pattern, handler }); },
    async unroute(pattern: string, handler: PlaywrightRouteHandler) { if (fail) throw new Error('removal failed'); const index = handlers.findIndex(item => item.pattern === pattern && item.handler === handler); if (index >= 0) handlers.splice(index, 1); },
  } as unknown as PlaywrightContext;
  const request = (command: PlaywrightAbilityRequest['command'], args: string[] = [], options: PlaywrightAbilityRequest['options'] = {}, signal = new AbortController().signal): PlaywrightAbilityRequest => ({
    command, args, options, session: 's', signal,
    limits: { maxCommandBytes: 1024, maxArtifactBytes: 1024 },
    browserSession: { context, page: undefined, registerCleanup(cleanup) { cleanups.push(cleanup); }, resolveTarget: async () => { throw new Error('unused'); }, selectPage: async () => {} },
    write: async () => {}, readFile: async () => new Uint8Array(), writeArtifact: async () => {}, registerCleanup() {},
  });
  const run = (command: PlaywrightAbilityRequest['command'], args?: string[], options?: PlaywrightAbilityRequest['options'], signal?: AbortSignal) => playwrightRouteAbilities[command]!.execute(request(command, args, options, signal));
  return { context, handlers, cleanups, run, request, setFail(value: boolean) { fail = value; }, holdRegistration(value: Promise<void>) { registration = value; } };
}

test('routes use native fulfillment and request-header replacement with standard output', async () => {
  const f = fixture();
  await f.run('route', ['**/api'], { status: '201', body: '{"ok":true}', 'content-type': 'application/json' });
  const effects: unknown[] = [];
  const route = { request: () => ({ headers: () => ({ authorization: 'secret', kept: 'yes' }) }), fulfill: async (options: unknown) => { effects.push(options); }, continue: async (options: unknown) => { effects.push(options); } };
  await f.handlers[0]!.handler(route);
  assert.deepEqual(effects[0], { status: 201, body: '{"ok":true}', contentType: 'application/json' });
  await f.run('route', ['**/*'], { header: ['X-Added: value'], 'remove-header': 'authorization' });
  await f.handlers[1]!.handler(route);
  assert.deepEqual(effects[1], { headers: { kept: 'yes', 'x-added': 'value' } });
  assert.match(JSON.stringify(await f.run('route-list')), /1\. \*\*\/api \(status=201/);
  assert.match(JSON.stringify(await f.run('unroute', ['**/api'])), /Removed 1 route/);
  assert.equal(f.handlers.length, 1);
  for (const close of f.cleanups) await close();
  assert.equal(f.handlers.length, 0);
});

test('failed route mutations preserve the committed registry and reject invalid configuration', async () => {
  const f = fixture();
  f.setFail(true);
  await assert.rejects(f.run('route', ['**/*']), /registration failed/);
  assert.match(JSON.stringify(await f.run('route-list')), /No active routes/);
  f.setFail(false);
  await f.run('route', ['**/*']);
  f.setFail(true);
  await assert.rejects(f.run('unroute'), /removal failed/);
  assert.match(JSON.stringify(await f.run('route-list')), /\*\*\/\*/);
  f.setFail(false);
  await assert.rejects(f.run('route', ['**/*'], { status: 'bogus' }), /status/);
  await assert.rejects(f.run('route', ['**/*'], { header: 'missing colon' }), /header/);
  await assert.rejects(f.run('route', ['**/*'], { body: 'a'.repeat(1025) }), /byte limit/);
  await f.run('unroute');
  assert.equal(f.handlers.length, 0);
});

test('state replacement can reapply captured routes after the old context is retired', async () => {
  const old = fixture(), fresh = fixture();
  await old.run('route', ['**/api'], { body: 'retained' });
  const restore = capturePlaywrightRoutes(old.context)!;
  for (const close of old.cleanups) await close();
  await restore(fresh.context, cleanup => fresh.cleanups.push(cleanup));
  assert.equal(fresh.handlers.length, 1);
  assert.match(JSON.stringify(await fresh.run('route-list')), /body=retained/);
  await fresh.run('unroute');
  assert.equal(fresh.handlers.length, 0);
});

test('canceled route registration rolls back only its own handler and preserves the abort reason', async () => {
  for (const reason of [new Error('cancel registration'), 0]) {
    const setup = fixture();
    await setup.run('route', ['**/api'], { body: 'keep' });
    const original = setup.handlers[0];
    let resume!: () => void;
    setup.holdRegistration(new Promise<void>(resolve => { resume = resolve; }));
    const controller = new AbortController();
    const pending = setup.run('route', ['**/api'], { body: 'discard' }, controller.signal);
    controller.abort(reason);
    const rejected = assert.rejects(pending, error => error === reason);
    resume();
    try {
      await rejected;
      assert.deepEqual(setup.handlers, [original]);
      assert.doesNotMatch(JSON.stringify(await setup.run('route-list')), /discard/);
    } finally { for (const close of setup.cleanups) await close(); }
  }
});

test('route registration completing after session cleanup cannot resurrect a handler', async () => {
  const setup = fixture();
  let resume!: () => void;
  setup.holdRegistration(new Promise<void>(resolve => { resume = resolve; }));
  const pending = setup.run('route', ['**/api'], { body: 'discard' });
  for (const close of setup.cleanups) await close();
  const rejected = assert.rejects(pending, /closed/);
  resume();
  await rejected;
  assert.equal(setup.handlers.length, 0);
});

test('restored route registration also rolls back when replacement cleanup wins the race', async () => {
  const old = fixture(), fresh = fixture();
  await old.run('route', ['**/api'], { body: 'retained' });
  const restore = capturePlaywrightRoutes(old.context)!;
  let resume!: () => void;
  fresh.holdRegistration(new Promise<void>(resolve => { resume = resolve; }));
  const pending = restore(fresh.context, cleanup => fresh.cleanups.push(cleanup));
  for (const close of fresh.cleanups) await close();
  const rejected = assert.rejects(pending, /closed/);
  resume();
  try { await rejected; assert.equal(fresh.handlers.length, 0); }
  finally { for (const close of old.cleanups) await close(); }
});

function policyRequest(url = 'https://allowed.example/api', signal = new AbortController().signal): PlaywrightPolicyRequest {
  return { targetId: 'owned', frameId: 'frame', requestId: 'request', resourceType: 'Document', url, method: 'GET', headers: [], signal };
}

test('bound standard routes admit before mocks and never install competing native interceptors', async () => {
  const setup = fixture();
  setup.setFail(true);
  const admissions: string[] = [];
  let fetched = 0;
  const denied = new Error('forbidden URL');
  const binding = bindPlaywrightRoutePolicy(setup.context, {
    ownsRequest: candidate => candidate.targetId === 'owned',
    async admit(candidate) { admissions.push(candidate.url); if (new URL(candidate.url).hostname !== 'allowed.example') throw denied; },
    async fetch() { fetched++; throw new Error('mock must not use downstream transport'); },
  });
  await setup.run('route', ['**/*'], { body: 'local', status: '201' });
  const response = await binding.fetch(policyRequest());
  assert.equal(response.status, 201);
  assert.equal(new TextDecoder().decode(response.body), 'local');
  await response.release?.();
  await assert.rejects(binding.fetch(policyRequest('https://blocked.example/api')), error => error === denied);
  assert.equal(admissions.length, 2);
  assert.equal(fetched, 0);
  assert.equal(setup.handlers.length, 0);
  await binding.dispose();
});

test('bound route authority rewrites are readmitted and foreign targets never reach admission', async () => {
  const setup = fixture();
  const denied = new Error('rewritten authority denied');
  let admissions = 0;
  const binding = bindPlaywrightRoutePolicy(setup.context, {
    ownsRequest: candidate => candidate.targetId === 'owned',
    async admit(candidate) { admissions++; if (candidate.headers.some(header => header.name === 'host' && header.value === 'blocked.example')) throw denied; },
    async fetch() { throw new Error('must not forward denied rewrite'); },
  });
  await setup.run('route', ['**/*'], { header: 'Host: blocked.example' });
  await assert.rejects(binding.fetch({ ...policyRequest(), targetId: 'foreign' }), /bound context/);
  assert.equal(admissions, 0);
  await assert.rejects(binding.fetch(policyRequest()), error => error === denied);
  assert.equal(admissions, 2);
  await binding.dispose();
});

test('standard offline mode gates bound host transport but preserves admitted explicit mocks', async () => {
  const setup = fixture();
  let fetched = 0;
  let admitted = 0;
  const binding = bindPlaywrightRoutePolicy(setup.context, {
    ownsRequest: () => true, async admit() { admitted++; },
    async fetch() { fetched++; return { status: 200, headers: [], body: new Uint8Array() }; },
  });
  await playwrightStandardAbilities['network-state-set']!.execute(setup.request('network-state-set', ['offline']));
  await assert.rejects(binding.fetch(policyRequest()), /offline/);
  await setup.run('route', ['**/*'], { body: 'offline mock' });
  const mock = await binding.fetch(policyRequest());
  assert.equal(new TextDecoder().decode(mock.body), 'offline mock');
  await mock.release?.();
  assert.equal(fetched, 0);
  assert.equal(admitted, 2);
  await setup.run('unroute');
  await playwrightStandardAbilities['network-state-set']!.execute(setup.request('network-state-set', ['online']));
  const online = await binding.fetch(policyRequest());
  await online.release?.();
  assert.equal(fetched, 1);
  await binding.dispose();
});

test('policy routes cannot downgrade to native routing during context replacement', async () => {
  const old = fixture(), fresh = fixture();
  const host = { ownsRequest: () => true, async admit() {}, async fetch() { throw new Error('unused'); } };
  const binding = bindPlaywrightRoutePolicy(old.context, host);
  await old.run('route', ['**/*'], { body: 'retained' });
  const restore = capturePlaywrightRoutes(old.context)!;
  await assert.rejects(restore(fresh.context, cleanup => fresh.cleanups.push(cleanup)), /policy.*bound|bound.*policy/);
  assert.equal(fresh.handlers.length, 0);
  const replacement = bindPlaywrightRoutePolicy(fresh.context, host);
  await restore(fresh.context, cleanup => fresh.cleanups.push(cleanup));
  const response = await replacement.fetch(policyRequest());
  assert.equal(new TextDecoder().decode(response.body), 'retained');
  await response.release?.();
  await binding.dispose();
  await replacement.dispose();
  await assert.rejects(fresh.run('route', ['**/*']), /closed|disposed/);
});

test('route cleanup failures remain observable while logical registry closure prevents new registrations', async () => {
  const setup = fixture();
  await setup.run('route', ['**/*']);
  setup.setFail(true);
  await assert.rejects(setup.cleanups[0]!(), /removal failed/);
});

test('policy-backed routing does not require native route methods to be exposed', async () => {
  const setup = fixture();
  delete (setup.context as unknown as { route?: unknown }).route;
  delete (setup.context as unknown as { unroute?: unknown }).unroute;
  const binding = bindPlaywrightRoutePolicy(setup.context, { ownsRequest: () => true, async admit() {}, async fetch() { throw new Error('unused'); } });
  await setup.run('route', ['**/*'], { body: 'local' });
  const response = await binding.fetch(policyRequest());
  assert.equal(new TextDecoder().decode(response.body), 'local');
  await response.release?.();
  await binding.dispose();
});

test('policy response leases preserve owned bytes, concurrency, backpressure and idempotent release', async () => {
  const setup = fixture();
  let finish!: () => void;
  let released = 0;
  const bytes = Uint8Array.of(1, 2, 3);
  const binding = bindPlaywrightRoutePolicy(setup.context, {
    ownsRequest: () => true, async admit() {},
    async fetch() { return { status: 200, headers: [], body: bytes, async release() { released++; await new Promise<void>(resolve => { finish = resolve; }); } }; },
  }, { maxConcurrentRequests: 1 });
  const response = await binding.fetch(policyRequest());
  bytes.fill(9);
  assert.deepEqual([...response.body], [1, 2, 3]);
  await assert.rejects(binding.fetch(policyRequest()), /concurrent/);
  const releasing = response.release!();
  assert.equal(response.release!(), releasing);
  await assert.rejects(binding.fetch(policyRequest()), /concurrent/);
  let disposed = false;
  const disposal = binding.dispose().then(() => { disposed = true; });
  await new Promise<void>(resolve => { setImmediate(resolve); });
  assert.equal(disposed, false);
  finish();
  await releasing;
  await disposal;
  assert.equal(released, 1);
});

test('late canceled and oversized policy responses release downstream resources', async () => {
  const setup = fixture();
  let complete!: (response: { status: number; headers: []; body: Uint8Array; release(): void }) => void;
  let began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  let releases = 0;
  const binding = bindPlaywrightRoutePolicy(setup.context, {
    ownsRequest: () => true, async admit() {},
    async fetch() { began(); return new Promise(resolve => { complete = resolve; }); },
  }, { maxResponseBytes: 2 });
  const controller = new AbortController();
  const pending = binding.fetch(policyRequest(undefined, controller.signal));
  await started;
  controller.abort(0);
  const rejected = assert.rejects(pending, error => error === 0);
  complete({ status: 200, headers: [], body: Uint8Array.of(1), release() { releases++; } });
  await rejected;
  const oversized = binding.fetch(policyRequest());
  await new Promise<void>(resolve => { setImmediate(resolve); });
  const failed = assert.rejects(oversized, /body limit/);
  complete({ status: 200, headers: [], body: Uint8Array.of(1, 2, 3), release() { releases++; } });
  await failed;
  assert.equal(releases, 2);
  await binding.dispose();
});

test('policy route budgets fail closed and unroute restores retained capacity', async () => {
  const setup = fixture();
  const binding = bindPlaywrightRoutePolicy(setup.context, {
    ownsRequest: () => true, async admit() {}, async fetch() { return { status: 200, headers: [], body: new Uint8Array() }; },
  }, { maxRetainedBytes: 600, maxRequestBytes: 2, maxResponseBytes: 2 });
  await setup.run('route', ['**/*'], { body: 'a'.repeat(300) });
  await assert.rejects(setup.run('route', ['**/*'], { body: 'b'.repeat(300) }), /retained byte/);
  await setup.run('unroute');
  await setup.run('route', ['**/*'], { body: 'abc' });
  await assert.rejects(binding.fetch(policyRequest()), /byte limit/);
  await assert.rejects(binding.fetch({ ...policyRequest(), body: Uint8Array.of(1, 2, 3) }), /request body/);
  await setup.run('unroute');
  const response = await binding.fetch(policyRequest());
  await response.release?.();
  await binding.dispose();
});

test('policy routes preserve newest glob matching and do not share route authority between contexts', async () => {
  const first = fixture(), second = fixture();
  const host = { ownsRequest: () => true, async admit() {}, async fetch() { return { status: 200, headers: [], body: new TextEncoder().encode('transport') }; } };
  const binding = bindPlaywrightRoutePolicy(first.context, host);
  const other = bindPlaywrightRoutePolicy(second.context, host);
  await first.run('route', ['**/{api,users}'], { body: 'first' });
  await first.run('route', ['https://allowed.example/**/api'], { body: 'newest' });
  const response = await binding.fetch(policyRequest());
  assert.equal(new TextDecoder().decode(response.body), 'newest');
  await response.release?.();
  const isolated = await other.fetch(policyRequest());
  assert.equal(new TextDecoder().decode(isolated.body), 'transport');
  await isolated.release?.();
  await first.run('unroute', ['https://allowed.example/**/api']);
  const previous = await binding.fetch(policyRequest());
  assert.equal(new TextDecoder().decode(previous.body), 'first');
  await previous.release?.();
  await binding.dispose();
  await other.dispose();
});

test('the public Playwright entry exposes the explicit policy binding without auto-enabling it', () => {
  assert.equal(publicBindPlaywrightRoutePolicy, bindPlaywrightRoutePolicy);
});

test('policy binding rejects pending native route registration instead of mixing interceptors', async () => {
  const setup = fixture();
  let resume!: () => void;
  setup.holdRegistration(new Promise<void>(resolve => { resume = resolve; }));
  const pending = setup.run('route', ['**/*'], { body: 'native' });
  try {
    assert.throws(() => bindPlaywrightRoutePolicy(setup.context, { ownsRequest: () => true, async admit() {}, async fetch() { throw new Error('unused'); } }), /native routes/);
  } finally {
    resume();
    await pending;
    for (const cleanup of setup.cleanups) await cleanup();
  }
});
