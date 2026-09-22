import { expect, it, vi } from 'vitest';
import { createClient } from './client.js';
import { binaryContentType, encodeFrame } from './binary.js';
import { createFrameJournal } from './journal.js';

it.each(['data', 'end'] as const)('refuses transferring a delivered %s cursor to a replacement sink after a lost ACK', async kind => {
  const cursor = { sessionId: 'session', epoch: 'epoch', jobId: 'job', laneId: 'out', nextSequence: 1n,
    offsets: new Map([[2, 0n]]), endedChannels: new Set<number>() };
  const cause = new Error('lost acknowledgment');
  const fetch = vi.fn(async (_url, init) => {
    if (init?.method === 'POST') throw cause;
    return new Response(encodeFrame({ kind, channelId: 2, sequence: 1n, offset: 0n,
      correlationId: 0n, payload: kind === 'data' ? Uint8Array.of(0, 255) : new Uint8Array() }, limits),
    { headers: { 'Execution-Epoch': 'epoch', 'Content-Type': binaryContentType } });
  });
  const options = { baseUrl: 'https://media.test', token: async () => 'token', fetch };
  const original = vi.fn(async () => {});
  await expect(createClient(options).resumeStream(cursor, limits, original)).rejects.toMatchObject({ cause });
  fetch.mockClear();
  const token = vi.fn(async () => 'renewed');
  const replacement = vi.fn(async () => {});
  await expect(createClient({ ...options, token }).resumeStream(cursor, limits, replacement))
    .rejects.toMatchObject({ category: 'transport', code: 'unrecoverable',
      recovery: { sessionId: 'session', epoch: 'epoch', jobId: 'job', laneId: 'out', sequence: '2' } });
  expect(token).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(replacement).not.toHaveBeenCalled();
  expect(original).toHaveBeenCalledOnce();
  expect(cursor.nextSequence).toBe(2n);
});

const session = { sessionId: 'session', epoch: 'epoch' };
const limits = { channels: [2], maxFrameBytes: 64, maxControlBytes: 64 };

it('allows replacing a sink before any complete frame has reached it', async () => {
  const cursor = { ...session, jobId: 'job', laneId: 'out', nextSequence: 1n,
    offsets: new Map([[2, 0n]]), endedChannels: new Set<number>() };
  const wire = encodeFrame({ kind: 'end', channelId: 2, sequence: 1n, offset: 0n,
    correlationId: 0n, payload: new Uint8Array() }, limits);
  let interrupted = false;
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    const headers = { 'Execution-Epoch': session.epoch };
    if (init?.method === 'POST') return Response.json(JSON.parse(init.body as string), { headers });
    const body = interrupted ? wire : wire.slice(0, 39);
    interrupted = true;
    return new Response(body, { headers: { ...headers, 'Content-Type': binaryContentType } });
  };
  const options = { baseUrl: 'https://media.test', token: async () => 'token', fetch };
  const original = vi.fn(async () => {});
  await expect(createClient(options).resumeStream(cursor, limits, original))
    .rejects.toMatchObject({ category: 'transport', phase: 'unknown' });
  expect(original).not.toHaveBeenCalled();
  const replacement = vi.fn(async () => {});
  await createClient(options).resumeStream(cursor, limits, replacement);
  expect(replacement).toHaveBeenCalledOnce();
  expect(cursor.endedChannels).toEqual(new Set([2]));
});

it.each(Array.from({ length: 43 }, (_, index) => index + 1))(
  'resumes an output frame interrupted at byte %i without duplicating its acknowledged prefix', async cut => {
    const journal = createFrameJournal({ ...limits, maxReplayBytes: 1024 });
    await journal.append('data', 2, Uint8Array.of(0, 255));
    await journal.append('data', 2, Uint8Array.of(128, 7, 0, 255));
    await journal.append('end', 2, new Uint8Array());
    journal.seal();
    let interrupted = false;
    const reads: string[] = [];
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      const headers = { 'Execution-Epoch': session.epoch };
      if (init?.method === 'POST') {
        const ack = JSON.parse(init.body as string);
        journal.ack(BigInt(ack.sequence), ack.offsets);
        return Response.json(ack, { headers });
      }
      const sequence = new Headers(init?.headers).get('Execution-Cursor')!;
      reads.push(sequence);
      const source = journal.stream(BigInt(sequence));
      if (!interrupted) {
        interrupted = true;
        const reader = source.getReader();
        let chunks = 0;
        return new Response(new ReadableStream<Uint8Array>({
          async pull(controller) {
            if (chunks === 2) {
              await reader.cancel(); reader.releaseLock();
              controller.error(new Error('connection lost during chunk'));
              return;
            }
            const frame = (await reader.read()).value!;
            controller.enqueue(chunks++ === 0 ? frame : frame.slice(0, cut));
          },
          async cancel(reason) { await reader.cancel(reason); reader.releaseLock(); },
        }, { highWaterMark: 0 }), { headers: { ...headers, 'Content-Type': binaryContentType } });
      }
      return new Response(source, { headers: { ...headers, 'Content-Type': binaryContentType } });
    };
    const cursor = { ...session, jobId: 'job', laneId: 'out', nextSequence: 1n,
      offsets: new Map([[2, 0n]]), endedChannels: new Set<number>() };
    const bytes: number[] = [];
    const consume = async (frame: import('./binary.js').BinaryFrame) => { bytes.push(...frame.payload); };
    const options = { baseUrl: 'https://media.test', token: async () => 'token', fetch };
    await expect(createClient(options).resumeStream(cursor, limits, consume))
      .rejects.toMatchObject({ category: 'transport', phase: 'unknown' });
    expect(bytes).toEqual([0, 255]);
    expect(cursor.nextSequence).toBe(2n);
    expect(journal.floor).toBe(2n);
    await createClient(options).resumeStream(cursor, limits, consume);
    expect(bytes).toEqual([0, 255, 128, 7, 0, 255]);
    expect(reads).toEqual(['1', '2']);
    expect(cursor.endedChannels).toEqual(new Set([2]));
    expect(journal.retainedBytes).toBe(0);
  },
);

it('refuses moving retained delivery to another service before credentials or acknowledgment', async () => {
  const cursor = { ...session, jobId: 'job', laneId: 'out', nextSequence: 1n,
    offsets: new Map([[2, 0n]]), endedChannels: new Set<number>() };
  const cause = new Error('lost acknowledgment');
  const fetch = vi.fn(async (_url, init) => {
    if (init?.method === 'POST') throw cause;
    return new Response(encodeFrame({ kind: 'data', channelId: 2, sequence: 1n,
      offset: 0n, correlationId: 0n, payload: Uint8Array.of(0, 255) }, limits),
    { headers: { 'Execution-Epoch': session.epoch, 'Content-Type': binaryContentType } });
  });
  const consume = vi.fn(async () => {});
  await expect(createClient({ baseUrl: 'https://media.test', token: async () => 'token', fetch })
    .resumeStream(cursor, limits, consume)).rejects.toMatchObject({ cause });
  const token = vi.fn(async () => 'other-token');
  fetch.mockClear();
  await expect(createClient({ baseUrl: 'https://other.test', token, fetch })
    .resumeStream(cursor, limits, consume)).rejects.toMatchObject({
      category: 'transport', code: 'unrecoverable',
      recovery: { ...session, jobId: 'job', laneId: 'out', sequence: '2' },
    });
  expect(token).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(consume).toHaveBeenCalledOnce();
  expect(cursor.nextSequence).toBe(2n);
  expect(cursor.offsets.get(2)).toBe(2n);
});

it('preserves delivered bytes when an unavailable acknowledgment is mislabeled as native failure', async () => {
  const cursor = { ...session, jobId: 'job', laneId: 'out', nextSequence: 1n,
    offsets: new Map([[2, 0n]]), endedChannels: new Set<number>() };
  const sequences: string[] = [];
  let unavailable = true;
  const options = { baseUrl: 'https://media.test', token: async () => 'token',
    fetch: async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = { 'Execution-Epoch': session.epoch };
      if (init?.method === 'POST') {
        if (unavailable) {
          unavailable = false;
          return Response.json({ category: 'native', code: 'provider-unavailable', message: 'Unavailable', phase: 'accepted' },
            { status: 503, headers });
        }
        return Response.json(JSON.parse(init.body as string), { headers });
      }
      const sequence = new Headers(init?.headers).get('Execution-Cursor')!;
      sequences.push(sequence);
      const initial = sequences.length === 1;
      return new Response(encodeFrame({ kind: initial ? 'data' : 'end', channelId: 2,
        sequence: initial ? 1n : 2n, offset: initial ? 0n : 2n, correlationId: 0n,
        payload: initial ? Uint8Array.of(0, 255) : new Uint8Array() }, limits),
        { headers: { ...headers, 'Content-Type': binaryContentType } });
    } };
  const bytes: number[] = [];
  const consume = async (frame: import('./binary.js').BinaryFrame) => { bytes.push(...frame.payload); };
  await expect(createClient(options).resumeStream(cursor, limits, consume))
    .rejects.toMatchObject({ category: 'transport', phase: 'unknown', status: 502 });
  expect(cursor.nextSequence).toBe(2n);
  await createClient(options).resumeStream(cursor, limits, consume);
  expect(bytes).toEqual([0, 255]);
  expect(cursor.nextSequence).toBe(3n);
  expect(sequences).toEqual(['1', '2']);
});

it('keeps one delivery owner while a destination write is pending across replacement clients', async () => {
  const cursor = { ...session, jobId: 'job', laneId: 'out', nextSequence: 1n,
    offsets: new Map([[2, 0n]]), endedChannels: new Set<number>(), busy: false };
  let entered!: () => void; let release!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fetch = vi.fn(async (_url, init) => init?.method === 'POST'
    ? Response.json(JSON.parse(init.body as string), { headers: { 'Execution-Epoch': session.epoch } })
    : new Response(encodeFrame({ kind: 'end', channelId: 2, sequence: 1n, offset: 0n,
      correlationId: 0n, payload: new Uint8Array() }, limits),
    { headers: { 'Execution-Epoch': session.epoch, 'Content-Type': binaryContentType } }));
  const options = { baseUrl: 'https://media.test', token: async () => 'token', fetch };
  const consume = vi.fn(async () => { entered(); await gate; });
  const delivery = createClient(options).resumeStream(cursor, limits, consume);
  await writing;
  cursor.busy = false;
  try {
    await expect(createClient(options).resumeStream(cursor, limits, async () => {}))
      .rejects.toThrow('Stream cursor already has a consumer');
    expect(fetch).toHaveBeenCalledOnce();
  } finally { release(); await delivery; }
  expect(consume).toHaveBeenCalledOnce();
});

it('acknowledges admitted delivery rather than mutable cursor fields after the sink yields', async () => {
  const cursor = { ...session, jobId: 'job', laneId: 'out', nextSequence: 1n,
    offsets: new Map([[2, 0n], [3, 7n]]), endedChannels: new Set([3]) };
  const acks: unknown[] = [];
  const options = { ...limits, channels: [2, 3] };
  const client = createClient({ baseUrl: 'https://media.test', token: async () => 'token',
    fetch: async (_url, init) => {
      if (init?.method === 'POST') {
        const ack = JSON.parse(init.body as string); acks.push(ack);
        return Response.json(ack, { headers: { 'Execution-Epoch': session.epoch } });
      }
      return new Response(encodeFrame({ kind: 'end', channelId: 2, sequence: 1n, offset: 0n,
        correlationId: 0n, payload: new Uint8Array() }, options),
      { headers: { 'Execution-Epoch': session.epoch, 'Content-Type': binaryContentType } });
    } });
  await client.resumeStream(cursor, options, async () => {
    cursor.offsets.clear(); cursor.endedChannels.clear(); cursor.nextSequence = 99n;
  });
  expect(acks).toEqual([{ type: 'Ack', laneId: 'out', sequence: '1',
    offsets: [{ channelId: 2, offset: '0' }, { channelId: 3, offset: '7' }] }]);
  expect(cursor.offsets).toEqual(new Map([[2, 0n], [3, 7n]]));
  expect(cursor.endedChannels).toEqual(new Set([2, 3]));
  expect(cursor.nextSequence).toBe(2n);
});

it.each(['wrong-type', 'missing-body', 'failed-disposal'] as const)(
  'classifies a %s reconnect receipt as transport uncertainty', async failure => {
    const cause = new Error('response disposal failed');
    const cancel = vi.fn(() => { if (failure === 'failed-disposal') throw cause; });
    const client = createClient({ baseUrl: 'https://media.test', token: async () => 'token',
      fetch: async () => new Response(failure === 'missing-body' ? null : new ReadableStream({ cancel }, { highWaterMark: 0 }),
        { headers: { 'Execution-Epoch': session.epoch, 'Content-Type': failure === 'missing-body' ? binaryContentType : 'text/plain' } }),
    });
    const cursor = { ...session, jobId: 'job', laneId: 'out', nextSequence: 1n,
      offsets: new Map([[2, 0n]]), endedChannels: new Set<number>() };
    const consume = vi.fn();
    await expect(client.resumeStream(cursor, limits, consume)).rejects.toMatchObject({
      category: 'transport', phase: 'unknown', status: 502,
      recovery: { ...session, jobId: 'job', laneId: 'out', sequence: '1' },
      ...(failure === 'failed-disposal' ? { cause } : {}),
    });
    expect(consume).not.toHaveBeenCalled();
    expect(cursor.nextSequence).toBe(1n);
    expect(cursor.busy).toBe(false);
    if (failure !== 'missing-body') expect(cancel).toHaveBeenCalledOnce();
  },
);

it('pins stream recovery identity before credentials yield and retains complete frames before interruption', async () => {
  const identity = { ...session };
  const cause = new Error('connection interrupted');
  const wire = encodeFrame({ kind: 'data', channelId: 2, sequence: 1n, offset: 0n,
    correlationId: 0n, payload: Uint8Array.of(0, 255) }, limits);
  let reads = 0;
  const client = createClient({ baseUrl: 'https://media.test', token: async () => {
    identity.sessionId = 'replacement'; identity.epoch = 'replacement'; return 'token';
  }, fetch: async () => new Response(new ReadableStream<Uint8Array>({ pull(controller) {
    if (reads++ === 0) controller.enqueue(wire); else controller.error(cause);
  } }, { highWaterMark: 0 }), { headers: { 'Execution-Epoch': session.epoch, 'Content-Type': binaryContentType } }) });
  const frames = client.readFrames(identity, 'job', 'out', 1n, limits);
  expect((await frames.next()).value?.payload).toEqual(Uint8Array.of(0, 255));
  await expect(frames.next()).rejects.toMatchObject({ category: 'transport', phase: 'unknown', cause,
    recovery: { ...session, jobId: 'job', laneId: 'out', sequence: '2' } });
});

it.each(['credentials', 'consumer'] as const)('pins reconnect acknowledgments to the admitted invocation during %s', async phase => {
  const cursor = { ...session, jobId: 'job', laneId: 'out', nextSequence: 1n,
    offsets: new Map([[2, 0n]]), endedChannels: new Set<number>() };
  const replace = () => Object.assign(cursor, { sessionId: 'replacement', epoch: 'replacement', jobId: 'other', laneId: 'other' });
  const paths: string[] = [];
  const wire = encodeFrame({ kind: 'end', channelId: 2, sequence: 1n, offset: 0n,
    correlationId: 0n, payload: new Uint8Array() }, limits);
  const client = createClient({ baseUrl: 'https://media.test', token: async () => {
    if (phase === 'credentials') replace();
    return 'token';
  }, fetch: async (url, init) => {
    paths.push(new URL(String(url)).pathname);
    if (init?.method === 'POST') return Response.json(JSON.parse(init.body as string),
      { headers: { 'Execution-Epoch': session.epoch } });
    return new Response(wire, { headers: { 'Execution-Epoch': session.epoch, 'Content-Type': binaryContentType } });
  } });
  await client.resumeStream(cursor, limits, async () => { if (phase === 'consumer') replace(); });
  expect(paths).toEqual(['/v1/sessions/session/jobs/job/lanes/out/frames', '/v1/sessions/session/jobs/job/lanes/out/ack']);
  expect(cursor.nextSequence).toBe(2n);
});

it.each(['sessionId', 'epoch', 'jobId', 'laneId'] as const)('refuses changing delivered cursor %s across client replacement before issuing transport requests', async field => {
  const cursor = { ...session, jobId: 'job', laneId: 'out', nextSequence: 1n,
    offsets: new Map([[2, 0n]]), endedChannels: new Set<number>() };
  const cause = new Error('lost acknowledgment');
  const fetch = vi.fn(async (_url, init) => {
    if (init?.method === 'POST') throw cause;
    return new Response(encodeFrame({ kind: 'data', channelId: 2, sequence: 1n, offset: 0n,
      correlationId: 0n, payload: Uint8Array.of(255) }, limits),
    { headers: { 'Execution-Epoch': session.epoch, 'Content-Type': binaryContentType } });
  });
  const client = createClient({ baseUrl: 'https://media.test', token: async () => 'token', fetch });
  const consume = vi.fn(async () => {});
  await expect(client.resumeStream(cursor, limits, consume)).rejects.toMatchObject({ cause });
  expect(cursor.nextSequence).toBe(2n);
  cursor[field] = 'replacement';
  fetch.mockClear();
  const reconnect = createClient({ baseUrl: 'https://media.test', token: async () => 'token', fetch });
  await expect(reconnect.resumeStream(cursor, limits, consume)).rejects.toMatchObject({
    category: 'transport', code: 'unrecoverable', recovery: { ...session, jobId: 'job', laneId: 'out', sequence: '2' },
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(consume).toHaveBeenCalledOnce();
});

it.each(['sequence', 'offset', 'end'] as const)('refuses retracting delivered %s evidence across reconnect', async field => {
  const cursor = { ...session, jobId: 'job', laneId: 'out', nextSequence: 1n,
    offsets: new Map([[2, 0n]]), endedChannels: new Set<number>() };
  const fetch = vi.fn(async (_url, init) => {
    if (init?.method === 'POST') throw new Error('lost acknowledgment');
    return new Response(encodeFrame({ kind: field === 'end' ? 'end' : 'data', channelId: 2,
      sequence: 1n, offset: 0n, correlationId: 0n,
      payload: field === 'end' ? new Uint8Array() : Uint8Array.of(255) }, limits),
    { headers: { 'Execution-Epoch': session.epoch, 'Content-Type': binaryContentType } });
  });
  const consume = vi.fn(async () => {});
  await expect(createClient({ baseUrl: 'https://media.test', token: async () => 'token', fetch })
    .resumeStream(cursor, limits, consume)).rejects.toMatchObject({ category: 'transport' });
  if (field === 'sequence') { cursor.nextSequence = 1n; cursor.offsets.set(2, 0n); }
  if (field === 'offset') cursor.offsets.set(2, 0n);
  if (field === 'end') cursor.endedChannels.clear();
  fetch.mockClear();
  await expect(createClient({ baseUrl: 'https://media.test', token: async () => 'token', fetch })
    .resumeStream(cursor, limits, consume)).rejects.toMatchObject({
      category: 'transport', code: 'unrecoverable',
      recovery: { ...session, jobId: 'job', laneId: 'out', sequence: '2' },
    });
  expect(fetch).not.toHaveBeenCalled();
  expect(consume).toHaveBeenCalledOnce();
});

it('retries a lost acknowledgment with a replacement client before resuming the undelivered tail', async () => {
  const cursor = { ...session, jobId: 'job', laneId: 'out', nextSequence: 1n,
    offsets: new Map([[2, 0n]]), endedChannels: new Set<number>() };
  const events: string[] = [];
  let lost = false;
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    if (init?.method === 'POST') {
      const ack = JSON.parse(init.body as string);
      events.push('ack:' + ack.sequence);
      if (!lost) { lost = true; throw new Error('lost acknowledgment'); }
      return Response.json(ack, { headers: { 'Execution-Epoch': session.epoch } });
    }
    const sequence = BigInt(new Headers(init?.headers).get('Execution-Cursor')!);
    events.push('read:' + sequence);
    return new Response(encodeFrame({ kind: sequence === 1n ? 'data' : 'end', channelId: 2,
      sequence, offset: sequence === 1n ? 0n : 1n, correlationId: 0n,
      payload: sequence === 1n ? Uint8Array.of(255) : new Uint8Array() }, limits),
    { headers: { 'Execution-Epoch': session.epoch, 'Content-Type': binaryContentType } });
  };
  const bytes: number[] = [];
  const consume = async (frame: import('./binary.js').BinaryFrame) => { bytes.push(...frame.payload); };
  await expect(createClient({ baseUrl: 'https://media.test', token: async () => 'token', fetch })
    .resumeStream(cursor, limits, consume)).rejects.toMatchObject({ category: 'transport' });
  await createClient({ baseUrl: 'https://media.test', token: async () => 'renewed-token', fetch })
    .resumeStream(cursor, limits, consume);
  expect(events).toEqual(['read:1', 'ack:1', 'ack:1', 'read:2', 'ack:2']);
  expect(bytes).toEqual([255]);
  expect(cursor.nextSequence).toBe(3n);
  expect(cursor.endedChannels).toEqual(new Set([2]));
});

it('retains uncertain sink delivery even if the caller clears its cursor flags', async () => {
  const cursor: import('./client.js').StreamCursor = { ...session, jobId: 'job', laneId: 'out', nextSequence: 1n,
    offsets: new Map([[2, 0n]]), endedChannels: new Set<number>() };
  const fetch = vi.fn(async () => new Response(encodeFrame({ kind: 'data', channelId: 2,
    sequence: 1n, offset: 0n, correlationId: 0n, payload: Uint8Array.of(255) }, limits),
  { headers: { 'Execution-Epoch': session.epoch, 'Content-Type': binaryContentType } }));
  const cause = new Error('sink applied a prefix before failing');
  const consume = vi.fn(async () => { throw cause; });
  await expect(createClient({ baseUrl: 'https://media.test', token: async () => 'token', fetch })
    .resumeStream(cursor, limits, consume)).rejects.toMatchObject({ code: 'unrecoverable', cause });
  delete cursor.deliveryUnknown;
  delete cursor.deliveryCause;
  fetch.mockClear();
  await expect(createClient({ baseUrl: 'https://media.test', token: async () => 'token', fetch })
    .resumeStream(cursor, limits, consume)).rejects.toMatchObject({ code: 'unrecoverable', cause });
  expect(fetch).not.toHaveBeenCalled();
  expect(consume).toHaveBeenCalledOnce();
});
