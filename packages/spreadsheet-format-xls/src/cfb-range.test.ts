import { expect, it, vi } from "vitest";
import { createEngine } from "@poe-code/spreadsheet-engine";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { readCfbRanges } from "./cfb-range.js";
import { writeCfb } from "./biff-write-binary.js";
import { readCfb } from "./biff-binary.js";

const context = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 4e6, outputBytes: 4e6, cells: 100, sheets: 10, operations: 10 } };

it('reads large and mini compound streams through borrowed ranges and caller storage', async () => {
  const streams = new Map([['Workbook', Uint8Array.from({ length: 180000 }, (_, i) => i % 251)], ['Book', new Uint8Array(73).fill(9)]]);
  const bytes = writeCfb(streams, context), borrowed = new Uint8Array(257), fs = createMemoryFileSystem();
  let largest = 0, backingBytes = 0;
  const open = fs.open.bind(fs);
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args), write = handle.write.bind(handle);
    vi.spyOn(handle, 'write').mockImplementation(async (bytes, position, options) => {
      expect(bytes.length).toBeLessThanOrEqual(16384); backingBytes += bytes.length;
      return write(bytes, position, options);
    });
    return handle;
  });
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{
    id: 'cfb', description: 'fixture', extensions: [], async readSource(source, ctx) {
      const cfb = await readCfbRanges(source, ctx);
      try {
        expect([...cfb.streams.keys()]).toEqual([...readCfb(bytes, context).keys()]);
        for (const [name, expected] of streams) {
          const stream = cfb.streams.get(name)!; expect(stream.size).toBe(expected.length);
          for (const start of [0, Math.floor(expected.length / 2), Math.max(0, expected.length - 77)]) {
            const result = await stream.read(start, 16384);
            expect(result).toEqual(expected.subarray(start, start + result.length));
          }
        }
      } finally { await cfb.close(); }
      await expect(cfb.streams.get('Workbook')!.read(0, 1)).rejects.toThrow('closed');
      return { sheets: [] };
    }
  }] });
  await engine.readWorkbook({ kind: 'range', source: { size: bytes.length, async read(position, count) {
    largest = Math.max(largest, count); const length = Math.min(257, count); borrowed.set(bytes.subarray(position, position + length)); return borrowed.subarray(0, length);
  } } }, { importType: 'cfb' }, { signal: context.signal });
  expect(backingBytes).toBeLessThan(1024 * 1024);
  expect(largest).toBeLessThanOrEqual(16384); expect(await fs.readdir('/')).toEqual([]);
  await engine.dispose();
});

it('rejects a cyclic FAT chain without reading stream payloads', async () => {
  const bytes = writeCfb(new Map([['Workbook', new Uint8Array(9000)]]), context);
  const view = new DataView(bytes.buffer), fat = view.getUint32(76, true);
  view.setUint32((fat + 1) * 512, 0, true);
  const source = { size: bytes.length, async read(position: number, count: number) { return bytes.subarray(position, position + count); } };
  await expect(readCfbRanges(source, context)).rejects.toThrow('CFB');
});

it('uses the BIFF provider range hooks and preserves buffered workbook results', async () => {
  const { createBiffWriter, readBiff } = await import('./biff.js');
  const { xlsFormat } = await import('./index.js');
  const book = { sheets: [{ id: 's', name: 'Data', cells: [{ row: 0, column: 0, value: { kind: 'number' as const, value: 42 } }] }] };
  const bytes = await createBiffWriter(8)(book, [], context);
  const service = xlsFormat.services.find(service => service.direction === 'read')!;
  expect(service.readSource).toBeTypeOf('function'); expect(service.probeSource).toBeTypeOf('function');
  const source = { size: bytes.length, async read(position: number, count: number) { return bytes.subarray(position, position + Math.min(37, count)); } };
  expect(await service.probeSource!(source, context)).toBe(true);
  expect(await service.readSource!(source, context)).toEqual(await readBiff(bytes, context));
});

it.each([null, new Error('backend'), { code: 'opaque' }])('preserves opaque probe source failures %s', async failure => {
  const { probeBiff } = await import('./biff.js');
  await expect(probeBiff({ size: 512, async read() { throw failure; } }, context)).rejects.toBe(failure);
});
it('does not read after immediate cleanup or cancelled borrowed reads', async () => {
  const { readBiff } = await import('./biff.js');
  let reads = 0;
  const source = { size: 512, async read() { reads++; return new Uint8Array(8); } };
  await expect(readBiff(source, { ...context, own(cleanup) { void cleanup(); } })).rejects.toThrow('closed');
  expect(reads).toBe(0);
  const controller = new AbortController(), reason = { cancelled: true };
  await expect(readBiff({ size: 512, async read() { reads++; controller.abort(reason); return new Uint8Array(8); } }, {
    ...context, signal: controller.signal
  })).rejects.toBe(reason);
  expect(reads).toBe(1);
});
it('preserves probe backing-store failures', async () => {
  const { probeBiff } = await import('./biff.js');
  const { SsconvertError } = await import('@poe-code/spreadsheet-engine/contracts');
  const bytes = writeCfb(new Map([['Workbook', new Uint8Array(9000)]]), context), failure = new SsconvertError('io', 'storage failed');
  await expect(probeBiff({ size: bytes.length, async read(position, count) { return bytes.subarray(position, position + count); } }, {
    ...context, createWorkingStorage() { throw failure; }
  })).rejects.toBe(failure);
});

it.each([false, true])('reads version 4 sectors with external DIFAT=%s', async difat => {
  const content = new Uint8Array(4096).fill(17), original = writeCfb(new Map([['Workbook', content]]), context);
  const bytes = new Uint8Array((difat ? 5 : 4) * 4096), old = new DataView(original.buffer), view = new DataView(bytes.buffer);
  bytes.set(original.subarray(0, 512)); bytes.set(original.subarray((old.getUint32(48, true) + 1) * 512, (old.getUint32(48, true) + 2) * 512), 8192);
  view.setUint16(26, 4, true); view.setUint16(30, 12, true); view.setUint32(40, 1, true); view.setUint32(44, 1, true);
  view.setUint32(48, 1, true); view.setUint32(60, 0xfffffffe, true); view.setUint32(64, 0, true);
  for (let at = 76; at < 512; at += 4) view.setUint32(at, 0xffffffff, true);
  view.setUint32(68, difat ? 3 : 0xfffffffe, true); view.setUint32(72, difat ? 1 : 0, true);
  if (difat) { bytes.fill(255, 16384); view.setUint32(16384, 0, true); view.setUint32(20476, 0xfffffffe, true); }
  else view.setUint32(76, 0, true);
  bytes.fill(255, 4096, 8192); view.setUint32(4096, 0xfffffffd, true); view.setUint32(4100, 0xfffffffe, true); view.setUint32(4104, 0xfffffffe, true);
  view.setUint32(8192 + 116, 0xfffffffe, true); view.setUint32(8192 + 120, 0, true);
  view.setUint32(8192 + 128 + 116, 2, true); view.setUint32(8192 + 128 + 120, 4096, true);
  bytes.set(content, 12288);
  expect(readCfb(bytes, context).get('Workbook')).toEqual(content);
  const cfb = await readCfbRanges({ size: bytes.length, async read(position, count) { return bytes.subarray(position, position + Math.min(113, count)); } }, context);
  try { expect(await cfb.streams.get('Workbook')!.read(0, 4096)).toEqual(content); } finally { await cfb.close(); }
});

it.each(['xor', 'rc4', 'rc4-cryptoapi-40', 'rc4-cryptoapi-128-properties'])('preserves %s encrypted range imports', async encryption => {
  const { createBiffWriter, readBiff } = await import('./biff.js');
  const ctx = { ...context, password: { async read() { return encryption === 'xor' ? new Uint8Array([112, 97, 115, 115]) : 'password'; } },
    entropy: { async read({ length }: { length: number }) { return Uint8Array.from({ length }, (_, i) => i + 1); } } };
  const book = { properties: { title: 'Private title' }, sheets: [{ id: 's', name: 'Private', cells: [
    { row: 0, column: 0, value: { kind: 'string' as const, value: 'Retained text '.repeat(1500) } },
    { row: 1, column: 0, formula: '=41+1', value: { kind: 'number' as const, value: 42 } }
  ] }] };
  const bytes = await createBiffWriter(8)(book, [`encryption=${encryption}`], ctx), borrowed = new Uint8Array(257);
  const expected = await readBiff(bytes, ctx);
  const result = await readBiff({ size: bytes.length, async read(position, count) {
    const length = Math.min(count, borrowed.length); borrowed.set(bytes.subarray(position, position + length)); return borrowed.subarray(0, length);
  } }, ctx);
  expect(result).toEqual(expected);
});

it('matches buffered CFB structural admission for corrupted headers and directory references', async () => {
  const original = writeCfb(new Map([['Workbook', new Uint8Array(9000)], ['Small', new Uint8Array(91)]]), context);
  const header = new DataView(original.buffer), directory = (header.getUint32(48, true) + 1) * 512;
  const changes: [number, number][] = [[26, 99], [28, 0], [30, 12], [32, 9], [44, 0], [44, 100000], [48, 0xffffffff],
    [56, 8], [60, 0], [64, 100000], [68, 0], [72, 1], [76, 0xfffffffe], [80, header.getUint32(76, true)],
    [directory + 64, 65], [directory + 66, 2], [directory + 76, 0], [directory + 76, 100000],
    [directory + 128 + 68, 1], [directory + 128 + 72, 1], [directory + 128 + 116, 0xffffffff]];
  for (const [at, value] of changes) {
    const bytes = original.slice(), view = new DataView(bytes.buffer);
    if (at < 34 || at === directory + 64 || at === directory + 66) view.setUint16(at, value, true);
    else view.setUint32(at, value, true);
    let accepted = true;
    try { readCfb(bytes, context); } catch { accepted = false; }
    let rangeAccepted = true;
    try {
      const cfb = await readCfbRanges({ size: bytes.length, async read(position, count) { return bytes.subarray(position, position + count); } }, context);
      await cfb.close();
    } catch { rangeAccepted = false; }
    expect(rangeAccepted, `offset ${at}, value ${value}`).toBe(accepted);
  }
});
it('avoids whole-container byte allocations and ignored stream reads', async () => {
  const { createBiffWriter, readBiff } = await import('./biff.js');
  const original = await createBiffWriter(8)({ sheets: [{ id: 's', name: 'Data', cells: [] }] }, [], context);
  const streams = new Map(readCfb(original, context)); streams.set('Ignored', new Uint8Array(1024 * 1024));
  const bytes = writeCfb(streams, context), NativeBytes = Uint8Array;
  let maximum = 0, readBytes = 0;
  vi.stubGlobal('Uint8Array', new Proxy(NativeBytes, { construct(target, args, receiver) {
    const result = Reflect.construct(target, args, receiver) as Uint8Array; maximum = Math.max(maximum, result.byteLength); return result;
  } }));
  try {
    const result = await readBiff({ size: bytes.length, async read(position, count) {
      readBytes += count; return bytes.subarray(position, position + count);
    } }, context);
    expect(result.sheets[0]!.name).toBe('Data');
    expect(maximum).toBeLessThanOrEqual(16384); expect(readBytes).toBeLessThan(50000);
  } finally { vi.unstubAllGlobals(); }
});

it('converts retained safe-fs BIFF input with buffered hooks disabled and a slow bounded sink', async () => {
  const { createVfsInput } = await import('@poe-code/spreadsheet-engine/io/retained-input');
  const { csvFormat } = await import('@poe-code/spreadsheet-format-csv');
  const { createBiffWriter } = await import('./biff.js');
  const { xlsFormat } = await import('./index.js');
  const cells = Array.from({ length: 1000 }, (_, row) => ({ row, column: 0, value: { kind: 'string' as const, value: 'x'.repeat(50) + row } }));
  const bytes = await createBiffWriter(8)({ sheets: [{ id: 's', name: 'Data', cells }] }, [], { ...context, limits: { ...context.limits, cells: 2000 } });
  const fs = createMemoryFileSystem(); await fs.writeFile('/input.xls', bytes);
  const wholeFile = vi.fn(async () => { throw new Error('whole file API'); });
  // Preserve the backend's retained-identity implementation; instrument its injected facade.
  const injected = new Proxy(fs, { get(target, key) {
    if (key === 'readFile' || key === 'writeFile') return wholeFile;
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const buffered = vi.fn(async () => { throw new Error('buffered codec hook'); });
  const format = { ...xlsFormat, services: xlsFormat.services.map(service => service.direction === 'read' ? {
    ...service, read: buffered, probeContent: buffered
  } : service) };
  const engine = createEngine({ formats: [format, csvFormat], workingFiles: { fs: injected, directory: '/', cacheBytes: 16384 }, filesystem: {
    openInput: createVfsInput(injected), async read() { throw new Error('sequential input'); }, async write() { throw new Error('buffered output'); }
  } });
  let active = 0, output = '';
  try {
    const book = await engine.readWorkbook({ kind: 'resource', uri: '/input.xls' }, {}, { signal: context.signal });
    await engine.writeWorkbook(book, { kind: 'stream', sink: { async write(chunk) {
      expect(++active).toBe(1); expect(chunk.length).toBeLessThanOrEqual(16384);
      await Promise.resolve(); output += new TextDecoder().decode(chunk); active--;
    } } }, { exportType: 'Gnumeric_stf:stf_csv' }, { signal: context.signal });
    expect(output).toBe(cells.map(cell => cell.value.value + '\n').join(''));
    expect(buffered).not.toHaveBeenCalled(); expect(wholeFile).not.toHaveBeenCalled();
  } finally { await engine.dispose(); }
  expect((await fs.readdir('/')).map(entry => entry.name)).toEqual(['input.xls']);
});

it('coalesces small BIFF record reads before accessing the retained backend', async () => {
  const { createBiffWriter, readBiff } = await import('./biff.js');
  const cells = Array.from({ length: 1000 }, (_, row) => ({ row, column: 0, value: { kind: 'number' as const, value: row } }));
  const ctx = { ...context, limits: { ...context.limits, cells: 2000 } };
  const bytes = await createBiffWriter(8)({ sheets: [{ id: 's', name: 'Data', cells }] }, [], ctx);
  let reads = 0;
  const book = await readBiff({ size: bytes.length, async read(position, count) {
    reads++; return bytes.subarray(position, position + Math.min(count, 257));
  } }, ctx);
  expect(book.sheets[0]!.cells).toHaveLength(1000);
  expect(reads).toBeLessThan(500);
});

it('forwards a stream-read cancellation signal into the retained backend', async () => {
  const bytes = writeCfb(new Map([['Workbook', new Uint8Array(9000)]]), context), controller = new AbortController();
  const reason = new Error('cancel one read'); let armed = false, received: AbortSignal | undefined;
  const cfb = await readCfbRanges({ size: bytes.length, async read(position, count, options) {
    if (armed) { received = options?.signal; controller.abort(reason); }
    return bytes.subarray(position, position + count);
  } }, context);
  try {
    armed = true;
    await expect(cfb.streams.get('Workbook')!.read(1000, 16, { signal: controller.signal })).rejects.toBe(reason);
    expect(received?.aborted).toBe(true);
  } finally { await cfb.close(); }
});
