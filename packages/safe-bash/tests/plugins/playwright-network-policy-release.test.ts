import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { installPlaywrightNetworkPolicy, type PlaywrightNetworkPolicyOptions, type PlaywrightPolicyResponse } from '../../src/playwright/network-policy.js';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const body = () => ({ status: 200, headers: [], body: new Uint8Array([1]) });

async function fixture(fetch: PlaywrightNetworkPolicyOptions['fetch']) {
  const events = new EventEmitter();
  const replies: number[] = [];
  let retired = 0;
  const acknowledge = (id: number) => events.emit('message', { data: JSON.stringify({ id, result: {} }) });
  const socket = {
    addEventListener: events.on.bind(events), removeEventListener: events.off.bind(events),
    close() { events.emit('close'); },
    send(text: string) {
      const command = JSON.parse(text);
      if (command.method === 'Fetch.fulfillRequest') replies.push(command.id);
      else queueMicrotask(() => acknowledge(command.id));
    },
  };
  const policy = await installPlaywrightNetworkPolicy({ socket, directNetwork: 'http-blocked-by-host', fetch,
    retire: async () => { retired++; } });
  events.emit('message', { data: JSON.stringify({ method: 'Target.attachedToTarget', params: {
    sessionId: 's', waitingForDebugger: true, targetInfo: { targetId: 'page', type: 'page', url: '' },
  } }) });
  await tick();
  return { policy, replies, acknowledge, retired: () => retired, paused(id: string) {
    events.emit('message', { data: JSON.stringify({ sessionId: 's', method: 'Fetch.requestPaused', params: {
      requestId: id, request: { url: 'https://allowed.example/' + id, method: 'GET', headers: {} },
    } }) });
  } };
}

test('response release waits for browser delivery acknowledgement and runs once', async () => {
  let released = 0;
  const f = await fixture(async () => ({ ...body(), release() { released++; } }));
  try {
    f.paused('one'); await tick();
    assert.equal(f.replies.length, 1);
    assert.equal(released, 0);
    f.acknowledge(f.replies.shift()!); await tick();
    assert.equal(released, 1);
  } finally { await f.policy.dispose(); }
  assert.equal(released, 1);
});

test('four host delivery permits bound retained responses without retiring an eight-request burst', async () => {
  let active = 0, peak = 0, completed = 0;
  const waiters: (() => void)[] = [];
  const f = await fixture(async request => {
    if (active === 4) await new Promise<void>((resolve, reject) => {
      const abort = () => reject(request.signal.reason);
      request.signal.addEventListener('abort', abort, { once: true });
      waiters.push(() => { request.signal.removeEventListener('abort', abort); resolve(); });
    });
    request.signal.throwIfAborted();
    active++; peak = Math.max(peak, active); completed++;
    return { ...body(), release() { active--; waiters.shift()?.(); } };
  });
  try {
    for (let index = 0; index < 8; index++) f.paused(String(index));
    await tick();
    assert.equal(completed, 4); assert.equal(f.replies.length, 4);
    for (const id of f.replies.splice(0)) f.acknowledge(id);
    await tick();
    assert.equal(completed, 8); assert.equal(f.replies.length, 4);
    assert.equal(peak, 4); assert.equal(f.retired(), 0);
    for (const id of f.replies.splice(0)) f.acknowledge(id);
    await tick(); assert.equal(active, 0);
  } finally { await f.policy.dispose(); }
});

test('invalid responses still release, and disposal drains asynchronous release', async () => {
  let finish!: () => void;
  const held = new Promise<void>(resolve => { finish = resolve; });
  let released = 0;
  const f = await fixture(async () => ({ ...body(), status: 99, release() { released++; return held; } }));
  f.paused('invalid'); await tick();
  let disposed = false;
  const disposal = f.policy.dispose().then(() => { disposed = true; });
  try {
    await tick(); assert.equal(released, 1); assert.equal(disposed, false);
  } finally { finish(); await disposal; }
});

test('a response arriving after cancellation still releases its host permit', async () => {
  let finish!: (response: PlaywrightPolicyResponse) => void;
  let released = 0;
  const f = await fixture(() => new Promise(resolve => { finish = resolve; }));
  f.paused('late'); await tick();
  const disposal = f.policy.dispose();
  finish({ ...body(), release() { released++; } });
  await disposal;
  assert.equal(released, 1);
});

test('release rejection retires the browser and remains observable through disposal', async () => {
  const failure = new Error('host release failed');
  const f = await fixture(async () => ({ ...body(), release() { throw failure; } }));
  f.paused('failure'); await tick();
  f.acknowledge(f.replies.shift()!); await tick();
  await assert.rejects(f.policy.dispose(), error => error === failure);
  assert.equal(f.retired(), 1);
});
