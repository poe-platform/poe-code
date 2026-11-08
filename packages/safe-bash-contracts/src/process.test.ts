import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProcessSignalChannel } from './process.js';

test('ordered signal delivery awaits acceptance and stays distinct from cancellation', async () => {
  const channel = createProcessSignalChannel();
  const received: bigint[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const unsubscribe = channel.subscribe(async event => {
    received.push(event.sequence);
    if (event.sequence === 1n) await gate;
    return { sequence: event.sequence };
  });
  const first = channel.send({ name: 'SIGINT', number: 2, target: 'process-group' });
  const second = channel.send({ name: 'SIGTERM', number: 15, target: 'process-group' });
  await Promise.resolve();
  assert.deepEqual(received, [1n]);
  release();
  assert.deepEqual(await Promise.all([first, second]), [{ sequence: 1n }, { sequence: 2n }]);
  await unsubscribe();
  await assert.rejects(channel.send({ name: 'SIGINT', number: 2, target: 'process-group' }), /subscriber/);
});

test('signal admission snapshots requests, bounds pending work and drains before resubscription', async () => {
  const channel = createProcessSignalChannel();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const received: string[] = [];
  const unsubscribe = channel.subscribe(async event => {
    await gate;
    received.push(event.name);
    return { sequence: event.sequence };
  });
  const request = { name: 'SIGINT', number: 2, target: 'process-group' as const };
  const admitted = Array.from({ length: 64 }, () => channel.send(request));
  request.name = 'SIGTERM';
  await assert.rejects(channel.send(request), /limit/);
  const cleanup = unsubscribe();
  assert.throws(() => channel.subscribe(async event => ({ sequence: event.sequence })), /active/);
  release(); await Promise.all(admitted); await cleanup;
  assert.deepEqual(received, Array.from({ length: 64 }, () => 'SIGINT'));
  const next = channel.subscribe(async event => ({ sequence: event.sequence }));
  assert.deepEqual(await channel.send(request), { sequence: 65n });
  await next();
});

test('signal acceptance rejects mismatched sequence and invalid requests', async () => {
  const channel = createProcessSignalChannel();
  const unsubscribe = channel.subscribe(async () => ({ sequence: 0n }));
  await assert.rejects(channel.send({ name: 'SIGINT', number: 2, target: 'process-group' }), /sequence conflict/);
  await assert.rejects(channel.send({ name: 'SIGINT', number: 0, target: 'process-group' }), /Invalid/);
  await unsubscribe();
});

test('signal admission validates the exact request snapshot delivered to the invocation', async () => {
  const channel = createProcessSignalChannel();
  const received: string[] = [];
  const unsubscribe = channel.subscribe(async event => {
    received.push(event.name);
    return { sequence: event.sequence };
  });
  const reads = { name: 0, number: 0, target: 0 };
  try {
    await channel.send({
      get name() { return ++reads.name === 1 ? 'SIGINT' : '\0'; },
      get number() { return ++reads.number === 1 ? 2 : 0; },
      get target(): 'process-group' { reads.target++; return 'process-group'; },
    });
    assert.deepEqual(reads, { name: 1, number: 1, target: 1 });
    assert.deepEqual(received, ['SIGINT']);
  } finally { await unsubscribe(); }
});

test('signal snapshot cannot transfer a request to a replacement invocation', async () => {
  const channel = createProcessSignalChannel();
  const received: bigint[] = [];
  const accept = async (event: { sequence: bigint }) => {
    received.push(event.sequence);
    return { sequence: event.sequence };
  };
  const first = channel.subscribe(accept);
  let second!: ReturnType<typeof channel.subscribe>;
  let cleanup!: ReturnType<typeof first>;
  try {
    await assert.rejects(channel.send({
      get name() {
        cleanup = first();
        second = channel.subscribe(accept);
        return 'SIGINT';
      },
      number: 2,
      target: 'process-group',
    }), /subscriber/);
    assert.deepEqual(received, []);
    assert.deepEqual(await channel.send({ name: 'SIGINT', number: 2, target: 'process-group' }), { sequence: 1n });
  } finally { await cleanup; await second?.(); await first(); }
});

test('signal snapshot cannot exceed the outstanding admission bound', async () => {
  const channel = createProcessSignalChannel();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const unsubscribe = channel.subscribe(async event => {
    await gate;
    return { sequence: event.sequence };
  });
  const admitted: Promise<unknown>[] = [];
  try {
    const overflow = channel.send({
      get name() {
        for (let index = 0; index < 64; index++) {
          admitted.push(channel.send({ name: 'SIGINT', number: 2, target: 'process-group' }));
        }
        return 'SIGINT';
      },
      number: 2,
      target: 'process-group',
    });
    const rejected = assert.rejects(overflow, /limit/);
    release();
    await rejected;
  } finally { release(); await Promise.all(admitted); await unsubscribe(); }
});
