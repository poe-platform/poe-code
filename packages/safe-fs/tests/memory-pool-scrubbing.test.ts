import assert from "node:assert/strict";
import { test } from "vitest";
import { MemoryAllocation, MemoryLedger } from "../src/fs/memory/ledger.js";
import { normalizeMemoryFileSystemLimits } from "../src/fs/memory/limits.js";
import { MemoryFileSystem, tryReadMemoryFileViewSync } from "../src/fs/memory/index.js";

for (const size of [64, 65536]) {
  for (const operation of ["unlink", "replace"] as const) {
    test(`${operation} scrubs released ${size}-byte storage before another tenant reuses it`, async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/secret", new Uint8Array(size).fill(91));
      // Retain the owned allocation to inspect it before any subsequent pool reuse.
      const node = (fs as unknown as {
        file(path: string, syscall: string): { allocation: { data: Uint8Array } };
      }).file("/secret", "readFile");
      const data = node.allocation.data;
      assert.equal(data.byteLength, size);
      if (operation === "unlink") await fs.unlink("/secret");
      else await fs.writeFile("/secret", new Uint8Array(size + 1).fill(7));
      assert.ok(data.every(byte => byte === 0), "released storage still contains tenant bytes");
      if (operation === "replace") assert.deepEqual(await fs.readFile("/secret"), new Uint8Array(size + 1).fill(7));
    });
  }
}

test("pooling an empty directory discards a failed write's filename hint", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/dir", { mode: 0o555 });
  const directory = (fs as unknown as {
    root: { entries: Map<string, { entries: { _missKey: string; _missSlot: number } }> };
  }).root.entries.get("dir")!;
  assert.throws(() => fs.writeMemoryFileFast("/dir/tenant-secret", Uint8Array.of(1), false, 0o644), { code: "EACCES" });
  await fs.rmdir("/dir");
  assert.equal(directory.entries._missKey, "");
  assert.equal(directory.entries._missSlot, -1);
});

for (const size of [1, 32, 64]) {
  test(`separate tenants own distinct backing buffers for ${size}-byte files`, async () => {
    const tenantA = new MemoryFileSystem();
    const tenantB = new MemoryFileSystem();
    await tenantA.writeFile("/secret", new Uint8Array(size).fill(91));
    const viewA = tryReadMemoryFileViewSync(tenantA, "/secret")!;
    await tenantB.writeFile("/hello", new Uint8Array(size).fill(7));
    const viewB = tryReadMemoryFileViewSync(tenantB, "/hello")!;
    assert.notEqual(viewA.buffer, viewB.buffer);
    assert.ok(!new Uint8Array(viewB.buffer).includes(91));

    // Releasing a neighbor must not put part of a live tenant's buffer in a shared pool.
    await tenantA.writeFile("/neighbor", new Uint8Array(64).fill(92));
    await tenantA.unlink("/neighbor");
    await tenantB.writeFile("/reused", new Uint8Array(64).fill(8));
    const reused = tryReadMemoryFileViewSync(tenantB, "/reused")!;
    assert.notEqual(viewA.buffer, reused.buffer);
    assert.ok(!new Uint8Array(reused.buffer).includes(91));
    assert.deepEqual(await tenantA.readFile("/secret"), new Uint8Array(size).fill(91));
  });
}

for (const size of [1, 64, 65, 16384, 65536]) {
  test(`final release scrubs all ${size} bytes and frees the reservation`, () => {
    const ledger = new MemoryLedger(normalizeMemoryFileSystemLimits({ maxRetainedBytes: size }));
    ledger.reserve(size, 0, "writeFile", "/secret");
    const data = new Uint8Array(size).fill(91);
    const allocation = new MemoryAllocation(data, ledger);
    allocation.retain();
    allocation.release();
    assert.ok(data.every(byte => byte === 91));
    assert.equal(ledger.availableBytes, 0);
    allocation.release();
    assert.ok(data.every(byte => byte === 0));
    assert.equal(ledger.availableBytes, size);
    assert.throws(() => allocation.release(), /already released/);
  });
}
