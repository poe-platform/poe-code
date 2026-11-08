import { expect, it } from "vitest";
import type { RangeSource } from "@poe-code/spreadsheet-engine/contracts";
import { writeCfb } from "./biff-write-binary.js";
import { writeCfbSource } from "./cfb-write-source.js";

const context = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 20e6, outputBytes: 20e6, cells: 100, sheets: 10, operations: 10 } };

it.each([0, 1, 7, 80])('matches CFB bytes for %s mixed streams using borrowed short reads', async count => {
  const data = new Map(Array.from({ length: count }, (_, i) => [`Stream${i}`, Uint8Array.from({ length: [0, 1, 63, 64, 4095, 4096, 9999][i % 7]! }, (_, n) => (i + n) % 251)] as const));
  const expected = writeCfb(data, context), actual = new Uint8Array(expected.length), borrowed = new Uint8Array(257);
  const sources = new Map<string, RangeSource>(); let reads = 0;
  for (const [name, bytes] of data) sources.set(name, { size: bytes.length, async read(at, count) {
    reads++; expect(count).toBeLessThanOrEqual(16384);
    const part = bytes.subarray(at, at + Math.min(count, borrowed.length)); borrowed.set(part); return borrowed.subarray(0, part.length);
  } });
  const iterator = writeCfbSource(sources, context)[Symbol.asyncIterator]();
  expect(reads).toBe(0); let at = 0;
  for (;;) {
    const next = await iterator.next(); if (next.done) break;
    expect(next.value.length).toBeLessThanOrEqual(16384);
    actual.set(next.value, at); at += next.value.length;
    const previous = reads; await Promise.resolve(); expect(reads).toBe(previous);
  }
  expect(at).toBe(expected.length); expect(actual).toEqual(expected);
});

it('matches external DIFAT and does not prefetch a generated payload', async () => {
  const size = 8e6, expected = writeCfb(new Map([['Workbook', new Uint8Array(size).fill(19)]]), context);
  let reads = 0, offset = 0, position = 0;
  for await (const chunk of writeCfbSource(new Map([['Workbook', { size, async read(at: number, count: number) {
    reads++; expect(at).toBe(offset); offset += count; return new Uint8Array(count).fill(19);
  } }]]), context)) {
    expect(chunk.every((byte, i) => byte === expected[position + i])).toBe(true); position += chunk.length;
  }
  expect(offset).toBe(size); expect(reads).toBeLessThan(1000); expect(position).toBe(expected.length);
});

it('stops reads on early return and preserves backend failures and cancellation', async () => {
  const controller = new AbortController(), failure = new Error('backend'); let reads = 0;
  const source = { size: 9000, async read() { reads++; throw failure; } };
  const iterator = writeCfbSource(new Map([['Workbook', source]]), context)[Symbol.asyncIterator]();
  await iterator.next(); await iterator.return(undefined); expect(reads).toBe(0);
  const failed = writeCfbSource(new Map([['Workbook', source]]), context)[Symbol.asyncIterator]();
  await failed.next(); await expect(failed.next()).rejects.toBe(failure);
  const cancelled = writeCfbSource(new Map([['Workbook', { size: 9000, async read() { controller.abort(failure); return new Uint8Array(1); } }]]), { ...context, signal: controller.signal })[Symbol.asyncIterator]();
  await cancelled.next(); await expect(cancelled.next()).rejects.toBe(failure);
});

it('checks output limits before reading and rejects truncated backing', async () => {
  let reads = 0; const source = { size: 9000, async read() { reads++; return new Uint8Array(); } };
  const limited = writeCfbSource(new Map([['Workbook', source]]), { ...context, limits: { ...context.limits, outputBytes: 1000 } })[Symbol.asyncIterator]();
  await expect(limited.next()).rejects.toThrow('limit'); expect(reads).toBe(0);
  const truncated = writeCfbSource(new Map([['Workbook', source]]), context)[Symbol.asyncIterator]();
  await truncated.next(); await expect(truncated.next()).rejects.toThrow('truncated');
});

it.each([[7, undefined], [8, undefined], ['dsf', undefined], [7, 'xor'], [8, 'xor'], ['dsf', 'xor'], [8, 'rc4'], [8, 'rc4-cryptoapi-40-properties']] as const)('exposes incremental BIFF %s %s output with identical bytes', async (profile, encryption) => {
  const { createBiffWriter } = await import('./biff.js');
  const { xlsFormat } = await import('./index.js');
  const book = { sheets: [{ id: 's', name: 'Data', cells: Array.from({ length: 500 }, (_, row) => ({ row, column: 0, value: { kind: 'number' as const, value: row } })) }] };
  const ctx = { ...context, limits: { ...context.limits, cells: 1000 },
    password: { async read() { return encryption === 'xor' ? new Uint8Array([112, 97, 115, 115]) : 'password'; } },
    entropy: { async read({ length }: { length: number }) { return Uint8Array.from({ length }, (_, i) => i + 1); } } };
  const options = encryption ? [`encryption=${encryption}`] : [];
  const expected = await createBiffWriter(profile)(book, options, ctx);
  const service = xlsFormat.services.find(service => service.id === `excel_${profile === 'dsf' ? 'dsf' : `biff${profile}`}`)!;
  expect(service.writeStream).toBeTypeOf('function');
  let offset = 0, chunks = 0;
  for await (const chunk of service.writeStream!(book, options, ctx)) {
    expect(chunk.length).toBeLessThanOrEqual(16384); expect(chunk).toEqual(expected.subarray(offset, offset + chunk.length));
    offset += chunk.length; chunks++;
  }
  expect(offset).toBe(expected.length); expect(chunks).toBeGreaterThan(1);
});
