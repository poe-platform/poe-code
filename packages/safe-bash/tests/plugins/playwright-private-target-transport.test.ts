import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlaywrightPrivateTargetTransport, type PlaywrightCDPTransport, type PlaywrightPrivateTargetTransportLimits } from '../../src/playwright/private-target-transport.js';

type Message = { id?: number; method?: string; sessionId?: string; params?: Record<string, any>; result?: Record<string, any>; error?: Record<string, any> };

function fixture(limits?: PlaywrightPrivateTargetTransportLimits) {
  const sent: Message[] = [];
  const received: Message[] = [];
  const reasons: (string | undefined)[] = [];
  let closes = 0;
  const upstream: PlaywrightCDPTransport = { send(message) { sent.push(message); }, close() { closes++; } };
  const adapter = createPlaywrightPrivateTargetTransport(upstream, limits);
  adapter.transport.onmessage = message => received.push(message);
  adapter.transport.onclose = reason => reasons.push(reason);
  const receive = upstream.onmessage!;
  const lose = upstream.onclose!;
  return { ...adapter, upstream, sent, received, reasons, receive, lose, closes: () => closes };
}

function attached(targetId: string, sessionId: string, parentSessionId?: string): Message {
  return { method: 'Target.attachedToTarget', ...(parentSessionId ? { sessionId: parentSessionId } : {}),
    params: { targetInfo: { targetId, type: 'page' }, sessionId, waitingForDebugger: true } };
}

test('creation holds attachments AND native creation replies in order', () => {
  const state = fixture();
  const guard = state.beginCreation();
  state.transport.send({ id: 41, method: 'Target.createTarget', params: { url: 'about:blank' } });
  const event = attached('public', 'public-session');
  state.receive(event);
  state.receive({ id: state.sent[0]!.id, result: { targetId: 'public' } });
  state.receive({ method: 'Target.targetCreated', params: { targetInfo: { targetId: 'scratch' } } });
  assert.deepEqual(state.received, []);
  guard.commit('scratch');
  assert.deepEqual(state.received, [event, { id: 41, result: { targetId: 'public' } }]);
  state.transport.close();
});

test('private native attachment detaches without any fabricated success or script registration', () => {
  const state = fixture();
  state.beginCreation().commit('scratch');
  state.receive(attached('scratch', 'private', 'browser-session'));
  assert.equal(state.sent[0]?.method, 'Target.detachFromTarget');
  assert.deepEqual(state.sent[0]?.params, { sessionId: 'private' });
  assert.deepEqual(state.received, []);
  state.receive({ id: state.sent[0]!.id, sessionId: 'browser-session', result: {} });
  state.receive({ method: 'Target.detachedFromTarget', params: { sessionId: 'private' } });
  state.receive({ method: 'Target.receivedMessageFromTarget', params: { sessionId: 'private', message: '{}' } });
  state.receive({ method: 'Runtime.executionContextCreated', sessionId: 'private', params: {} });
  assert.deepEqual(state.received, []);
  state.transport.close();
});

test('target lists and late info/destruction events retain exact tombstone privacy', () => {
  const state = fixture();
  const guard = state.beginCreation();
  state.transport.send({ id: 4, method: 'Target.getTargets' });
  state.receive({ id: state.sent[0]!.id, result: { targetInfos: [{ targetId: 'scratch' }, { targetId: 'public' }] } });
  guard.commit('scratch');
  assert.deepEqual(state.received, [{ id: 4, result: { targetInfos: [{ targetId: 'public' }] } }]);
  for (const method of ['Target.targetInfoChanged', 'Target.targetDestroyed', 'Target.targetCrashed']) {
    state.receive({ method, params: { targetId: 'scratch', targetInfo: { targetId: 'scratch' } } });
  }
  assert.equal(state.received.length, 1);
  state.transport.close();
});

test('private target and private session commands receive errors, never success', async () => {
  const state = fixture();
  state.beginCreation().commit('scratch');
  state.receive(attached('scratch', 'private'));
  state.receive({ id: state.sent[0]!.id, result: {} });
  state.transport.send({ id: 21, method: 'Target.getTargetInfo', params: { targetId: 'scratch' } });
  state.transport.send({ id: 22, sessionId: 'private', method: 'Page.addScriptToEvaluateOnNewDocument', params: { source: 'unsafe()' } });
  await Promise.resolve();
  assert.equal(state.sent.length, 1);
  assert.deepEqual(state.received.map(message => [message.id, message.result, message.error?.code]), [[21, undefined, -32000], [22, undefined, -32000]]);
  state.transport.close();
});

test('native response IDs are remapped independently across sessions and errors preserved', () => {
  const state = fixture();
  for (const sessionId of ['first', 'second']) state.transport.send({ id: 9, sessionId, method: 'Runtime.enable' });
  assert.notEqual(state.sent[0]!.id, state.sent[1]!.id);
  const error = { code: -32000, message: 'native error' };
  state.receive({ id: state.sent[1]!.id, sessionId: 'second', error });
  state.receive({ id: state.sent[0]!.id, sessionId: 'first', result: {} });
  assert.deepEqual(state.received, [{ id: 9, sessionId: 'second', error }, { id: 9, sessionId: 'first', result: {} }]);
  state.transport.close();
});

test('definite rejection rolls back while unknown outcome fails closed', () => {
  const state = fixture();
  const first = state.beginCreation();
  const event = attached('public', 'session');
  state.receive(event);
  first.rollback();
  assert.deepEqual(state.received, [event]);
  const second = state.beginCreation();
  state.receive(attached('unknown', 'unknown-session'));
  second.fail(new Error('Unknown creation outcome'));
  second.fail(new Error('Repeated failure'));
  assert.equal(state.closes(), 1);
  assert.equal(state.received.length, 1);
  assert.match(state.reasons[0]!, /Unknown creation outcome/);
});

test('nested and stale guards cannot resolve a different creation', () => {
  const state = fixture();
  const first = state.beginCreation();
  assert.throws(() => state.beginCreation(), /creation/i);
  first.rollback();
  const second = state.beginCreation();
  assert.throws(() => first.commit('wrong'), /active/i);
  second.commit('right');
  assert.equal(state.closes(), 0);
  state.transport.close();
});

test('held messages have independent ownership', () => {
  const state = fixture();
  const guard = state.beginCreation();
  const event = attached('public', 'session');
  state.receive(event);
  event.params!.targetInfo.targetId = 'scratch';
  guard.commit('scratch');
  assert.equal(state.received[0]?.params?.targetInfo.targetId, 'public');
  state.transport.close();
});

for (const [name, limits, messages] of [
  ['event count', { maxBufferedMessages: 1 }, [attached('one', 'one'), attached('two', 'two')]],
  ['event UTF-8 bytes', { maxBufferedBytes: 80 }, [{ method: 'Log.entryAdded', params: { text: '😀'.repeat(20) } }]],
  ['individual message bytes', { maxMessageBytes: 80 }, [{ method: 'Log.entryAdded', params: { text: '😀'.repeat(20) } }]],
] as const) {
  test(`${name} overflow retires without replay`, () => {
    const state = fixture(limits);
    state.beginCreation();
    for (const message of messages) state.receive(message);
    assert.equal(state.closes(), 1);
    assert.deepEqual(state.received, []);
  });
}

for (const limits of [{ maxPendingCommands: 1 }, { maxPendingBytes: 100 }]) {
  test(`pending commands are bounded by ${Object.keys(limits)[0]}`, () => {
    const state = fixture(limits);
    state.transport.send({ id: 1, method: 'Runtime.evaluate', params: { expression: 'hello' } });
    assert.throws(() => state.transport.send({ id: 2, method: 'Runtime.evaluate', params: { expression: 'world' } }), /pending/i);
    assert.equal(state.closes(), 1);
  });
}

for (const mode of ['creation', 'command', 'detach'] as const) {
  test(`${mode} timeout retires once and clears remaining timers`, context => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const state = fixture({ creationTimeoutMs: 10, commandTimeoutMs: 10 });
    if (mode === 'creation') state.beginCreation();
    else if (mode === 'command') state.transport.send({ id: 1, method: 'Runtime.enable' });
    else { state.beginCreation().commit('scratch'); state.receive(attached('scratch', 'private')); }
    context.mock.timers.tick(11);
    assert.equal(state.closes(), 1);
    context.mock.timers.tick(10000);
    assert.equal(state.reasons.length, 1);
  });
}

test('native detach failure retires rather than exposing or falsely acknowledging the target', () => {
  const state = fixture();
  state.beginCreation().commit('scratch');
  state.receive(attached('scratch', 'private'));
  state.receive({ id: state.sent[0]!.id, error: { code: -32000, message: 'Cannot detach' } });
  assert.equal(state.closes(), 1);
  assert.deepEqual(state.received, []);
});

test('retained target tombstones cap lifetime admission without evicting private identities', () => {
  const state = fixture({ maxPrivateTargets: 1 });
  state.beginCreation().commit('scratch');
  state.receive({ method: 'Target.targetDestroyed', params: { targetId: 'scratch' } });
  assert.throws(() => state.beginCreation(), /capacity/i);
  state.receive({ method: 'Target.targetInfoChanged', params: { targetInfo: { targetId: 'scratch' } } });
  assert.deepEqual(state.received, []);
  assert.equal(state.closes(), 0);
  state.transport.close();
});

test('session tombstones remain private and repeated attachment has a hard bound', () => {
  const state = fixture({ maxPrivateSessions: 1 });
  state.beginCreation().commit('scratch');
  state.receive(attached('scratch', 'first'));
  state.receive({ id: state.sent[0]!.id, result: {} });
  state.receive({ method: 'Target.detachedFromTarget', params: { sessionId: 'first' } });
  state.receive(attached('scratch', 'second'));
  assert.equal(state.closes(), 1);
  assert.deepEqual(state.received, []);
});

test('duplicate replies are ignored without retaining per-command tombstones; never-issued replies retire', () => {
  const state = fixture();
  state.transport.send({ id: 17, method: 'Runtime.enable' });
  const reply = { id: state.sent[0]!.id, result: {} };
  state.receive(reply);
  state.receive(reply);
  assert.equal(state.received.length, 1);
  state.receive({ id: 1000, result: {} });
  assert.equal(state.closes(), 1);
});

test('upstream loss, repeated close, stale callbacks and thrown close are idempotent', () => {
  const state = fixture();
  state.upstream.close = () => { throw new Error('already broken'); };
  state.lose('disconnected');
  state.transport.close();
  state.lose('late');
  state.receive(attached('public', 'late'));
  assert.equal(state.reasons.length, 1);
  assert.deepEqual(state.received, []);
});

test('send failure retires and preserves the synchronous failure', () => {
  const state = fixture();
  const failure = new Error('send broke');
  state.upstream.send = () => { throw failure; };
  assert.throws(() => state.transport.send({ id: 1, method: 'Runtime.enable' }), error => error === failure);
  assert.equal(state.closes(), 1);
});

test('invalid limits and identities fail before unsupported admission', () => {
  for (const value of [0, -1, NaN, Infinity, 1.5]) assert.throws(() => fixture({ maxBufferedBytes: value }), /limit/i);
  const state = fixture();
  assert.throws(() => state.beginCreation().commit(''), /identity/i);
  assert.equal(state.closes(), 1);
});

test('signed client command IDs used by native browser shutdown are remapped without special casing', () => {
  const state = fixture();
  state.transport.send({ id: -9999, method: 'Browser.close', params: {} });
  assert.ok(state.sent[0]!.id! > 0);
  state.receive({ id: state.sent[0]!.id, result: {} });
  assert.deepEqual(state.received, [{ id: -9999, result: {} }]);
  state.transport.close();
});

test('missing commit identity cannot silently behave like rollback', () => {
  const state = fixture();
  const guard = state.beginCreation();
  state.receive(attached('unresolved', 'unresolved-session'));
  assert.throws(() => guard.commit(undefined as unknown as string), /identity/i);
  assert.equal(state.closes(), 1);
  assert.deepEqual(state.received, []);
});

test('duplicate held replies do not consume the event budget twice', () => {
  const state = fixture({ maxBufferedMessages: 1 });
  const guard = state.beginCreation();
  state.transport.send({ id: 42, method: 'Target.getTargets' });
  const reply = { id: state.sent[0]!.id, result: { targetInfos: [{ targetId: 'public' }] } };
  state.receive(reply);
  state.receive(reply);
  guard.commit('scratch');
  assert.equal(state.received.length, 1);
  assert.equal(state.closes(), 0);
  state.transport.close();
});

test('pending byte admission is returned on native response completion', () => {
  const state = fixture({ maxPendingBytes: 60, maxPendingCommands: 1 });
  for (let index = 0; index < 3; index++) {
    state.transport.send({ id: index, method: 'Runtime.enable' });
    state.receive({ id: state.sent.at(-1)!.id, result: {} });
  }
  assert.equal(state.received.length, 3);
  assert.equal(state.closes(), 0);
  state.transport.close();
});

test('a response cannot be routed into a different native session', () => {
  const state = fixture();
  state.transport.send({ id: 1, method: 'Runtime.enable', sessionId: 'public' });
  state.receive({ id: state.sent[0]!.id, sessionId: 'foreign', result: {} });
  assert.equal(state.closes(), 1);
  assert.deepEqual(state.received, []);
});

test('native session-not-found errors reject only their original pending session once', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const state = fixture({ maxPendingCommands: 2, commandTimeoutMs: 10 });
  try {
    state.transport.send({ id: 7, method: 'Runtime.evaluate', sessionId: 'retired' });
    state.transport.send({ id: 7, method: 'Runtime.evaluate', sessionId: 'sibling' });
    const error = { code: -32001, message: 'Session with given id not found.' };
    const reply = { id: state.sent[0]!.id, error };
    state.receive(reply);
    state.receive(reply);
    state.receive({ id: state.sent[1]!.id, sessionId: 'sibling', result: { value: 42 } });
    assert.deepEqual(state.received, [
      { id: 7, sessionId: 'retired', error },
      { id: 7, sessionId: 'sibling', result: { value: 42 } },
    ]);
    context.mock.timers.tick(11);
    assert.equal(state.closes(), 0);
    state.transport.send({ id: 7, method: 'Runtime.evaluate', sessionId: 'retired' });
    state.receive(reply);
    assert.equal(state.received.length, 2);
    state.receive({ id: state.sent[2]!.id, error });
    assert.equal(state.received.length, 3);
    context.mock.timers.tick(11);
    assert.equal(state.closes(), 0);
  } finally { state.transport.close(); }
});

test('native session-not-found completion releases the exact pending byte budget', () => {
  const state = fixture({ maxPendingCommands: 1, maxPendingBytes: 53 });
  try {
    for (let index = 0; index < 3; index++) {
      state.transport.send({ id: index, method: 'Runtime.enable', sessionId: 'gone' });
      state.receive({ id: state.sent.at(-1)!.id, error: { code: -32001, message: 'Session with given id not found.' } });
    }
    assert.equal(state.received.length, 3);
    assert.equal(state.closes(), 0);
  } finally { state.transport.close(); }
});

test('held native session-not-found replies retain bounded bytes and original ownership', () => {
  const error = { code: -32001, message: 'Session with given id not found.' };
  const bytes = new TextEncoder().encode(JSON.stringify({ id: 1, error })).byteLength;
  const state = fixture({ maxBufferedBytes: bytes, maxBufferedMessages: 1, maxPendingCommands: 1 });
  try {
    for (let index = 0; index < 3; index++) {
      const guard = state.beginCreation();
      state.transport.send({ id: 7, method: 'Target.getTargetInfo', sessionId: 'retired' });
      const reply = { id: state.sent.at(-1)!.id, error };
      state.receive(reply);
      state.receive(reply);
      assert.equal(state.received.length, index);
      assert.equal(state.closes(), 0);
      guard.commit(`scratch-${index}`);
      assert.deepEqual(state.received.at(-1), { id: 7, sessionId: 'retired', error });
    }
  } finally { state.transport.close(); }
});

test('sessionless errors cannot bypass native private detach failure', () => {
  const state = fixture();
  state.beginCreation().commit('scratch');
  state.receive(attached('scratch', 'private', 'retired-parent'));
  state.receive({ id: state.sent[0]!.id, error: { code: -32001, message: 'Session with given id not found.' } });
  assert.equal(state.closes(), 1);
  assert.deepEqual(state.reasons, ['Native private target detach failed']);
  assert.deepEqual(state.received, []);
});

for (const [name, response] of Object.entries({
  'root success': { result: {} },
  'other error': { error: { code: -32000, message: 'Session with given id not found.' } },
  'other message': { error: { code: -32001, message: 'Target closed' } },
  'foreign session': { sessionId: 'foreign', error: { code: -32001, message: 'Session with given id not found.' } },
  'mixed result': { result: {}, error: { code: -32001, message: 'Session with given id not found.' } },
  'mixed event': { method: 'Target.targetDestroyed', error: { code: -32001, message: 'Session with given id not found.' } },
  'mixed params': { params: {}, error: { code: -32001, message: 'Session with given id not found.' } },
  'extra error data': { error: { code: -32001, message: 'Session with given id not found.', data: 'foreign' } },
  'extra envelope data': { extra: true, error: { code: -32001, message: 'Session with given id not found.' } },
})) {
  test(`session-not-found exception still rejects ${name}`, () => {
    const state = fixture();
    state.transport.send({ id: 7, method: 'Runtime.evaluate', sessionId: 'retired' });
    state.receive({ id: state.sent[0]!.id, ...response });
    assert.equal(state.closes(), 1);
    assert.deepEqual(state.reasons, ['Native CDP response session mismatch']);
    assert.deepEqual(state.received, []);
  });
}

test('session-not-found without an issued native ID retires instead of guessing an owner', () => {
  const state = fixture();
  state.transport.send({ id: 7, method: 'Runtime.evaluate', sessionId: 'retired' });
  state.receive({ id: 1000, error: { code: -32001, message: 'Session with given id not found.' } });
  assert.equal(state.closes(), 1);
  assert.deepEqual(state.reasons, ['Never-issued native CDP reply']);
  assert.deepEqual(state.received, []);
});

test('child sessions under private sessions inherit privacy and real detach', () => {
  const state = fixture();
  state.beginCreation().commit('scratch');
  state.receive(attached('scratch', 'private'));
  state.receive(attached('child', 'child-session', 'private'));
  assert.equal(state.sent.length, 2);
  assert.deepEqual(state.sent[1]!.params, { sessionId: 'child-session' });
  state.receive({ id: state.sent[0]!.id, result: {} });
  state.receive({ id: state.sent[1]!.id, sessionId: 'private', result: {} });
  state.receive({ method: 'Target.targetInfoChanged', params: { targetInfo: { targetId: 'child' } } });
  assert.deepEqual(state.received, []);
  state.transport.close();
});

test('open is forwarded once and downstream callback failure retires', () => {
  const state = fixture();
  let opens = 0;
  state.upstream.open = () => { opens++; };
  state.transport.open?.();
  state.transport.open?.();
  assert.equal(opens, 1);
  state.transport.onmessage = () => { throw new Error('Client callback failed'); };
  state.receive(attached('public', 'session'));
  assert.equal(state.closes(), 1);
});
