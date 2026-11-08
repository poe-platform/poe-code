import {expect, it} from "vitest";
import {createZipCodec, type ZipMetadataStorage} from "./zip.js";
import {createCompressionCodec} from "./compression.js";

const limits = {maxArchiveBytes: 65536, maxEntryBytes: 65536, maxTotalBytes: 65536, maxMembers: 20, maxPathBytes: 256, maxDepth: 16, maxPaxBytes: 1024, maxTextBytes: 1024, chunkSize: 512};
const signal = new AbortController().signal;
const runtime = {compression: createCompressionCodec(), yieldTurn: async (signal: AbortSignal) => signal.throwIfAborted(), fail(message: string): never {throw new Error(message);}};
const codec = createZipCodec(runtime);
function storage(): ZipMetadataStorage {
  const bytes = new Uint8Array(65536);
  let end = 8;
  return {
    allocate(length) {const position = end; end += length; return position;},
    async read(position, length) {return bytes.slice(position, position + length);},
    async write(position, data) {bytes.set(data, position);}
  };
}
async function archive(names = ["first", "middle", "last"]): Promise<Uint8Array> {
  const entries = await Promise.all(names.map(name => codec.makeZipEntry(name, new TextEncoder().encode(name), {modified: new Date("1980-01-01T00:00:00Z"), mode: 0o100644, directory: false, symlink: false, compression: "store"}, limits, signal)));
  return codec.writeZipArchive({entries, comment: new Uint8Array()}, limits, signal);
}
function reorder(bytes: Uint8Array, order: number[]): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  const start = view.getUint32(end + 16, true);
  const records: Uint8Array[] = [];
  for (let offset = start; offset < end;) {
    const length = 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    records.push(bytes.slice(offset, offset + length));
    offset += length;
  }
  const selected = order.map(index => records[index]!);
  const directorySize = selected.reduce((size, record) => size + record.length, 0);
  const result = Buffer.concat([bytes.subarray(0, start), ...selected, bytes.subarray(end)]);
  const output = new DataView(result.buffer, result.byteOffset, result.byteLength);
  output.setUint16(result.length - 14, order.length, true);
  output.setUint16(result.length - 12, order.length, true);
  output.setUint32(result.length - 10, directorySize, true);
  return result;
}
const source = (bytes: Uint8Array) => ({size: bytes.length, async read(position: number, length: number) {return bytes.subarray(position, position + length);}});

it("validates contiguous local spans independently of central-directory visitation order", async () => {
  const bytes = reorder(await archive(), [2, 0, 1]);
  const names: string[] = [];
  const result = await codec.readZipArchive(source(bytes), limits, signal, {storage: storage(), async onEntry(entry) {
    names.push(entry.name);
    const chunks: Uint8Array[] = [];
    for await (const chunk of codec.decodeZipEntry(entry, limits, signal)) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString()).toBe(entry.name);
  }});
  expect(names).toEqual(["last", "first", "middle"]);
  expect(result.members).toBe(3);
});

it.each([[0, 2], [0, 0, 2]])("rejects missing or multiply referenced local spans (%j)", async (...order) => {
  const bytes = reorder(await archive(), order);
  await expect(codec.readZipArchive(source(bytes), limits, signal, {storage: storage(), async onEntry() {}})).rejects.toThrow("overlapping spans");
});

it("rejects duplicate names before publishing the repeated provisional entry", async () => {
  const bytes = await archive(["same", "same"]);
  const strict = createZipCodec(runtime, {rejectDuplicateNames: true});
  let visits = 0;
  await expect(strict.readZipArchive(source(bytes), limits, signal, {storage: storage(), async onEntry() {visits++;}})).rejects.toThrow("duplicate member name");
  expect(visits).toBe(1);
});

it("awaits provisional entry visitors before advancing the archive scan", async () => {
  const bytes = await archive();
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => {enter = resolve;});
  const released = new Promise<void>(resolve => {release = resolve;});
  let visits = 0, reads = 0;
  const pending = codec.readZipArchive({size: bytes.length, async read(position, length) {reads++; return bytes.subarray(position, position + length);}}, limits, signal, {storage: storage(), async onEntry() {
    if (++visits === 1) {enter(); await released;}
  }});
  try {
    await entered;
    const paused = reads;
    await Promise.resolve();
    expect(reads).toBe(paused);
    expect(visits).toBe(1);
  } finally {release(); await pending;}
  expect(visits).toBe(3);
});

it.each(["storage", "visitor", "cancel"])("preserves %s failures without visiting subsequent entries", async kind => {
  const bytes = await archive();
  const controller = new AbortController();
  const failure = {kind};
  const backing = storage();
  if (kind === "storage") backing.write = async () => {throw failure;};
  let visits = 0;
  await expect(codec.readZipArchive(source(bytes), limits, controller.signal, {storage: backing, async onEntry() {
    visits++;
    if (kind === "cancel") controller.abort(failure);
    else throw failure;
  }})).rejects.toBe(failure);
  expect(visits).toBe(kind === "storage" ? 0 : 1);
});
