import { afterEach, expect, it, vi } from "vitest";
import { createObjectFilePublicationConformanceCases } from "../src/testing/object-publication.js";
import { ObjectIoMetrics, measureObjectIoStore } from "../src/testing/object-io-metrics.js";
import { PythonStatTranslator } from "../src/python/stat.js";
import { toByteSource } from "../src/contracts/io.js";
import type { ObjectFilePublicationStore } from "../src/fs/object-publication/index.js";
import { createR2StagingFixture } from "./integration/object-staging-workerd.fixture.mjs";

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  vi.stubGlobal("FixedLengthStream", class extends TransformStream { constructor(_size: number) { super(); } });
  const objects = new Map<string, Uint8Array>();
  const bucket = {
    async put(key: string, source: Uint8Array | ReadableStream<Uint8Array>) {
      if (source instanceof Uint8Array) { objects.set(key, source.slice()); return; }
      const chunks: Uint8Array[] = [];
      for await (const chunk of source) chunks.push(chunk.slice());
      const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      objects.set(key, bytes);
    },
    async get(key: string, options?: { range: { offset: number; length: number } }) {
      const bytes = objects.get(key);
      return bytes && { async arrayBuffer() {
        const range = options?.range;
        return (range ? bytes.slice(range.offset, range.offset + range.length) : bytes.slice()).buffer;
      } };
    },
    async delete(key: string) { objects.delete(key); },
    async list({ prefix }: { prefix: string }) {
      return { objects: [...objects.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })), truncated: false };
    },
  };
  const backend = createR2StagingFixture(bucket, { chunkBytes: 4, delayed: false, spill: true });
  return { ...backend, bucket, root: "/", async dispose() { await backend.dispose(); expect(objects.size).toBe(0); } };
}

for (const entry of createObjectFilePublicationConformanceCases({ createFixture: fixture, requireStaging: true })) {
  it(entry.name, entry.run);
}

it("provides canonical metadata for the actual Python stat projection", async () => {
  const backend = fixture();
  const version = await backend.store.publish('/stat', null, toByteSource(new Uint8Array([1])), { size: 1, mode: 0o600 });
  try {
    const stat = new PythonStatTranslator().translate(await backend.fs.stat('/stat'));
    expect(stat).toMatchObject({ dev: 1, ino: 1, nlink: 1, uid: 0, gid: 0, size: 1, mode: 0o600 });
  } finally { await version.close(); await backend.dispose(); }
});

it("a rejected backend upload cannot strand a backpressured publication pump", { timeout: 250 }, async () => {
  const backend = fixture();
  const reason = new Error("backend upload failed");
  vi.spyOn(backend.bucket, "put").mockRejectedValue(reason);
  try {
    await expect(backend.store.publish('/failed', null, toByteSource(new Uint8Array([1, 2, 3, 4])), { size: 4, mode: 0o600 })).rejects.toBe(reason);
    expect(await backend.store.acquire('/failed', { access: 'read' })).toBeUndefined();
  } finally { await backend.dispose(); }
});

it("uses a fresh R2 key for every acknowledged page revision and truncation", async () => {
  const backend = fixture();
  const uploads = vi.spyOn(backend.bucket, "put");
  const store: ObjectFilePublicationStore = backend.store;
  const stage = await store.createStaging!('/pages', { chunkBytes: 4, maxFileBytes: 16 });
  try {
    await stage.writePage(0, new Uint8Array([1, 2, 3, 4]));
    await stage.writePage(0, new Uint8Array([5, 6, 7, 8]));
    expect(await stage.readPage(0)).toEqual(new Uint8Array([5, 6, 7, 8]));
    await stage.truncate(2);
    expect(await stage.readPage(0)).toEqual(new Uint8Array([5, 6, 0, 0]));
    const keys = uploads.mock.calls.map(([key]) => key);
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(keys.length);
  } finally { await stage.close(); await backend.dispose(); }
});

it("keeps the acknowledged revision after a cancelled upload and drains orphaned revisions", async () => {
  const backend = fixture();
  const store: ObjectFilePublicationStore = backend.store;
  const stage = await store.createStaging!('/cancelled', { chunkBytes: 4, maxFileBytes: 16 });
  const controller = new AbortController();
  const reason = new Error('cancelled after upload');
  try {
    await stage.writePage(0, new Uint8Array([1, 2, 3, 4]));
    const put = backend.bucket.put.bind(backend.bucket);
    vi.spyOn(backend.bucket, "put").mockImplementationOnce(async (...args) => {
      await put(...args);
      controller.abort(reason);
    });
    await expect(stage.writePage(0, new Uint8Array([5, 6, 7, 8]), { signal: controller.signal })).rejects.toBe(reason);
    expect(await stage.readPage(0)).toEqual(new Uint8Array([1, 2, 3, 4]));
  } finally { await stage.close(); await backend.dispose(); }
});

it("separates descriptor page I/O, publication and retained version reads by phase", async () => {
  const backend = fixture();
  const metrics = new ObjectIoMetrics();
  const store = measureObjectIoStore(backend.store, metrics);
  const stage = await store.createStaging!('/measured', { chunkBytes: 4, maxFileBytes: 16 });
  try {
    metrics.phase("guestWrite");
    await stage.writePage(0, new Uint8Array([1, 2, 3, 4]));
    metrics.phase("publication");
    const page = await stage.readPage(0);
    const published = await store.publish!('/measured', null, toByteSource(page!), { size: 4, mode: 0o600 });
    await published.close();
    metrics.phase("guestReadback");
    const retained = await store.acquire('/measured', { access: 'read' });
    try { expect(await retained!.read(0, 4)).toEqual(page); }
    finally { await retained!.close(); }
    const phases = metrics.snapshot();
    expect(phases.guestWrite!.operations["staging.writePage"]!.count).toBe(1);
    expect(phases.publication!.operations["staging.readPage"]!.count).toBe(1);
    expect(phases.publication!.operations["store.publish"]!.count).toBe(1);
    expect(phases.guestReadback!.operations["version.read"]!.count).toBe(1);
    expect(phases.guestReadback!.operations["store.acquire"]!.count).toBe(1);
  } finally { await stage.close(); await backend.dispose(); }
});
