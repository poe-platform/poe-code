import { expect, it } from 'vitest';
import { encryptBiffXorStreams } from './biff-xor-write.js';
import { BiffOutput, words } from './biff-write-binary.js';
const context = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: 'C', timezone: 'UTC' },
  limits: { inputBytes: 2e6, outputBytes: 2e6, cells: 5000, sheets: 10, operations: 100 },
  password: { async read() { return new Uint8Array([112, 97, 115, 115]); } } };
function fixture() {
  const output = new BiffOutput(context, 65535);
  output.record(0x809, words(0x600, 5)); output.record(0x2f, new Uint8Array(6));
  output.record(0x85, Uint8Array.from({ length: 100 }, (_, i) => i));
  output.record(0x1234, Uint8Array.from({ length: 40001 }, (_, i) => i % 251)); output.record(10);
  return output.finish();
}
it('preserves ciphertext across 16 KiB boundaries, borrowed reads and held patches', async () => {
  const expected = fixture(), actual = fixture(), borrowed = new Uint8Array(257), patches: Uint8Array[] = [];
  await encryptBiffXorStreams([expected], 8, context); let pending = 0;
  await encryptBiffXorStreams([{ size: actual.length, async read(at, count) {
    expect(count).toBeLessThanOrEqual(16384); const part = actual.subarray(at, at + Math.min(257, count));
    borrowed.set(part); return borrowed.subarray(0, part.length);
  }, async patch(at, bytes) {
    expect(bytes.length).toBeLessThanOrEqual(16384); expect(++pending).toBe(1);
    try { await Promise.resolve(); actual.set(bytes, at); patches.push(bytes); } finally { pending--; }
  } }], 8, context);
  expect(actual).toEqual(expected); expect(patches.length).toBeGreaterThan(3);
  expect(patches.every(bytes => bytes.every(byte => byte === 0))).toBe(true);
});
it.each(['read', 'short', 'patch', 'abort-read', 'abort-patch'])('preserves %s failures and erases transient ciphertext', async mode => {
  const actual = fixture(), failure = new Error(mode), controller = new AbortController(), patches: Uint8Array[] = [];
  let reads = 0;
  const operation = encryptBiffXorStreams([{ size: actual.length, async read(at, count) {
    if (++reads > 4) {
      if (mode === 'read') throw failure;
      if (mode === 'short') return new Uint8Array();
      if (mode === 'abort-read') controller.abort(failure);
    }
    return actual.subarray(at, at + count);
  }, async patch(at, bytes) {
    patches.push(bytes);
    if (mode === 'patch') throw failure;
    if (mode === 'abort-patch') controller.abort(failure);
    actual.set(bytes, at);
  } }], 8, { ...context, signal: controller.signal });
  if (mode === 'short') await expect(operation).rejects.toThrow('Truncated'); else await expect(operation).rejects.toBe(failure);
  expect(patches.every(bytes => bytes.every(byte => byte === 0))).toBe(true);
});
it('captures the source capability before awaiting the password and admits work first', async () => {
  const actual = fixture(), expected = fixture(); await encryptBiffXorStreams([expected], 8, context);
  const source = { size: actual.length, async read(at: number, count: number) { return actual.subarray(at, at + count); },
    async patch(at: number, bytes: Uint8Array) { actual.set(bytes, at); } };
  let passwords = 0;
  const ctx = { ...context, password: { async read() {
    passwords++; source.size = 0; source.read = async () => { throw new Error('replaced read'); }; source.patch = async () => { throw new Error('replaced patch'); };
    return context.password.read();
  } } };
  await expect(encryptBiffXorStreams([source], 8, { ...ctx, limits: { ...ctx.limits, workbookWork: 100 } })).rejects.toThrow('work limit');
  expect(passwords).toBe(0);
  await encryptBiffXorStreams([source], 8, ctx); expect(actual).toEqual(expected); expect(passwords).toBe(1);
});
it('rejects truncated FILEPASS before patching', async () => {
  const actual = fixture().subarray(0, 14); let patches = 0;
  await expect(encryptBiffXorStreams([{ size: actual.length, async read(at, count) { return actual.subarray(at, at + count); },
    async patch() { patches++; } }], 8, context)).rejects.toThrow('Truncated');
  expect(patches).toBe(0);
});
