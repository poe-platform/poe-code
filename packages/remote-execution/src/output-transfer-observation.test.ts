import { expect, it, vi } from 'vitest';
import { retrieveOutputs } from './output-retrieval.js';
import type { EffectManifest } from './wire.generated.js';

const manifest: EffectManifest = { jobId: 'job', outputs: ['a', 'b'], effectBarrier: '2', outputComplete: true,
 processOutcome: { kind: 'exited', exitCode: 1 }, effects: ['a', 'b'].map((identityId, index) => ({
  operationId: String(index + 1), sequence: String(index + 1), operation: 'created', state: 'applied',
  namespaceId: 'work', path: '/work/' + identityId, identityId,
 })) };

it.each(['rename', 'unlink', 'write'] as const)('reports an unsettled %s receipt after retrieving independent output files', async operation => {
 const pending: EffectManifest = { ...manifest, effectBarrier: '3', effects: [...manifest.effects, {
  operationId: 'pending', sequence: '3', operation, state: 'requested', namespaceId: 'work',
  path: '/work/a', identityId: 'a', ...(operation === 'rename' ? { destination: '/work/moved' } : {}),
 }] };
 const written = new Map<string, number>();
 const result = await retrieveOutputs(pending, '/work', {
  async metadata() { return { type: 'file', size: '1' }; },
  async range() { return new ReadableStream({ start(c) { c.enqueue(Uint8Array.of(255)); c.close(); } }); },
 }, { async mkdir() {}, async open(path) { return {
  async write(_offset, bytes) { written.set(path, bytes[0]!); return bytes.length; },
  async truncate() {}, async close() {},
 }; } });
 expect(result.transfer).toMatchObject({ state: 'failed', error: expect.objectContaining({
  message: 'Output effect settlement unavailable: pending',
 }) });
 expect(result.processOutcome).toEqual({ kind: 'exited', exitCode: 1 });
 expect(written).toEqual(new Map([['b', 255]]));
 expect(result.transfer.cursor.completed).toEqual(new Set(['b']));
 expect(result.manifest).toEqual(pending);
});

it('does not report a requested receipt as unresolved after its mutation settles', async () => {
 const requested = { operationId: 'rename', sequence: '3', operation: 'rename' as const,
  state: 'requested' as const, namespaceId: 'work', path: '/work/a', destination: '/work/moved', identityId: 'a' };
 const settled = { ...manifest, effectBarrier: '3', effects: [...manifest.effects, requested,
  { ...requested, state: 'applied' as const }] };
 const opened: string[] = [];
 const result = await retrieveOutputs(settled, '/work', {
  async metadata() { return { type: 'file', size: '0' }; },
  async range() { throw new Error('empty outputs require no read'); },
 }, { async mkdir() {}, async open(path) {
  opened.push(path);
  return { async write() { return 0; }, async truncate() {}, async close() {} };
 } });
 expect(result.transfer.state).toBe('complete');
 expect(opened).toEqual(['b', 'moved']);
});

it('revalidates earlier retained versions after later output work without undoing settled writes', async () => {
 let changed = false;
 const stale = new Error('canonical a changed during b transfer');
 const identities = { a: {}, b: {} };
 const written = new Map<string, number>();
 const result = await retrieveOutputs(manifest, '/work', {
  async freshness(id) { return { identity: identities[id as keyof typeof identities], version: 'v1',
   async assertCurrent() { if (id === 'a' && changed) throw stale; } }; },
  async metadata() { return { type: 'file', size: '1' }; },
  async range() { return new ReadableStream({ start(c) { c.enqueue(Uint8Array.of(255)); c.close(); } }); },
 }, { async mkdir() {}, async open(path) { return {
  async write(_offset, bytes) { written.set(path, bytes[0]!); return bytes.length; },
  async truncate() { if (path === 'b') changed = true; }, async close() {},
 }; } });
 expect(result.transfer).toMatchObject({ state: 'failed', path: 'a', error: stale });
 expect(result.processOutcome).toEqual(manifest.processOutcome);
 expect(written).toEqual(new Map([['a', 255], ['b', 255]]));
 expect(result.transfer.cursor.offsets).toEqual(new Map([['a', 1n], ['b', 1n]]));
});

it('owns the validated metadata observation across awaited freshness checks', async () => {
 const metadata = { type: 'file' as const, size: '0' };
 let observed = false;
 const open = vi.fn(async (_path, value) => {
  expect(value.size).toBe('0');
  return { async write() { return 0; }, async truncate() {}, async close() {} };
 });
 const result = await retrieveOutputs({ ...manifest, outputs: ['a'], effects: manifest.effects.slice(0, 1) }, '/work', {
  async freshness() { return { identity: {}, version: 'v1', async assertCurrent() {
   if (observed) metadata.size = '999';
  } }; },
  async metadata() { observed = true; return metadata; },
  async range() { throw new Error('empty observed file requires no read'); },
 }, { async mkdir() {}, open });
 expect(result.transfer.state).toBe('complete');
 expect(open).toHaveBeenCalledOnce();
});
