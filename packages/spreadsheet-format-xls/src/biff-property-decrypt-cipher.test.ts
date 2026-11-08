import { expect, it } from 'vitest';
import { decryptBiffPropertyContainer } from './biff-encrypted-properties.js';
import { prepareBiffPropertyContainer } from './biff-encrypted-properties-write.js';
import { createRc4Cipher, rc4Stream } from './biff-encryption.js';
const context = { signal: new AbortController().signal, own(_close: () => void | Promise<void>) {}, environment: { env: {}, locale: 'C', timezone: 'UTC' },
  limits: { inputBytes: 2e6, outputBytes: 2e6, cells: 10, sheets: 2, operations: 100 } };
const key = (block: number) => new Uint8Array([42, block & 255, block >>> 8]);
function fixture() {
  const streams = new Map([['Large', new Uint8Array(100003).fill(37)], ['Other', new Uint8Array([1, 2, 3])]]);
  const encrypted = prepareBiffPropertyContainer(streams, context, () => {})((block, length) => rc4Stream(key(block), length, context));
  return { streams, encrypted };
}
it('decrypts with bounded cipher windows and independent header, directory and payload restarts', async () => {
  const { streams, encrypted } = fixture(), original = encrypted.slice(), cleanups: (() => void | Promise<void>)[] = [];
  const blocks: number[] = [], windows: number[] = []; let closed = 0;
  const result = decryptBiffPropertyContainer(encrypted, () => { throw new Error('payload-wide keystream'); },
    { ...context, own(close) { cleanups.push(close); } }, () => {}, block => {
      blocks.push(block); const cipher = createRc4Cipher(key(block), context);
      return { xor(bytes) { windows.push(bytes.length); expect(bytes.length).toBeLessThanOrEqual(16384); cipher.xor(bytes); }, close() { closed++; cipher.close(); } };
    });
  expect(result).toEqual(streams); expect(encrypted).toEqual(original); expect(blocks).toEqual([0, 0, 0, 1]);
  expect(closed).toBe(4); expect(windows.length).toBeGreaterThan(8);
  const output = result.get('Large')!; for (const close of cleanups) await close();
  expect(output.every(byte => byte === 0)).toBe(true); expect(result.size).toBe(0);
});
it.each(['xor', 'abort', 'dispose'])('erases decrypted data and closes ciphers after %s failure', mode => {
  const { encrypted } = fixture(), controller = new AbortController(), failure = new Error(mode);
  let cleanup: (() => void | Promise<void>) | undefined, opened = 0, closed = 0;
  const windows: Uint8Array[] = [];
  expect(() => decryptBiffPropertyContainer(encrypted, () => { throw new Error('payload-wide keystream'); },
    { ...context, signal: controller.signal, own(close) { cleanup = close; } }, () => {}, block => {
      const ordinal = ++opened, cipher = createRc4Cipher(key(block), context);
      return { xor(bytes) {
        windows.push(bytes); cipher.xor(bytes);
        if (ordinal === 3) { if (mode === 'xor') throw failure; if (mode === 'abort') controller.abort(failure); if (mode === 'dispose') void cleanup?.(); }
      }, close() { closed++; cipher.close(); } };
    })).toThrow(mode === 'dispose' ? 'disposed' : failure);
  expect(opened).toBe(3); expect(closed).toBe(opened); expect(windows.every(bytes => bytes.every(byte => byte === 0))).toBe(true);
});
