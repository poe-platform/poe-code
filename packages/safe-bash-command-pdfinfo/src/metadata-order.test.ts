import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { sortMetadataIndices } from "./metadata-order.js";

it("sorts custom metadata in stable locale order through bounded caller-backed runs", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/tmp");
  let largestWrite = 0, maxFiles = 0;
  const backed = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return async () => { throw new Error("payload-wide I/O forbidden"); };
    if (key === "createStagedFile") return async (...args: Parameters<typeof fs.createStagedFile>) => {
      const staging = await target.createStagedFile(...args); const writer = staging.writer!; maxFiles = Math.max(maxFiles, (await fs.readdir("/tmp")).length);
      return { ...staging, writer: { ...writer, async write(...values: Parameters<typeof writer.write>) {
        largestWrite = Math.max(largestWrite, values[0].length); return writer.write(...values);
      } } };
    };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  const count = 4096;
  const compare = (a: number, b: number) => String(a % 137).localeCompare(String(b % 137));
  const expected = Array.from({ length: count }, (_, i) => i).sort(compare);
  async function* indices() { for (let i = 0; i < count; i++) yield i; }
  const actual: number[] = [];
  for await (const index of sortMetadataIndices(indices(), compare, { fs: backed, directory: "/tmp" })) actual.push(index);
  assert.deepEqual(actual, expected); assert.ok(largestWrite > 0 && largestWrite <= 512); assert.ok(maxFiles <= 10);
  assert.deepEqual(await fs.readdir("/tmp"), []);
});

it("cleans sort runs on early return and preserves producer failure", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/tmp"); const storage = { fs, directory: "/tmp" };
  const failure = new Error("metadata lookup failure");
  async function* indices(fail = false) { for (let i = 300; i >= 0; i--) yield i; if (fail) throw failure; }
  for await (const index of sortMetadataIndices(indices(), (a, b) => a - b, storage)) { assert.equal(index, 0); break; }
  assert.deepEqual(await fs.readdir("/tmp"), []);
  await assert.rejects(async () => { for await (const ignored of sortMetadataIndices(indices(true), (a, b) => a - b, storage)) { /* Consume the failed producer. */ } }, error => error === failure);
  assert.deepEqual(await fs.readdir("/tmp"), []);
});

it("allows timer cancellation during a fast metadata producer and removes all runs", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/tmp");
  const controller = new AbortController(); const failure = new Error("cancel metadata sort"); let produced = 0;
  const timer = setTimeout(() => controller.abort(failure), 0);
  async function* input() { for (let i = 0; i < 10000; i++) { produced++; yield i; } }
  try {
    await assert.rejects(async () => {
      for await (const ignored of sortMetadataIndices(input(), (a, b) => b - a, { fs, directory: "/tmp" }, controller.signal)) { /* Consume sorted indices. */ }
    }, error => error === failure);
    assert.ok(produced < 10000); assert.deepEqual(await fs.readdir("/tmp"), []);
  } finally { clearTimeout(timer); }
});
