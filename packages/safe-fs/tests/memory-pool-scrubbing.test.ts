import assert from "node:assert/strict";
import { test } from "vitest";
import { MemoryFileSystem } from "../src/fs/memory/index.js";

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
