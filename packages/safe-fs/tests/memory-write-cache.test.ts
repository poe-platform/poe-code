import assert from "node:assert/strict";
import { test } from "vitest";
import { MemoryFileSystem, tryWriteMemoryFileSync } from "../src/fs/memory/index.js";

test("fast directory write rejects metadata exhaustion without inserting a file", async () => {
  const fs = new MemoryFileSystem({ maxMetadataUnits: 5 });
  await fs.mkdir("/dir");
  fs.writeMemoryFileInDirFast("/dir/", "first", Uint8Array.of(1), false, 0o666);
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.throws(() => fs.writeMemoryFileInDirFast("/dir/", "second", Uint8Array.of(2), false, 0o666), { code: "ENOSPC" });
    assert.deepEqual((await fs.readdir("/dir")).map(entry => entry.name), ["first"]);
    await assert.rejects(fs.stat("/dir/second"), { code: "ENOENT" });
  }
  await fs.rm("/dir/first");
  fs.writeMemoryFileInDirFast("/dir/", "second", Uint8Array.of(2), false, 0o666);
  assert.deepEqual(await fs.readFile("/dir/second"), Uint8Array.of(2));
  await fs.rm("/dir", { recursive: true });
});

for (const grow of [false, true]) {
  test(`failed write cache cannot corrupt later directory insertions, growth=${grow}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/dir", { mode: 0o555 });
    assert.throws(() => tryWriteMemoryFileSync(fs, "/dir/a", Uint8Array.of(1), false, 0o666), { code: "EACCES" });
    await fs.chmod("/dir", 0o755);
    await fs.mkdir("/dir/b_149");
    if (grow) for (let i = 0; i < 70; i++) await fs.mkdir(`/dir/entry-${i}`);
    await fs.mkdir("/dir/a");
    for (const entry of await fs.readdir("/dir")) await fs.stat(`/dir/${entry.name}`);
  });
}

for (const inDir of [false, true]) {
  for (const chmod of [false, true]) {
    test(`cached writes enforce owner permissions, inDir=${inDir}, chmod=${chmod}`, async () => {
      const fs = new MemoryFileSystem();
      await fs.mkdir("/dir");
      const write = () => inDir
        ? fs.writeMemoryFileInDirFast("/dir/", "file", Uint8Array.of(1), true, chmod ? 0o666 : 0o402)
        : tryWriteMemoryFileSync(fs, "/dir/file", Uint8Array.of(1), true, chmod ? 0o666 : 0o402);
      write();
      if (chmod) await fs.chmod("/dir/file", 0o402);
      assert.throws(write, { code: "EACCES" });
      assert.deepEqual(await fs.readFile("/dir/file"), Uint8Array.of(1));
    });
  }
}
