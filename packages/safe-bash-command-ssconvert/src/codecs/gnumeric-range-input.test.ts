import { expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { readGnumeric, probeGnumeric } from "./gnumeric.js";
import provider from "./providers/xml.js";
import { defaultSsconvertLimits, type CapabilityContext } from "@poe-code/spreadsheet-engine";

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, limits: defaultSsconvertLimits,
  environment: { env: {}, locale: 'C', timezone: 'UTC' } };
const value = 'valueé'.repeat(10000);
function fixture(encoding: string, gzip: boolean) {
  const xml = `<?xml version="1.0" encoding="${encoding}"?><g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>Data</g:Name><g:Cells><g:Cell Row="0" Col="0" ValueType="60">${value}</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>`;
  let bytes = new TextEncoder().encode(xml);
  if (encoding.startsWith('UTF-16')) {
    bytes = new Uint8Array(2 + xml.length * 2); const view = new DataView(bytes.buffer), little = encoding === 'UTF-16LE';
    view.setUint16(0, 0xfeff, little);
    for (let i = 0; i < xml.length; i++) view.setUint16(2 + 2 * i, xml.charCodeAt(i), little);
  } else if (encoding === 'ISO-8859-1') bytes = Uint8Array.from(xml, c => c.charCodeAt(0));
  return gzip ? new Uint8Array(gzipSync(bytes)) : bytes;
}
it.each(['UTF-8', 'UTF-16LE', 'UTF-16BE', 'ISO-8859-1'])('reads %s through bounded borrowed ranges and decoding', async encoding => {
  for (const gzip of [false, true]) {
    const bytes = fixture(encoding, gzip), reused = new Uint8Array(257);
    let maximum = 0;
    const decode = TextDecoder.prototype.decode;
    const spy = vi.spyOn(TextDecoder.prototype, 'decode').mockImplementation(function(this: TextDecoder, bytes, options) {
      maximum = Math.max(maximum, bytes?.byteLength ?? 0); return decode.call(this, bytes, options);
    });
    try {
      const source = { size: bytes.length, async read(position: number, count: number) {
        expect(count).toBeLessThanOrEqual(16384);
        const length = Math.min(count, reused.length, bytes.length - position);
        reused.set(bytes.subarray(position, position + length)); return reused.subarray(0, length);
      } };
      const book = await readGnumeric(source, context);
      expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: 'string', value });
      expect(maximum).toBeLessThanOrEqual(16384);
    } finally { spy.mockRestore(); }
  }
});
it('registers range input for the Gnumeric provider', () => {
  const reader = provider.services.find(service => service.direction === 'read');
  expect(reader).toHaveProperty('probeSource', expect.any(Function));
  expect(reader).toHaveProperty('readSource', expect.any(Function));
});
it.each([null, new Error('source failure')])('preserves range backend failure identity (%s)', async failure => {
  const source = { size: 10, async read() { throw failure; } };
  await expect(readGnumeric(source, context)).rejects.toBe(failure);
  await expect(probeGnumeric(source, context)).rejects.toBe(failure);
});

it.each(['padding', 'garbage', 'member'])('preserves strict gzip rejection of trailing %s', async kind => {
  const first = fixture('UTF-8', true);
  const tail = kind === 'padding' ? Uint8Array.of(0) : kind === 'garbage' ? Uint8Array.of(65) : new Uint8Array(gzipSync(' '));
  const bytes = new Uint8Array(first.length + tail.length); bytes.set(first); bytes.set(tail, first.length);
  await expect(readGnumeric(bytes, context)).rejects.toMatchObject({ code: 'io' });
});

it('avoids payload-sized byte allocations when inflating retained input', async () => {
  const bytes = fixture('UTF-8', true), NativeBytes = Uint8Array;
  let maximum = 0;
  vi.stubGlobal('Uint8Array', new Proxy(NativeBytes, { construct(target, args, receiver) {
    const result = Reflect.construct(target, args, receiver) as Uint8Array;
    maximum = Math.max(maximum, result.byteLength); return result;
  } }));
  try {
    const book = await readGnumeric({ size: bytes.length, async read(position, count) { return bytes.subarray(position, position + count); } }, context);
    expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: 'string', value });
    expect(maximum).toBeLessThanOrEqual(32768);
  } finally { vi.unstubAllGlobals(); }
});
it.each([false, true])('preserves cancellation after a borrowed range read, gzip=%s', async gzip => {
  const bytes = fixture('UTF-8', gzip), controller = new AbortController(), reason = { cancelled: true };
  let bodyReads = 0;
  const source = { size: bytes.length, async read(position: number, count: number) {
    if (position === 0 && count > 2) { bodyReads++; controller.abort(reason); }
    return bytes.subarray(position, position + count);
  } };
  await expect(readGnumeric(source, { ...context, signal: controller.signal })).rejects.toBe(reason);
  expect(bodyReads).toBe(1);
});
it('does not acquire input after immediate cleanup', async () => {
  const read = vi.fn(async () => new Uint8Array(2));
  await expect(readGnumeric({ size: 2, read }, { ...context, own(cleanup) { void cleanup(); } })).rejects.toMatchObject({ code: 'io' });
  expect(read).not.toHaveBeenCalled();
});
it.each([false, true])('imports Gnumeric files through injected safe-fs without buffered hooks, gzip=%s', async gzip => {
  const { createMemoryFileSystem } = await import('@poe-code/safe-fs/core');
  const { csvFormat } = await import('@poe-code/spreadsheet-format-csv');
  const { createCommandArguments } = await import('safe-bash-contracts/command');
  const { toByteSource } = await import('safe-bash-contracts/io');
  const { createSsconvertCommand } = await import('../commands.js');
  const fs = createMemoryFileSystem(); await fs.writeFile('/input.gnumeric', fixture('UTF-8', gzip));
  const readFile = fs.readFile.bind(fs), writeFile = fs.writeFile.bind(fs), open = fs.open.bind(fs);
  vi.spyOn(fs, 'readFile').mockRejectedValue(new Error('whole-file read'));
  vi.spyOn(fs, 'writeFile').mockImplementation(async (path, bytes, options) => { expect(bytes.length).toBe(0); await writeFile(path, bytes, options); });
  let pending = 0, maximum = 0;
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args), write = handle.write.bind(handle);
    vi.spyOn(handle, 'write').mockImplementation(async (bytes, position, options) => {
      pending++; maximum = Math.max(maximum, bytes.length); expect(pending).toBe(1);
      try { await Promise.resolve(); return await write(bytes, position, options); } finally { pending--; }
    });
    return handle;
  });
  const buffered = vi.fn(() => { throw new Error('buffered reader'); });
  const formats = [{ ...provider, services: provider.services.map(service => service.direction === 'read' ? { ...service, read: buffered, probeContent: buffered } : service) }, csvFormat];
  const args = createCommandArguments(['-T', 'Gnumeric_stf:stf_csv', '/input.gnumeric', '/output.csv']);
  const cleanups: (() => void | Promise<void>)[] = [], errors: string[] = [];
  try {
    const result = await createSsconvertCommand({ formats }).execute({ command: 'ssconvert', args: args.args, argumentValues: args,
      cwd: '/', env: {}, fs, signal: new AbortController().signal, stdin: toByteSource(''),
      stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(new TextDecoder().decode(bytes)); } },
      registerCleanup(cleanup) { cleanups.push(cleanup); } });
    expect(result, errors.join('')).toMatchObject({ exitCode: 0 });
    expect(new TextDecoder().decode(await readFile('/output.csv'))).toBe(value + '\n');
    expect(buffered).not.toHaveBeenCalled(); expect(maximum).toBeLessThanOrEqual(16384);
  } finally { for (const cleanup of cleanups.reverse()) await cleanup(); }
  expect((await fs.readdir('/')).map(entry => entry.name).sort()).toEqual(['input.gnumeric', 'output.csv']);
});

it.each([false, true])('captures explicit mutable byte input before yielding, gzip=%s', async gzip => {
  const bytes = fixture('UTF-8', gzip), reading = readGnumeric(bytes, context);
  bytes.fill(0);
  expect((await reading).sheets[0]!.cells[0]!.value).toEqual({ kind: 'string', value });
});
it('captures retained size and read capability before yielding', async () => {
  const bytes = fixture('UTF-8', true);
  const source = { size: bytes.length, async read(position: number, count: number) { return bytes.subarray(position, position + count); } };
  const reading = readGnumeric(source, context);
  source.size = 0; source.read = async () => { throw new Error('replacement reader'); };
  expect((await reading).sheets[0]!.cells[0]!.value).toEqual({ kind: 'string', value });
});
it('bounds inflated bytes even when the gzip trailer understates the size', async () => {
  const bytes = fixture('UTF-8', true);
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(bytes.length - 4, 0, true);
  await expect(readGnumeric({ size: bytes.length, async read(position, count) { return bytes.subarray(position, position + count); } }, {
    ...context, limits: { ...context.limits, inflatedBytes: 1024 }
  })).rejects.toMatchObject({ code: 'resource-limit' });
});

it.each([false, true])('owns byte subclasses with borrowed slice semantics, gzip=%s', async gzip => {
  class BorrowedSlice extends Uint8Array {
    override slice(start?: number, end?: number) { return this.subarray(start, end); }
  }
  const bytes = new BorrowedSlice(fixture('UTF-8', gzip));
  const reading = readGnumeric(bytes, context);
  bytes.fill(0);
  expect((await reading).sheets[0]!.cells[0]!.value).toEqual({ kind: 'string', value });
});
