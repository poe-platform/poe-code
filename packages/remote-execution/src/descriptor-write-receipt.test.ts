import { expect, it, vi } from 'vitest';
import { createDescriptorMaterialization } from './descriptors.js';

it.each([
 { exposedLength: 0, count: 1, accepted: true },
 { exposedLength: 4, count: 2, accepted: false },
])('validates settled progress against admitted bytes ($exposedLength, $count)', async ({ exposedLength, count, accepted }) => {
 const signal = new AbortController().signal;
 const close = vi.fn(async () => {});
 const visible: number[] = [];
 const server = createDescriptorMaterialization({ maxHandles: 1, maxIoBytes: 1, handles: {
  acquire: async () => ({ identity: {}, close, write: async bytes => {
   visible.push(bytes[0]);
   Object.defineProperty(bytes, 'length', { value: exposedLength });
   return count;
  } }),
 } });
 try {
  const opened = await server.acquire(3, ['write'], signal);
  const writing = server.write(opened.handle, Uint8Array.of(255), signal);
  if (accepted) expect(await writing).toBe(1);
  else await expect(writing).rejects.toMatchObject({ code: 'EIO' });
  expect(visible).toEqual([255]);
 } finally { await server.dispose(); }
 expect(close).toHaveBeenCalledOnce();
});

it('preserves completed progress when the backend transfers ownership of the write buffer', async () => {
 const signal = new AbortController().signal;
 let visible: Uint8Array | undefined;
 const server = createDescriptorMaterialization({ maxHandles: 1, maxIoBytes: 2, handles: {
  acquire: async () => ({ identity: {}, close: async () => {}, write: async bytes => {
   visible = structuredClone(bytes, { transfer: [bytes.buffer] });
   return visible.length;
  } }),
 } });
 const source = Uint8Array.of(255, 0);
 try {
  const opened = await server.acquire(3, ['write'], signal);
  expect(await server.write(opened.handle, source, signal)).toBe(2);
  expect(visible).toEqual(Uint8Array.of(255, 0));
  expect(source).toEqual(Uint8Array.of(255, 0));
 } finally { await server.dispose(); }
});
