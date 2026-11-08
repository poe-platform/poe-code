import assert from "node:assert/strict";
import test from "node:test";
import { ZipMetadataMap } from "./zip/metadata.js";
import type { ZipMetadataSpool } from "./zip-format.js";

test("metadata maps spill bounded runs while preserving replacement and insertion order", async () => {
  let active = 0, maximum = 0, largest = 0;
  const factory = async (): Promise<ZipMetadataSpool> => {
    active++; maximum = Math.max(maximum, active);
    const chunks: Uint8Array[] = [];
    let closed = false;
    return {
      async append(bytes) { largest = Math.max(largest, bytes.length); chunks.push(new Uint8Array(bytes)); },
      async finish() {
        const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        chunks.length = 0;
        return { size: bytes.length, async read(start, length) { return bytes.slice(start, start + length); } };
      },
      async close() { if (!closed) { active--; closed = true; } },
    };
  };
  const signal = new AbortController().signal;
  const map = new ZipMetadataMap<{ value: number; bytes: Uint8Array; date: Date }>(factory, signal, 4);
  const expected = new Map<string, { value: number; bytes: Uint8Array; date: Date }>();
  for (let index = 0; index < 125; index++) {
    const key = `item-${index % 37}`;
    const value = { value: index, bytes: Uint8Array.of(index), date: new Date(index) };
    await map.set(key, value); expected.set(key, value);
    if (index % 7 === 0) { await map.delete(key); expected.delete(key); }
  }
  assert.equal(map.size, expected.size);
  const actual = [];
  for await (const entry of map.entries()) actual.push(entry);
  assert.deepEqual(actual, [...expected.entries()]);
  for (const [key, value] of expected) assert.deepEqual(await map.get(key), value);
  assert.ok(maximum <= 24, `active scratch files: ${maximum}`);
  assert.ok(largest <= 65536);
  await map.close();
  assert.equal(active, 0);
});

test("metadata byte pressure spills large records before the entry-count window", async () => {
  let created = 0;
  const factory = async (): Promise<ZipMetadataSpool> => {
    created++;
    const chunks: Uint8Array[] = [];
    return {
      async append(bytes) { chunks.push(new Uint8Array(bytes)); },
      async finish() {
        const data = new Uint8Array(chunks.reduce((size, bytes) => size + bytes.length, 0));
        let offset = 0;
        for (const bytes of chunks) { data.set(bytes, offset); offset += bytes.length; }
        return { size: data.length, async read(offset, length) { return data.slice(offset, offset + length); } };
      },
      async close() { chunks.length = 0; },
    };
  };
  const map = new ZipMetadataMap<{ name: string; extra: Uint8Array }>(factory, new AbortController().signal);
  const value = { name: "large".repeat(16000), extra: new Uint8Array(65535).fill(17) };
  await map.set("one", value);
  assert.ok(created > 0, "one large record must spill without waiting for 64 members");
  assert.deepEqual(await map.get("one"), value);
  const before = created;
  for (let index = 0; index < 8; index++) await map.set(`medium-${index}`, { name: "a".repeat(10000), extra: new Uint8Array(1) });
  assert.ok(created > before, "aggregate metadata bytes must also trigger spilling");
  assert.equal(map.size, 9);
  await map.close();
});
