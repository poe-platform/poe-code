import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { installPlaywrightNetworkPolicy } from '../../src/commands/playwright/index.js';

class Socket {
  events = new EventEmitter();
  sent: any[] = [];
  addEventListener(name: string, listener: (...args: any[]) => void) { this.events.on(name, listener); }
  removeEventListener(name: string, listener: (...args: any[]) => void) { this.events.off(name, listener); }
  send(text: string) {
    const message = JSON.parse(text);
    this.sent.push(message);
    queueMicrotask(() => this.receive({ id: message.id, result: message.method === 'Target.getTargets' ? { targetInfos: [] } : {} }));
  }
  close() { this.events.emit('close'); }
  receive(message: unknown) { this.events.emit('message', { data: JSON.stringify(message) }); }
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('policy arms every target before resume and never continues a browser request', async () => {
  const socket = new Socket();
  let retired = 0;
  const requests: any[] = [];
  const policy = await installPlaywrightNetworkPolicy({
    socket, directNetwork: 'blocked-by-host', retire: async () => { retired++; },
    fetch: async request => { requests.push(request); return { status: 302, headers: [{ name: 'location', value: '/next' }], body: new Uint8Array() }; },
  });
  socket.receive({ method: 'Target.attachedToTarget', params: { sessionId: 'page-session', waitingForDebugger: true, targetInfo: { targetId: 'page', type: 'page', url: '' } } });
  await tick();
  const methods = socket.sent.filter(m => m.sessionId === 'page-session').map(m => m.method);
  assert.ok(methods.indexOf('Fetch.enable') < methods.indexOf('Runtime.runIfWaitingForDebugger'));
  assert.ok(methods.indexOf('Target.setAutoAttach') < methods.indexOf('Runtime.runIfWaitingForDebugger'));
  for (const [requestId, url] of [['one', 'https://allowed.example/start'], ['two', 'https://allowed.example/next']]) {
    socket.receive({ sessionId: 'page-session', method: 'Fetch.requestPaused', params: { requestId, frameId: 'frame', networkId: requestId, resourceType: 'Document', request: { url, method: 'GET', headers: {} } } });
    await tick();
  }
  assert.equal(requests.length, 2);
  assert.equal(socket.sent.filter(m => m.method === 'Fetch.fulfillRequest').length, 2);
  assert.equal(socket.sent.some(m => m.method === 'Fetch.continueRequest'), false);
  await policy.dispose();
  await policy.dispose();
  assert.equal(retired, 1);
});

test('network cancellation aborts the exact host request; failures report stable IDs and bounded messages', async () => {
  const socket = new Socket();
  const signals: AbortSignal[] = [];
  const failures: any[] = [];
  const policy = await installPlaywrightNetworkPolicy({
    socket, directNetwork: 'blocked-by-host', retire: async () => {},
    onRequestFailure: failure => { failures.push(failure); },
    fetch: request => new Promise((_resolve, reject) => {
      signals.push(request.signal);
      request.signal.addEventListener('abort', () => reject(new Error('x'.repeat(5000))), { once: true });
    }),
  });
  socket.receive({ method: 'Target.attachedToTarget', params: { sessionId: 's', waitingForDebugger: true, targetInfo: { targetId: 'target', type: 'page', url: '' } } });
  await tick();
  socket.receive({ sessionId: 's', method: 'Fetch.requestPaused', params: { requestId: 'fetch', networkId: 'network', frameId: 'frame', resourceType: 'Document', request: { url: 'https://allowed.example', method: 'GET', headers: {} } } });
  await tick();
  socket.receive({ sessionId: 's', method: 'Network.loadingFailed', params: { requestId: 'network' } });
  await tick();
  assert.equal(signals[0]?.aborted, true);
  assert.equal(failures[0]?.targetId, 'target');
  assert.equal(failures[0]?.frameId, 'frame');
  assert.equal(failures[0]?.requestId, 'network');
  assert.ok(failures[0]?.message.length <= 1024);
  await policy.dispose();
});

test('transport loss retires the browser and drains cooperative fetch cancellation', async () => {
  const socket = new Socket();
  let retired = 0;
  const policy = await installPlaywrightNetworkPolicy({ socket, directNetwork: 'blocked-by-host', retire: async () => { retired++; }, fetch: async () => { throw new Error('denied'); } });
  socket.close();
  await policy.dispose();
  assert.equal(retired, 1);
  assert.equal(socket.events.listenerCount('message'), 0);
});

test('failure to reject a live paused request retires the browser', async () => {
  const socket = new Socket();
  const send = socket.send.bind(socket);
  socket.send = text => {
    const message = JSON.parse(text);
    if (message.method === 'Fetch.failRequest') queueMicrotask(() => socket.receive({ id: message.id, error: { message: 'interceptor failed' } }));
    else send(text);
  };
  let retired = 0;
  const policy = await installPlaywrightNetworkPolicy({ socket, directNetwork: 'blocked-by-host', retire: async () => { retired++; }, fetch: async () => { throw new Error('denied'); } });
  socket.receive({ method: 'Target.attachedToTarget', params: { sessionId: 's', waitingForDebugger: true, targetInfo: { targetId: 'target', type: 'page', url: '' } } });
  await tick();
  socket.receive({ sessionId: 's', method: 'Fetch.requestPaused', params: { requestId: 'fetch', request: { url: 'https://allowed.example', method: 'GET', headers: {} } } });
  await tick();
  assert.equal(retired, 1);
  await policy.dispose();
});

test('retirement rejection still drains cooperative host cleanup', async () => {
  const socket = new Socket();
  let finishCleanup!: () => void;
  const cleanup = new Promise<void>(resolve => { finishCleanup = resolve; });
  const policy = await installPlaywrightNetworkPolicy({
    socket, directNetwork: 'blocked-by-host', retire: async () => { throw new Error('retirement failed'); },
    fetch: request => new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => { void cleanup.then(() => reject(request.signal.reason)); }, { once: true })),
  });
  socket.receive({ method: 'Target.attachedToTarget', params: { sessionId: 's', waitingForDebugger: true, targetInfo: { targetId: 'target', type: 'page', url: '' } } });
  await tick();
  socket.receive({ sessionId: 's', method: 'Fetch.requestPaused', params: { requestId: 'fetch', request: { url: 'https://allowed.example', method: 'GET', headers: {} } } });
  await tick();
  let settled = false;
  const disposal = policy.dispose().catch(error => { settled = true; throw error; });
  const rejected = assert.rejects(disposal, /retirement failed/);
  await tick();
  try { assert.equal(settled, false); }
  finally { finishCleanup(); }
  await rejected;
  assert.equal(socket.events.listenerCount('message'), 1, 'unconfirmed retirement must retain interception');
});

test('request overflow retires before allocating unbounded rejection work', async () => {
  const socket = new Socket();
  let retired = 0;
  const policy = await installPlaywrightNetworkPolicy({
    socket, directNetwork: 'blocked-by-host', maxConcurrentRequests: 1, retire: async () => { retired++; },
    fetch: request => new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true })),
  });
  socket.receive({ method: 'Target.attachedToTarget', params: { sessionId: 's', waitingForDebugger: true, targetInfo: { targetId: 'target', type: 'page', url: '' } } });
  await tick();
  const send = socket.send.bind(socket);
  socket.send = text => { if (JSON.parse(text).method !== 'Fetch.failRequest') send(text); };
  try {
    for (let index = 0; index < 20; index++) socket.receive({ sessionId: 's', method: 'Fetch.requestPaused', params: { requestId: String(index), request: { url: 'https://allowed.example', method: 'GET', headers: {} } } });
    await tick();
    assert.equal(retired, 1);
  } finally { await policy.dispose(); }
});

test('header and body limits reject before protocol fulfillment', async () => {
  const socket = new Socket();
  const failures: any[] = [];
  let oversizedBody = false;
  const policy = await installPlaywrightNetworkPolicy({
    socket, directNetwork: 'blocked-by-host', maxResponseBytes: 2, retire: async () => {},
    onRequestFailure: failure => failures.push(failure),
    fetch: async () => ({ status: 200, headers: [{ name: 'x-fixture', value: oversizedBody ? 'ok' : 'x'.repeat(65537) }], body: new Uint8Array(oversizedBody ? 3 : 0) }),
  });
  socket.receive({ method: 'Target.attachedToTarget', params: { sessionId: 's', waitingForDebugger: true, targetInfo: { targetId: 'target', type: 'page', url: '' } } });
  await tick();
  try {
    for (const body of [false, true]) {
      oversizedBody = body;
      socket.receive({ sessionId: 's', method: 'Fetch.requestPaused', params: { requestId: String(body), request: { url: 'https://allowed.example', method: 'GET', headers: {} } } });
      await tick();
    }
    assert.equal(failures.length, 2);
    assert.equal(socket.sent.some(message => message.method === 'Fetch.fulfillRequest'), false);
  } finally { await policy.dispose(); }
});
