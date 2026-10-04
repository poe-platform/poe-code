import { expect, it } from 'vitest';
import { encryptBiffStream, createBiffEncryptionHeader, biffEncryptionProfiles, type BiffEncryptionProfile } from './biff-encrypted-write.js';
import { BiffOutput, words } from './biff-write-binary.js';
const context = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: 'C', timezone: 'UTC' },
  limits: { inputBytes: 2e6, outputBytes: 2e6, cells: 5000, sheets: 10, operations: 100 },
  password: { async read() { return 'password'; } },
  entropy: { async read() { return Uint8Array.from({ length: 32 }, (_, i) => i + 1); } } };
type Profile = Exclude<BiffEncryptionProfile, { algorithm: 'xor' }>;
const profiles = [...biffEncryptionProfiles].filter((entry): entry is [string, Profile] => entry[1].algorithm !== 'xor');
function fixture(profile: Profile) {
  const output = new BiffOutput(context, 65535);
  output.record(0x809, words(0x600, 5)); output.record(0x2f, createBiffEncryptionHeader(profile));
  output.record(0x85, Uint8Array.from({ length: 100 }, (_, i) => i));
  output.record(0x1234, Uint8Array.from({ length: 40001 }, (_, i) => i % 251)); output.record(10);
  return output.finish();
}
it.each(profiles)('preserves %s ciphertext and property output across bounded borrowed windows', async (_, profile) => {
  const expected = fixture(profile), actual = fixture(profile), borrowed = new Uint8Array(257), patches: Uint8Array[] = [];
  const properties = new Map([['Ancillary', Uint8Array.from({ length: 2345 }, (_, i) => i % 251)]]);
  const expectedProperties = await encryptBiffStream(expected, context, profile, properties); let pending = 0;
  const result = await encryptBiffStream({ size: actual.length, async read(at, count) {
    expect(count).toBeLessThanOrEqual(16384); const part = actual.subarray(at, at + Math.min(count, borrowed.length));
    borrowed.set(part); return borrowed.subarray(0, part.length);
  }, async patch(at, bytes) {
    expect(bytes.length).toBeLessThanOrEqual(16384); expect(++pending).toBe(1);
    try { await Promise.resolve(); actual.set(bytes, at); patches.push(bytes); } finally { pending--; }
  } }, context, profile, properties);
  expect(actual.every((byte, i) => byte === expected[i])).toBe(true); expect(result).toEqual(expectedProperties);
  expect(patches.filter(bytes => bytes.length !== 6).every(bytes => bytes.every(byte => byte === 0))).toBe(true);
});
it.each(['read', 'short', 'patch', 'abort-read', 'abort-patch'])('preserves %s failures and erases transient cipher buffers', async mode => {
  const actual = fixture({ algorithm: 'rc4' }), failure = new Error(mode), controller = new AbortController(), patches: Uint8Array[] = [];
  let reads = 0;
  const operation = encryptBiffStream({ size: actual.length, async read(at, count) {
    if (++reads > 5) {
      if (mode === 'read') throw failure;
      if (mode === 'short') return new Uint8Array();
      if (mode === 'abort-read') controller.abort(failure);
    }
    return actual.subarray(at, at + count);
  }, async patch(at, bytes) {
    patches.push(bytes);
    if (mode === 'patch' && patches.length > 4) throw failure;
    if (mode === 'abort-patch' && patches.length > 4) controller.abort(failure);
    actual.set(bytes, at);
  } }, { ...context, signal: controller.signal });
  if (mode === 'short') await expect(operation).rejects.toThrow('Truncated'); else await expect(operation).rejects.toBe(failure);
  expect(patches.filter(bytes => bytes.length !== 6).every(bytes => bytes.every(byte => byte === 0))).toBe(true);
});
it('captures source capabilities before password acquisition and admits work first', async () => {
  const actual = fixture({ algorithm: 'rc4' }), expected = actual.slice(); await encryptBiffStream(expected, context);
  const source = { size: actual.length, async read(at: number, count: number) { return actual.subarray(at, at + count); },
    async patch(at: number, bytes: Uint8Array) { actual.set(bytes, at); } };
  let passwords = 0;
  const ctx = { ...context, password: { async read() {
    passwords++; source.size = 0; source.read = async () => { throw new Error('replaced read'); }; source.patch = async () => { throw new Error('replaced patch'); };
    return context.password.read();
  } } };
  await expect(encryptBiffStream(source, { ...ctx, limits: { ...ctx.limits, workbookWork: 100 } })).rejects.toThrow('work limit');
  expect(passwords).toBe(0); await encryptBiffStream(source, ctx); expect(actual).toEqual(expected); expect(passwords).toBe(1);
});
it('rejects truncated FILEPASS before patching and leaves host entropy untouched', async () => {
  const actual = fixture({ algorithm: 'rc4' }).subarray(0, 18), entropy = await context.entropy.read(); let patches = 0;
  await expect(encryptBiffStream({ size: actual.length, async read(at, count) { return actual.subarray(at, at + count); },
    async patch() { patches++; } }, { ...context, entropy: { async read() { return entropy; } } })).rejects.toThrow('Truncated');
  expect(patches).toBe(0); expect(entropy).toEqual(await context.entropy.read());
});
