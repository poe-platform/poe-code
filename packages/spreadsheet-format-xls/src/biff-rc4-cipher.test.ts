import * as encryption from './biff-encryption.js';
import { encryptBiffStream, createBiffEncryptionHeader } from './biff-encrypted-write.js';
import { BiffOutput, words } from './biff-write-binary.js';
import { expect, it, vi } from 'vitest';
import { createRc4Cipher, rc4Stream } from './biff-encryption.js';
import { prepareBiffPropertyContainer } from './biff-encrypted-properties-write.js';
const context = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: 'C', timezone: 'UTC' },
  limits: { inputBytes: 2e6, outputBytes: 2e6, cells: 10, sheets: 2, operations: 100 } };

it('preserves the independent RC4 vector across arbitrary chunk boundaries and captures the key', () => {
  const key = new TextEncoder().encode('Key'), cipher = createRc4Cipher(key, context);
  key.fill(0);
  const bytes = new TextEncoder().encode('Plaintext');
  for (const [start, end] of [[0, 1], [1, 1], [1, 4], [4, 9]]) cipher.xor(bytes.subarray(start, end));
  expect(Buffer.from(bytes).toString('hex')).toBe('bbf316e8d940af0ad3');
  cipher.close(); cipher.close();
  expect(() => cipher.xor(new Uint8Array(1))).toThrow('closed');
});

it('matches the buffered stream across repeated bounded windows', () => {
  const key = new Uint8Array([3, 1, 4]), expected = rc4Stream(key, 100003, context);
  const cipher = createRc4Cipher(key, context), window = new Uint8Array(257);
  for (let at = 0; at < expected.length; at += window.length) {
    window.fill(0); const part = window.subarray(0, Math.min(window.length, expected.length - at));
    cipher.xor(part); expect(part).toEqual(expected.subarray(at, at + part.length));
  }
  cipher.close();
});

it('erases a partially transformed chunk on cancellation and retires the cipher', () => {
  const failure = new Error('cancelled'); let checks = 0;
  const cipher = createRc4Cipher(new Uint8Array([1]), { ...context,
    signal: { throwIfAborted() { if (++checks === 3) throw failure; } } as AbortSignal });
  const bytes = new Uint8Array(4096).fill(7);
  expect(() => cipher.xor(bytes)).toThrow(failure);
  expect(bytes.every(byte => byte === 0)).toBe(true);
  expect(() => cipher.xor(new Uint8Array(1))).toThrow('closed');
});

it('encrypts property payloads and directory with bounded cipher windows and independent restarts', () => {
  const streams = new Map(Array.from({ length: 500 }, (_, i) => [`Property${i}`, new Uint8Array(i ? 1 : 100003).fill(i % 251)]));
  const key = (block: number) => new Uint8Array([block & 255, block >>> 8, 42]);
  const expected = prepareBiffPropertyContainer(streams, context, () => {})(
    (block, length) => rc4Stream(key(block), length, context));
  const fallback = vi.fn(() => { throw new Error('payload-wide keystream'); });
  const blocks: number[] = [], closed: number[] = [];
  const actual = prepareBiffPropertyContainer(streams, context, () => {})(fallback, block => {
    blocks.push(block); const cipher = createRc4Cipher(key(block), context);
    return { xor(bytes) { expect(bytes.length).toBeLessThanOrEqual(16384); cipher.xor(bytes); },
      close() { closed.push(block); cipher.close(); } };
  });
  expect(actual).toEqual(expected); expect(fallback).not.toHaveBeenCalled();
  expect(blocks).toEqual([...Array.from({ length: 500 }, (_, i) => i), 0, 0]); expect(closed).toEqual(blocks);
});

it('closes the property cipher and erases the container after transformation failure', () => {
  const failure = new Error('cipher failure'), close = vi.fn(), chunks: Uint8Array[] = [];
  const encrypt = prepareBiffPropertyContainer(new Map([['A', new Uint8Array(40000).fill(7)]]), context, () => {});
  expect(() => encrypt(() => { throw new Error('fallback'); }, () => ({ close, xor(bytes) {
    chunks.push(bytes); if (chunks.length === 2) throw failure;
  } }))).toThrow(failure);
  expect(close).toHaveBeenCalledTimes(1); expect(chunks.length).toBe(2);
  expect(chunks.every(bytes => bytes.every(byte => byte === 0))).toBe(true);
});

it('rejects disposal during property cipher acquisition and closes the acquired cipher', () => {
  let dispose = () => {}; const close = vi.fn(), xor = vi.fn();
  const encrypt = prepareBiffPropertyContainer(new Map([['A', new Uint8Array([7])]]),
    { ...context, own(cleanup) { dispose = cleanup as () => void; } }, () => {});
  expect(() => encrypt(() => new Uint8Array(), () => { dispose(); return { xor, close }; })).toThrow('disposed');
  expect(close).toHaveBeenCalledTimes(1); expect(xor).not.toHaveBeenCalled();
});

it('uses bounded property cipher windows in the real exporter and closes every cipher', async () => {
  const original = encryption.createRc4Cipher, closes: ReturnType<typeof vi.fn>[] = [], sizes: number[] = [];
  const spy = vi.spyOn(encryption, 'createRc4Cipher').mockImplementation((key, context) => {
    const cipher = original(key, context), close = vi.fn(() => cipher.close()); closes.push(close);
    return { close, xor(bytes) { sizes.push(bytes.length); cipher.xor(bytes); } };
  });
  try {
    const profile = { algorithm: 'rc4-cryptoapi', keyBits: 128, encryptedProperties: true } as const;
    const records = new BiffOutput(context, 65535);
    records.record(0x809, words(0x600, 5)); records.record(0x2f, createBiffEncryptionHeader(profile)); records.record(10);
    const bytes = await encryptBiffStream(records.finish(), { ...context,
      password: { async read() { return 'secret'; } },
      entropy: { async read() { return Uint8Array.from({ length: 32 }, (_, i) => i); } }
    }, profile, new Map([['Ancillary', new Uint8Array(100003).fill(7)]]));
    expect(bytes!.length).toBeGreaterThan(100003);
    expect(Math.max(...sizes)).toBe(16384); expect(sizes.filter(size => size === 16384)).toHaveLength(6);
    expect(closes.length).toBe(4); expect(closes.every(close => close.mock.calls.length === 1)).toBe(true);
  } finally { spy.mockRestore(); }
});
