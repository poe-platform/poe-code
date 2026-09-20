import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test, type TestContext } from 'node:test';
import { installPlaywrightNetworkPolicy, type PlaywrightNetworkPolicyOptions } from '../../src/playwright/network-policy.js';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const bytes = new Uint8Array([0, 255, 128, 13, 10, 65]);
const upload = () => ({ url: 'https://allowed.example/upload', method: 'POST', headers: { 'x-upload': 'binary' },
  hasPostData: true, postData: 'lossy text is not the body',
  postDataEntries: [{ bytes: btoa(String.fromCharCode(...bytes.subarray(0, 3))) }, { bytes: btoa(String.fromCharCode(...bytes.subarray(3))) }] });

async function fixture(context: TestContext, fetch: PlaywrightNetworkPolicyOptions['fetch'], options: Partial<PlaywrightNetworkPolicyOptions> = {}) {
  const events = new EventEmitter();
  const parsedRequests = new Map<string, Record<string, unknown>>();
  const parse = JSON.parse;
  context.mock.method(JSON, 'parse', (text: string, reviver?: Parameters<typeof JSON.parse>[1]) => {
    const message = parse(text, reviver);
    if (message.method === 'Fetch.requestPaused') parsedRequests.set(message.params.requestId, message.params.request);
    return message;
  });
  const held = new Map<number, { method: string; params: { requestId: string } }>();
  const failures: { requestId: string; message: string }[] = [];
  let retired = 0;
  const receive = (message: unknown) => events.emit('message', { data: JSON.stringify(message) });
  const acknowledge = (id: number, error?: string) => {
    held.delete(id);
    receive({ id, ...(error ? { error: { message: error } } : { result: {} }) });
  };
  const socket = {
    addEventListener: events.on.bind(events), removeEventListener: events.off.bind(events),
    close() { events.emit('close'); },
    send(text: string) {
      const command = JSON.parse(text);
      assert.notEqual(command.method, 'Fetch.continueRequest');
      if (command.method === 'Fetch.failRequest' || command.method === 'Fetch.fulfillRequest') held.set(command.id, command);
      else queueMicrotask(() => acknowledge(command.id));
    },
  };
  const policy = await installPlaywrightNetworkPolicy({ socket, directNetwork: 'http-blocked-by-host', fetch,
    retire: async () => { retired++; }, onRequestFailure: failure => {
      failures.push({ requestId: failure.requestId, message: failure.message });
    }, ...options });
  receive({ method: 'Target.attachedToTarget', params: {
    sessionId: 'session', waitingForDebugger: true, targetInfo: { targetId: 'page', type: 'page', url: '' },
  } });
  await tick();
  return { policy, held, failures, parsedRequests, acknowledge, retired: () => retired, receive,
    paused(id: string, request: Record<string, unknown> = upload()) {
      receive({ sessionId: 'session', method: 'Fetch.requestPaused', params: {
        requestId: id, networkId: 'network-' + id, frameId: 'frame', resourceType: 'Fetch', request,
      } });
    } };
}

function assertDiscarded(request: Record<string, unknown>) {
  assert.equal(Object.hasOwn(request, 'postData'), false, 'parsed postData must be discarded before asynchronous work');
  assert.equal(Object.hasOwn(request, 'postDataEntries'), false, 'parsed postDataEntries must be discarded before asynchronous work');
}

for (const body of [Uint8Array.from({ length: 256 }, (_, index) => index), new Uint8Array(), undefined]) {
  test(`preserves ${body === undefined ? 'absent' : body.length === 0 ? 'empty' : 'all byte values in'} upload bodies until delivery`, async context => {
    let released = 0;
    const fixtureState = await fixture(context, async request => {
      assertDiscarded(fixtureState.parsedRequests.get('binary')!);
      assert.deepEqual(request.body, body);
      return { status: 200, headers: [], body: new Uint8Array(), release() { released++; } };
    });
    try {
      fixtureState.paused('binary', body === undefined ? { url: upload().url, method: 'GET', headers: {} } : {
        ...upload(), postDataEntries: [
          { bytes: btoa(String.fromCharCode(...body.subarray(0, 99))) },
          { bytes: btoa(String.fromCharCode(...body.subarray(99))) },
        ],
      });
      await tick();
      assert.deepEqual(fixtureState.failures, []);
      assert.equal(fixtureState.held.size, 1);
      assert.equal([...fixtureState.held.values()][0]!.method, 'Fetch.fulfillRequest');
      assert.equal(released, 0);
      fixtureState.acknowledge([...fixtureState.held.keys()][0]!);
      await tick();
      assert.equal(released, 1);
    } finally { await fixtureState.policy.dispose(); }
    assert.equal(released, 1);
  });
}

test('discards serialized uploads with 48 admission rejections held, preserving four transfers and twelve queued requests', async context => {
  let finishTransfers!: () => void;
  const transfers = new Promise<void>(resolve => { finishTransfers = resolve; });
  let pending = 0, active = 0, hostFetches = 0, decodedRequests = 0, releases = 0;
  const waiters: (() => void)[] = [];
  const fixtureState = await fixture(context, async request => {
    decodedRequests++;
    assert.deepEqual(request.body, bytes);
    assert.equal(request.method, 'POST');
    assert.deepEqual(request.headers, [{ name: 'x-upload', value: 'binary' }]);
    if (pending === 16) throw new Error('Host pending-request body limit exceeded');
    pending++;
    try {
      if (active === 4) await new Promise<void>((resolve, reject) => {
        const ready = () => { request.signal.removeEventListener('abort', abort); resolve(); };
        const abort = () => { waiters.splice(waiters.indexOf(ready), 1); reject(request.signal.reason); };
        waiters.push(ready);
        request.signal.addEventListener('abort', abort, { once: true });
      });
      request.signal.throwIfAborted();
    } catch (error) { pending--; throw error; }
    active++; hostFetches++;
    await transfers;
    return { status: 200, headers: [], body: bytes, release() {
      releases++; active--; pending--; waiters.shift()?.();
    } };
  });
  try {
    for (let index = 0; index < 64; index++) fixtureState.paused(String(index));
    await tick();
    assert.equal(decodedRequests, 64);
    assert.equal(hostFetches, 4);
    assert.equal(waiters.length, 12);
    assert.equal(pending, 16);
    assert.equal(fixtureState.failures.length, 48);
    assert.ok(fixtureState.failures.every(failure => failure.message === 'Host pending-request body limit exceeded'));
    assert.equal(fixtureState.held.size, 48);
    assert.ok([...fixtureState.held.values()].every(command => command.method === 'Fetch.failRequest'));
    assert.equal(fixtureState.retired(), 0);
    for (const request of fixtureState.parsedRequests.values()) assertDiscarded(request);
    context.diagnostic('64 decoded binary uploads; 4 transfers + 12 queued; 48 held failure acknowledgments; all 64 parsed requests have no serialized upload fields. Object reachability assertion, not an RSS measurement.');
    finishTransfers();
    for (let batch = 0; batch < 4; batch++) {
      await tick();
      const replies = [...fixtureState.held].filter(([, command]) => command.method === 'Fetch.fulfillRequest');
      assert.equal(replies.length, 4);
      assert.equal(releases, batch * 4);
      assert.equal(pending, 16 - batch * 4);
      for (const [id] of replies) fixtureState.acknowledge(id);
    }
    await tick();
    assert.equal(hostFetches, 16);
    assert.equal(releases, 16);
    assert.equal(pending, 0);
    assert.equal(fixtureState.held.size, 48);
    assert.equal(fixtureState.retired(), 0);
    for (const id of fixtureState.held.keys()) fixtureState.acknowledge(id);
    await tick();
  } finally { finishTransfers(); await fixtureState.policy.dispose(); }
  assert.equal(fixtureState.retired(), 1);
});

for (const scenario of [
  { name: 'invalid URL', request: { url: 'not a URL' }, error: 'Invalid URL' },
  { name: 'unsupported URL protocol', request: { url: 'file:///upload' }, error: 'Unsupported browser network protocol' },
  { name: 'missing binary entries', request: { postDataEntries: undefined }, error: 'Browser did not supply complete binary request body' },
  { name: 'incomplete binary entries', request: { postDataEntries: [{}] }, error: 'Browser did not supply complete binary request body' },
  { name: 'invalid base64', request: { postDataEntries: [{ bytes: '%' }] }, error: 'Invalid character' },
  { name: 'encoded body limit', request: { postDataEntries: [{ bytes: btoa('123456789') }] }, error: 'Host request body limit exceeded', maxRequestBytes: 4 },
  { name: 'aggregate decoded body limit', request: {}, error: 'Host request body limit exceeded', maxRequestBytes: 4 },
  { name: 'invalid headers', request: { headers: { oversized: 'x'.repeat(65537) } }, error: 'Invalid or oversized host header' },
]) {
  test(`discards serialized uploads before held rejection for ${scenario.name}`, async context => {
    let fetched = 0;
    const fixtureState = await fixture(context, async () => {
      fetched++; return { status: 200, headers: [], body: bytes };
    }, scenario.maxRequestBytes === undefined ? {} : { maxRequestBytes: scenario.maxRequestBytes });
    try {
      fixtureState.paused('invalid', { ...upload(), ...scenario.request });
      await tick();
      assert.equal(fetched, 0);
      assert.deepEqual(fixtureState.failures, [{ requestId: 'network-invalid', message: scenario.error }]);
      assert.equal(fixtureState.held.size, 1);
      assertDiscarded(fixtureState.parsedRequests.get('invalid')!);
      assert.equal(fixtureState.retired(), 0);
      fixtureState.acknowledge([...fixtureState.held.keys()][0]!);
      await tick();
    } finally { await fixtureState.policy.dispose(); }
  });
}

for (const asynchronous of [false, true]) {
  test(`discards serialized uploads before ${asynchronous ? 'asynchronous' : 'synchronous'} host rejection and retires on failed acknowledgement`, async context => {
    const fixtureState = await fixture(context, request => {
      assert.deepEqual(request.body, bytes);
      assertDiscarded(fixtureState.parsedRequests.get('denied')!);
      if (asynchronous) return Promise.reject(new Error('Host rejected upload'));
      throw new Error('Host rejected upload');
    });
    try {
      fixtureState.paused('denied');
      await tick();
      assert.deepEqual(fixtureState.failures, [{ requestId: 'network-denied', message: 'Host rejected upload' }]);
      assert.equal(fixtureState.held.size, 1);
      assertDiscarded(fixtureState.parsedRequests.get('denied')!);
      fixtureState.acknowledge([...fixtureState.held.keys()][0]!, 'Cannot fail paused request');
      await tick();
      assert.equal(fixtureState.retired(), 1);
    } finally { await fixtureState.policy.dispose(); }
  });
}

test('upload cancellation preserves network identity and ignores a canceled failure acknowledgement', async context => {
  let signal!: AbortSignal;
  const fixtureState = await fixture(context, request => new Promise((_resolve, reject) => {
    signal = request.signal;
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  try {
    fixtureState.paused('canceled');
    assertDiscarded(fixtureState.parsedRequests.get('canceled')!);
    fixtureState.receive({ sessionId: 'session', method: 'Network.loadingFailed', params: { requestId: 'network-canceled' } });
    await tick();
    assert.equal(signal.aborted, true);
    assert.deepEqual(fixtureState.failures, [{ requestId: 'network-canceled', message: 'Browser request canceled' }]);
    assert.equal(fixtureState.held.size, 1);
    fixtureState.acknowledge([...fixtureState.held.keys()][0]!, 'Request already canceled');
    await tick();
    assert.equal(fixtureState.retired(), 0);
  } finally { await fixtureState.policy.dispose(); }
});

test('held upload failure acknowledgements still time out and retire the browser', async context => {
  const fixtureState = await fixture(context, async () => { throw new Error('Host rejected upload'); });
  context.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    fixtureState.paused('timeout');
    await tick();
    assert.equal(fixtureState.held.size, 1);
    assertDiscarded(fixtureState.parsedRequests.get('timeout')!);
    context.mock.timers.tick(10000);
    await tick();
    assert.equal(fixtureState.retired(), 1);
    await fixtureState.policy.dispose();
  } finally { await fixtureState.policy.dispose(); }
});
