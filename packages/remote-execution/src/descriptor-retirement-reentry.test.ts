import { expect, it, vi } from 'vitest';
import { createDescriptorMaterialization } from './descriptors.js';

it('shares retirement with synchronous canonical abort listeners until lease closure settles', async () => {
 let entered!: () => void;
 const started = new Promise<void>(resolve => { entered = resolve; });
 let release!: () => void;
 const gate = new Promise<void>(resolve => { release = resolve; });
 let reentrant: Promise<void> | undefined;
 const close = vi.fn(async () => { await gate; });
 const server = createDescriptorMaterialization({ maxHandles: 1, maxIoBytes: 1, handles: {
  acquire: async () => ({ identity: {}, close, read: async (_count, signal) => {
   entered();
   return new Promise((_, reject) => {
    signal.addEventListener('abort', () => {
     reentrant = server.dispose();
     reject(signal.reason);
    }, { once: true });
   });
  } }),
 } });
 const signal = new AbortController().signal;
 const opened = await server.acquire(3, ['read'], signal);
 const reading = server.read(opened.handle, 1, signal).catch(error => error);
 await started;
 const retirement = server.dispose();
 const sameBarrier = reentrant === retirement;
 let acknowledged = false;
 void reentrant!.then(() => { acknowledged = true; });
 await new Promise<void>(resolve => { setImmediate(resolve); });
 const earlyAcknowledgment = acknowledged;
 release();
 await Promise.all([reading, retirement, reentrant]);
 expect(sameBarrier).toBe(true);
 expect(earlyAcknowledgment).toBe(false);
 expect(close).toHaveBeenCalledOnce();
});
