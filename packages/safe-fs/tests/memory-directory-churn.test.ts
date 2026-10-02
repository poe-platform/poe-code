import assert from "node:assert/strict";
import { test } from "vitest";
import { MemoryFileSystem, tryWriteMemoryFileSync } from "../src/fs/memory/index.js";

function hash(name: string): number {
  let value = 5381;
  for (let i = 0; i < name.length; i++) {
    value = (((value & 0x1fffff) * 33) ^ name.charCodeAt(i)) & 0x3fffffff;
  }
  return value;
}

function bucketNames(): string[] {
  const buckets = new Map<number, string>();
  for (let a = 33; a <= 126 && buckets.size < 128; a++) {
    if (a === 47 || a === 46) continue;
    for (let b = 33; b <= 126 && buckets.size < 128; b++) {
      if (b === 47 || b === 46) continue;
      const name = String.fromCharCode(a, b);
      if (!buckets.has(hash(name) & 127)) buckets.set(hash(name) & 127, name);
    }
  }
  assert.equal(buckets.size, 128);
  return [...buckets.values()];
}

for (const fast of [false, true]) {
  test(`directory probes terminate after repeated LIFO deletions (${fast ? "sync" : "async"} writes)`, async () => {
    const fs = new MemoryFileSystem();
    const payload = Uint8Array.of(7);
    await fs.mkdir("/dir");
    await fs.writeFile("/dir/anchor", payload);
    const root = Reflect.get(fs, "root") as {
      entries: Map<string, { entries: Map<string, unknown> & { _table: Int16Array | Int32Array } }>;
    };
    const entries = root.entries.get("dir")!.entries;
    for (let round = 0; round < 3; round++) {
      for (const name of bucketNames()) {
        if (fast) assert.equal(tryWriteMemoryFileSync(fs, `/dir/${name}`, payload, false, 0o666), true);
        else await fs.writeFile(`/dir/${name}`, payload);
        await fs.rm(`/dir/${name}`);
        // Check the termination invariant before any missing lookup can hang the test runner.
        assert.ok(entries._table.includes(-1), "directory hash table must retain an empty probe slot");
      }
      await assert.rejects(fs.stat("/dir/missing"), { code: "ENOENT" });
      await assert.rejects(fs.readFile("/dir/missing"), { code: "ENOENT" });
      assert.equal(entries.get("missing"), undefined);
      assert.equal(entries.delete("missing"), false);
      assert.deepEqual(await fs.readFile("/dir/anchor"), payload);
      assert.deepEqual((await fs.readdir("/dir")).map(entry => entry.name), ["anchor"]);
      await fs.writeFile("/dir/created", payload);
      await fs.rename("/dir/created", "/dir/renamed");
      await fs.rm("/dir/renamed");
    }
    await fs.rm("/dir/anchor");
    await fs.writeFile("/dir/after-clear", payload);
    assert.deepEqual(await fs.readFile("/dir/after-clear"), payload);
  });
}

test("batch writes preserve live entries after LIFO churn", async () => {
  const fs = new MemoryFileSystem();
  const payload = Uint8Array.of(9);
  await fs.mkdir("/dir");
  // Release enough pool nodes to exercise the optimized batch path when it is eligible.
  for (let i = 0; i < 64; i++) await fs.writeFile(`/pool-${i}`, payload);
  for (let i = 0; i < 64; i++) await fs.rm(`/pool-${i}`);
  assert.equal(tryWriteMemoryFileSync(fs, "/dir/anchor", payload, false, 0o666), true);
  const names = bucketNames();
  for (let i = 0; i < 96; i++) {
    assert.equal(tryWriteMemoryFileSync(fs, `/dir/${names[i]!}`, payload, false, 0o666), true);
    await fs.rm(`/dir/${names[i]!}`);
  }
  // Prime the same-directory write cache used by the shell's batch writer.
  assert.equal(tryWriteMemoryFileSync(fs, "/dir/anchor", payload, false, 0o666), true);
  const batch = names.slice(96);
  const root = Reflect.get(fs, "root") as {
    entries: Map<string, { entries: { _table: Int16Array | Int32Array } }>;
  };
  const table = root.entries.get("dir")!.entries._table;
  assert.ok(table.includes(-1), "churn must retain an empty probe slot before insertion");
  const payloads = batch.map(() => payload);
  fs.writeMemoryFilesInDirBatchFast("anchor", "/dir/", batch, Int32Array.from(batch, hash), payloads,
    batch.reduce((sum, name) => sum + name.length, 0), batch.length * payload.byteLength, 0o666);
  assert.ok(root.entries.get("dir")!.entries._table.includes(-1),
    "batch insertion must leave an empty probe slot");
  assert.deepEqual((await fs.readdir("/dir")).map(entry => entry.name).sort(), ["anchor", ...batch].sort());
  for (const name of ["anchor", ...batch]) assert.deepEqual(await fs.readFile(`/dir/${name}`), payload);
  await assert.rejects(fs.stat("/dir/missing"), { code: "ENOENT" });
});
