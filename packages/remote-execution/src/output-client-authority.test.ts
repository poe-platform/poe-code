import { Volume } from 'memfs';
import { expect, it, vi } from 'vitest';
import { createClient } from './client.js';
import type { EffectManifest } from './wire.generated.js';

const session = { sessionId: 's', epoch: 'e' };

it('checks the actual binary range extent before delivering bytes with a shadowed length', async () => {
  const bytes = Uint8Array.of(0, 255, 1);
  Object.defineProperty(bytes, 'length', { value: 2 });
  const client = createClient({ baseUrl: 'https://media.test', token: () => 'token', fetch: async () =>
    new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
      { status: 206, headers: { 'Execution-Epoch': 'e', 'Content-Type': 'application/octet-stream', 'Content-Range': 'bytes 0-1/2' } }) });
  const result = await client.readOutputRange(session, 'j', 'file', 0n);
  const reader = result.body!.getReader();
  try { await expect(reader.read()).rejects.toThrow('Output range exceeds its receipt'); }
  finally { reader.releaseLock(); }
});

it('preserves admitted range recovery identity when the caller reuses its session carrier', async () => {
  const identity = { ...session };
  const client = createClient({ baseUrl: 'https://media.test', token: () => {
    identity.sessionId = 'other'; identity.epoch = 'next'; return 'token';
  }, fetch: async () => new Response(new ReadableStream<Uint8Array>({ pull(controller) { controller.error(new Error('interrupted')); } }),
    { status: 206, headers: { 'Execution-Epoch': 'e', 'Content-Type': 'application/octet-stream', 'Content-Range': 'bytes 0-1/2' } }) });
  const result = await client.readOutputRange(identity, 'j', 'file', 0n);
  const reader = result.body!.getReader();
  try { await expect(reader.read()).rejects.toMatchObject({ recovery: { ...session, jobId: 'j' } }); }
  finally { reader.releaseLock(); }
});

it.each(['directory', 'completed-file'] as const)('refuses %s progress from another remote scope without destination work', async progress => {
  const manifest: EffectManifest = { jobId: 'j', effects: [{ operationId: '1', sequence: '1',
    operation: progress === 'directory' ? 'mkdir' : 'created', state: 'applied', namespaceId: 'work', path: '/work/output',
    ...(progress === 'directory' ? {} : { identityId: 'file' }) }],
    outputs: progress === 'directory' ? [] : ['file'], effectBarrier: '1', outputComplete: true };
  const mkdir = vi.fn(async () => {}); const open = vi.fn(async () => ({
    async write() { throw new Error('empty file'); }, async truncate() {}, async close() {},
  }));
  const destination = { mkdir, open };
  function client(baseUrl: string) {
    return createClient({ baseUrl, token: () => 'token', fetch: async url => Response.json(
      String(url).endsWith('/effects') ? manifest : { type: 'file', size: '0' },
      { headers: { 'Execution-Epoch': 'e', ETag: '"same-validator"' } }) });
  }
  const first = await client('https://media.test').retrieveJobOutputs(session, 'j', '/work', destination);
  expect(first.transfer.state).toBe('complete');
  mkdir.mockClear(); open.mockClear();
  const resumed = await client('https://other.test').retrieveJobOutputs(session, 'j', '/work', destination, first.transfer.cursor);
  expect(resumed.transfer).toMatchObject({ state: 'failed', error: expect.objectContaining({ message: expect.stringContaining('source scope') }) });
  expect(mkdir).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
});

it('rejects another job’s effect manifest before reconstructing its outputs', async () => {
  const manifest: EffectManifest = { jobId: 'other', effects: [], outputs: [], effectBarrier: '0', outputComplete: true };
  const client = createClient({ baseUrl: 'https://media.test', token: () => 'token',
    fetch: async () => Response.json(manifest, { headers: { 'Execution-Epoch': 'e' } }) });
  const mkdir = vi.fn(); const open = vi.fn();
  await expect(client.retrieveJobOutputs(session, 'requested', '/work', { mkdir, open }))
    .rejects.toMatchObject({ phase: 'unknown', recovery: { ...session, jobId: 'requested' } });
  expect(mkdir).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
});

it.each(['origin', 'session', 'epoch', 'credentials'] as const)(
  'binds resumed output transfers to their remote authority across changed %s', async change => {
    const volume = Volume.fromJSON({ '/out/prior': 'unrelated' });
    const manifest: EffectManifest = { jobId: 'j', outputs: ['file'], effectBarrier: '2', outputComplete: true,
      processOutcome: { kind: 'exited', exitCode: 1 }, effects: [
        { operationId: '1', sequence: '1', operation: 'mkdir', state: 'applied', namespaceId: 'work', path: '/work/generated' },
        { operationId: '2', sequence: '2', operation: 'created', state: 'applied', namespaceId: 'work', path: '/work/generated/file', identityId: 'file' },
      ] };
    let quota = true;
    const opens = vi.fn(); const ranges: string[] = [];
    const destination = { async mkdir(path: string) { volume.mkdirSync('/out/' + path); }, async open(path: string) {
      opens();
      const fd = volume.openSync('/out/' + path, volume.existsSync('/out/' + path) ? 'r+' : 'w+');
      return { async write(position: bigint, bytes: Uint8Array) {
        if (quota && position > 0n) throw new Error('EDQUOT');
        return volume.writeSync(fd, bytes, 0, quota ? 1 : bytes.length, Number(position));
      }, async truncate(size: bigint) { volume.ftruncateSync(fd, Number(size)); }, async close() { volume.closeSync(fd); } };
    } };
    const nextSession = change === 'session' ? { ...session, sessionId: 'other' }
      : change === 'epoch' ? { ...session, epoch: 'next' } : session;
    function client(baseUrl: string, identity = session, token = 'token') {
      return createClient({ baseUrl, token: () => token, fetch: async (url, init) => {
        const headers = { 'Execution-Epoch': identity.epoch, ETag: '"same-opaque-validator"' };
        if (String(url).endsWith('/effects')) return Response.json(manifest, { headers });
        if (!String(url).endsWith('/bytes')) return Response.json({ type: 'file', size: '2' }, { headers });
        const range = new Headers(init?.headers).get('Range')!; ranges.push(range);
        const start = Number(range.split('=')[1].split('-')[0]);
        return new Response(Uint8Array.of(0, 255).slice(start), { status: 206,
          headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${start}-1/2` } });
      } });
    }
    const first = await client('https://media.test').retrieveJobOutputs(session, 'j', '/work', destination);
    expect(first.transfer.state).toBe('failed');
    expect(first.transfer.cursor.offsets.get('generated/file')).toBe(1n);
    quota = false;
    const resumed = await client(change === 'origin' ? 'https://other.test' : 'https://media.test', nextSession, 'renewed')
      .retrieveJobOutputs(nextSession, 'j', '/work', destination, first.transfer.cursor);
    expect(resumed.processOutcome).toEqual(manifest.processOutcome);
    if (change === 'credentials') {
      expect(resumed.transfer.state).toBe('complete');
      expect(ranges).toEqual(['bytes=0-', 'bytes=1-']);
      expect(volume.readFileSync('/out/generated/file')).toEqual(Buffer.from([0, 255]));
    } else {
      expect(resumed.transfer).toMatchObject({ state: 'failed', error: expect.any(Error) });
      expect(opens).toHaveBeenCalledTimes(1);
      expect(ranges).toEqual(['bytes=0-']);
      expect(volume.readFileSync('/out/generated/file')).toEqual(Buffer.from([0]));
    }
    expect(volume.readFileSync('/out/prior', 'utf8')).toBe('unrelated');
  },
);
