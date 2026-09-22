import { expect, it, vi } from 'vitest';
import { createDescriptorMaterialization } from './descriptors.js';

it('refuses upstream EOF for a zero-byte read without consuming the retained descriptor', async () => {
 const signal = new AbortController().signal;
 const close = vi.fn(async () => {});
 const read = vi.fn(async (maxBytes: number) => maxBytes === 0
  ? { done: true as const, value: undefined }
  : { done: false as const, value: Uint8Array.of(255) });
 const server = createDescriptorMaterialization({ maxHandles: 1, maxIoBytes: 1, handles: {
  acquire: async () => ({ identity: {}, read, close }),
 } });
 try {
  const opened = await server.acquire(3, ['read'], signal);
  await expect(server.read(opened.handle, 0, signal)).rejects.toMatchObject({ code: 'EIO', syscall: 'read' });
  expect(await server.read(opened.handle, 1, signal)).toEqual({ done: false, value: Uint8Array.of(255) });
  expect(close).not.toHaveBeenCalled();
 } finally { await server.dispose(); }
 expect(close).toHaveBeenCalledOnce();
});
