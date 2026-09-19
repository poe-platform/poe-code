import { afterEach, expect, it, vi } from "vitest";
import { createObjectFilePublicationConformanceCases } from "../src/testing/object-publication.js";
import { PythonStatTranslator } from "../src/python/stat.js";
import { toByteSource } from "../src/contracts/io.js";
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
