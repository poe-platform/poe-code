import { expect, it, vi } from 'vitest';
import { createEffectStore } from './effects.js';

it('shares output retirement with canonical abort listeners and closes each retain once', async () => {
 let entered!: () => void;
 const started = new Promise<void>(resolve => { entered = resolve; });
 let release!: () => void;
 const gate = new Promise<void>(resolve => { release = resolve; });
 let reentrant: Promise<void> | undefined;
 const close = vi.fn(async () => { await gate; });
 const store = createEffectStore({ maxEffects: 1, maxFrameBytes: 1 });
 store.retain('output', { stat: async () => ({ type: 'file', size: 1n }), close,
  read: async (_position, _count, signal) => {
   entered();
   return new Promise((_, reject) => {
    signal.addEventListener('abort', () => {
     reentrant = store.close();
     reject(signal.reason);
    }, { once: true });
   });
  },
 });
 store.record({ operation: 'created', object: 'output', path: [47, 111] });
 store.settle({ state: 'exited', exitCode: 1 });
 const reader = store.download('output', 0n, 1n).getReader();
 const reading = reader.read().catch(error => error);
 await started;
 const retirement = store.close();
 const sameBarrier = reentrant === retirement;
 release();
 await Promise.all([reading, retirement, reentrant]);
 reader.releaseLock();
 expect(sameBarrier).toBe(true);
 expect(close).toHaveBeenCalledOnce();
});
