import { expect, it } from "vitest";
import { createZipCodec, crc32 } from "./zip.js";
import type { ZipMetadataStorage } from "./zip-index.js";

const limits = { maxArchiveBytes: 1e7, maxEntryBytes: 1e7, maxTotalBytes: 1e7, maxMembers: 1000,
  maxPathBytes: 65535, maxDepth: 32, maxPaxBytes: 65535, maxTextBytes: 65535, chunkSize: 4096 };
const signal = new AbortController().signal;
function storage() {
  const pages = new Map<number, Uint8Array>(); let next = 8, maximum = 0;
  const api: ZipMetadataStorage = { allocate(length) { const start = next; next += length; return start; },
    async read(position, length) {
      expect(length).toBeLessThanOrEqual(16384);
      const result = new Uint8Array(length);
      for (let i = 0; i < length; i++) result[i] = pages.get(Math.floor((position + i) / 16384))?.[(position + i) % 16384] ?? 0;
      return result;
    },
    async write(position, bytes) {
      maximum = Math.max(maximum, bytes.length); expect(bytes.length).toBeLessThanOrEqual(16384);
      for (let i = 0; i < bytes.length; i++) {
        const key = Math.floor((position + i) / 16384);
        let page = pages.get(key); if (!page) { page = new Uint8Array(16384); pages.set(key, page); }
        page[(position + i) % 16384] = bytes[i]!;
      }
    } };
  return { api, maximum: () => maximum, allocated: () => next - 8 };
}

it("stages ZIP members and directory through caller storage with exact archive bytes", async () => {
  const zip = createZipCodec();
  const entries = [];
  for (let i = 0; i < 4; i++) entries.push(await zip.makeZipEntry(`part-${i}.xml`, new TextEncoder().encode(`part${i}`.repeat(10000)),
    { modified: new Date("2000-01-01Z"), mode: 0o644, directory: false, symlink: false, compression: i % 2 ? "deflate" : "store" }, limits, signal));
  const backing = storage(), writer = zip.createStagedWriter(backing.api, limits, signal);
  for (const entry of entries) await writer.add(entry);
  const chunks: Uint8Array[] = [];
  for await (const chunk of writer.finish()) { expect(chunk.length).toBeLessThanOrEqual(limits.chunkSize); await Promise.resolve(); chunks.push(chunk.slice()); }
  expect(Buffer.concat(chunks)).toEqual(Buffer.from(await zip.writeZipArchive({ entries, comment: new Uint8Array() }, limits, signal)));
  expect(backing.allocated()).toBe(Buffer.concat(chunks).length - 22 + entries.length * 48); expect(backing.maximum()).toBeLessThanOrEqual(16384);
  await expect(writer.add(entries[0]!)).rejects.toThrow();
});

it.each([false, true])("captures reused streamed bytes with payload validation=%s", async validatePayloads => {
  const zip = createZipCodec(undefined, { validatePayloads, rejectDuplicateNames: true });
  const bytes = new TextEncoder().encode("abc<&".repeat(4000));
  const entry = await zip.makeZipEntry("folder/a.xml", bytes, { modified: new Date("2000-01-01Z"),
    mode: 0o644, directory: false, symlink: false, compression: "store" }, limits, signal);
  const backing = storage(), writer = zip.createStagedWriter(backing.api, limits, signal), reused = new Uint8Array(127);
  let closed = false;
  async function* input() {
    try {
      for (let offset = 0; offset < entry.data.length; offset += reused.length) {
        const size = Math.min(reused.length, entry.data.length - offset);
        reused.fill(0); reused.set(entry.data.subarray(offset, offset + size)); yield reused.subarray(0, size);
      }
    } finally { reused.fill(255); closed = true; }
  }
  await writer.add({ ...entry, data: input(), compressedSize: entry.data.length });
  expect(closed).toBe(true);
  const chunks: Uint8Array[] = [];
  for await (const chunk of writer.finish(Uint8Array.of(97, 98))) chunks.push(chunk);
  expect(Buffer.concat(chunks)).toEqual(Buffer.from(await zip.writeZipArchive({ entries: [entry], comment: Uint8Array.of(97, 98) }, limits, signal)));
});

it.each(["source", "storage", "cancel", "size", "crc"])("revokes failed staged writers and closes member sources after %s", async mode => {
  const zip = createZipCodec(undefined, { validatePayloads: true }), controller = new AbortController();
  const entry = await zip.makeZipEntry("a", Uint8Array.of(1, 2, 3), { modified: new Date("2000-01-01Z"),
    mode: 0o644, directory: false, symlink: false, compression: "store" }, limits, signal);
  const backing = storage(), reason = new Error(mode); let closed = false;
  async function* input() {
    try {
      yield Uint8Array.of(1);
      if (mode === "source") throw reason;
      if (mode === "cancel") controller.abort(reason);
      if (mode === "storage") backing.api.write = async () => { throw reason; };
      yield mode === "size" ? Uint8Array.of(2) : mode === "crc" ? Uint8Array.of(2, 4) : Uint8Array.of(2, 3);
    } finally { closed = true; }
  }
  const writer = zip.createStagedWriter(backing.api, limits, controller.signal);
  const adding = writer.add({ ...entry, data: input(), compressedSize: entry.data.length });
  if (["source", "storage", "cancel"].includes(mode)) await expect(adding).rejects.toBe(reason);
  else await expect(adding).rejects.toThrow();
  expect(closed).toBe(true);
  await expect(writer.finish().next()).rejects.toThrow();
});

it("checks duplicates and cumulative archive budgets before publication", async () => {
  const zip = createZipCodec(undefined, { rejectDuplicateNames: true });
  const entry = await zip.makeZipEntry("a", Uint8Array.of(1), { modified: new Date("2000-01-01Z"),
    mode: 0o644, directory: false, symlink: false, compression: "store" }, limits, signal);
  const writer = zip.createStagedWriter(storage().api, limits, signal);
  await writer.add(entry);
  await expect(writer.add(entry)).rejects.toThrow("duplicate");
  await expect(writer.finish().next()).rejects.toThrow();
  const bounded = zip.createStagedWriter(storage().api, { ...limits, maxArchiveBytes: 40 }, signal);
  await expect(bounded.add(entry)).rejects.toThrow();
});

it("does not read ahead of a paused consumer and owns borrowed storage responses", async () => {
  const zip = createZipCodec(), backing = storage(), read = backing.api.read.bind(backing.api);
  const reused = new Uint8Array(16384); let reads = 0;
  backing.api.read = async (position, length) => { reads++; reused.fill(0); reused.set(await read(position, length)); return reused.subarray(0, length); };
  const entry = await zip.makeZipEntry("a", new Uint8Array(10000).fill(42), { modified: new Date("2000-01-01Z"),
    mode: 0o644, directory: false, symlink: false, compression: "store" }, limits, signal);
  const writer = zip.createStagedWriter(backing.api, limits, signal); await writer.add(entry);
  const output = writer.finish(), first = (await output.next()).value!, snapshot = first.slice();
  const paused = reads; await Promise.resolve(); expect(reads).toBe(paused);
  await output.next(); expect(first).toEqual(snapshot);
  await output.return(undefined); const ended = reads; await Promise.resolve(); expect(reads).toBe(ended);
});

it("keeps outstanding writes bounded for generated multi-chunk members", async () => {
  const zip = createZipCodec(), backing = storage(), write = backing.api.write.bind(backing.api);
  let outstanding = 0, peak = 0, transferred = 0;
  backing.api.write = async (position, bytes) => {
    outstanding += bytes.length; peak = Math.max(peak, outstanding); transferred += bytes.length;
    try { await Promise.resolve(); await write(position, bytes); } finally { outstanding -= bytes.length; }
  };
  const chunk = new Uint8Array(4096).fill(42), count = 128, size = chunk.length * count;
  let checksum = 0;
  for (let i = 0; i < count; i++) checksum = crc32(chunk, checksum);
  let produced = 0;
  async function* input() { for (let i = 0; i < count; i++) { produced++; yield chunk; } }
  const writer = zip.createStagedWriter(backing.api, limits, signal);
  await writer.add({ name: "large.bin", size, compressedSize: size, data: input(), crc32: checksum, method: 0,
    modified: new Date("2000-01-01Z"), mode: 0o644, directory: false, symlink: false });
  expect(produced).toBe(count); expect(peak).toBeLessThanOrEqual(limits.chunkSize);
  expect(transferred).toBeGreaterThan(size); expect(transferred).toBeLessThan(size + 1024);
  let emitted = 0;
  for await (const bytes of writer.finish()) { expect(bytes.length).toBeLessThanOrEqual(limits.chunkSize); emitted += bytes.length; }
  expect(emitted).toBeGreaterThan(size); expect(emitted).toBeLessThan(size + 1024);
});

it("does not pull a member after cancellation during header storage", async () => {
  const controller = new AbortController(), reason = new Error("cancelled header"), backing = storage();
  backing.api.write = async () => { controller.abort(reason); };
  let pulled = false;
  async function* input() { pulled = true; yield Uint8Array.of(42); }
  const writer = createZipCodec().createStagedWriter(backing.api, limits, controller.signal);
  await expect(writer.add({ name: "a", size: 1, compressedSize: 1, crc32: 0, method: 0, data: input(),
    modified: new Date("2000-01-01Z"), mode: 0o644, directory: false, symlink: false })).rejects.toBe(reason);
  expect(pulled).toBe(false);
});
