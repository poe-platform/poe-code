import { expect, it } from 'vitest';
import { equal, literal } from './retained-values.js';
import type { ByteSource } from './contracts.js';
it('closes both inputs even when the first iterator return throws synchronously', async () => {
  let retired = false;
  const left: ByteSource = { [Symbol.asyncIterator]() { return { next: async () => ({ done: false, value: new Uint8Array([1]) }), return() { throw new Error('close failed'); } }; } };
  const right: ByteSource = { [Symbol.asyncIterator]() { return { next: async () => ({ done: false, value: new Uint8Array([2]) }), return() { retired = true; return Promise.resolve({ done: true, value: undefined }); } }; } };
  await expect(equal(left, right)).rejects.toThrow('close failed'); expect(retired).toBe(true);
});
it('literal values retain Unicode across bounded chunk boundaries', async () => {
  const value = 'a'.repeat(4095) + '🙂'.repeat(5000), decoder = new TextDecoder(); let result = '';
  for await (const bytes of literal(value)) { expect(bytes.length).toBeLessThanOrEqual(16384); result += decoder.decode(bytes, { stream: true }); }
  expect(result + decoder.decode()).toBe(value);
});
