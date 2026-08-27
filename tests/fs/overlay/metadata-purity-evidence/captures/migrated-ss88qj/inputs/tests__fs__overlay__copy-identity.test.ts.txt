import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createOverlayFileSystem } from "../../../src/fs/overlay/index.js";
import { wrapped } from "./helpers.js";

const sentinel = new TextEncoder().encode("overlay alias sentinel");

for (const layer of ["upper", "lower"] as const) {
  for (const alias of ["same-path", "hardlink", "symlink"] as const) {
    test(`${layer} ${alias}: overlay copy rejects before staging or reading source`, async () => {
      const upper = createMemoryFileSystem();
      const lower = createMemoryFileSystem();
      const selected = layer === "upper" ? upper : lower;
      await selected.writeFile("/file", sentinel);
      const destination = alias === "same-path" ? "/file" : "/alias";
      if (alias === "hardlink") await selected.link("/file", destination);
      if (alias === "symlink") await selected.symlink("/file", destination);
      const sourceBefore = await selected.stat("/file");
      const targetBefore = await selected.lstat(destination);
      const upperBefore = await upper.readdir("/");
      const lowerBefore = await lower.readdir("/");
      const calls: string[] = [];
      function forbidden(method: string): never {
        calls.push(method);
        throw new FsError("ENOSPC");
      }
      const overlay = createOverlayFileSystem({
        upper: wrapped(upper, {
          async mkdir() { forbidden("mkdir"); },
          async rename() { forbidden("rename"); },
          async rm() { forbidden("rm"); },
          async writeFile() { forbidden("writeFile"); },
          async writeStream() { forbidden("writeStream"); },
          async readFile() { return forbidden("upper.readFile"); },
          readStream() { return forbidden("upper.readStream"); },
        }),
        lower: wrapped(lower, {
          async readFile() { return forbidden("lower.readFile"); },
          readStream() { return forbidden("lower.readStream"); },
        }),
      });
      await assert.rejects(overlay.copyFile("/file", destination), { code: "EINVAL" });
      assert.deepEqual(calls, []);
      assert.deepEqual(await selected.stat("/file"), sourceBefore);
      assert.deepEqual(await selected.lstat(destination), targetBefore);
      assert.deepEqual(await upper.readdir("/"), upperBefore);
      assert.deepEqual(await lower.readdir("/"), lowerBefore);
      assert.deepEqual(await selected.readFile("/file"), sentinel);
      assert.deepEqual(await selected.readFile(destination), sentinel);
    });
  }
}

test("overlay distinct lower/upper files with colliding local inode numbers remain copyable", async () => {
  const upper = createMemoryFileSystem();
  const lower = createMemoryFileSystem();
  await lower.writeFile("/file", sentinel);
  await upper.writeFile("/other", new TextEncoder().encode("other"));
  const origin = await lower.stat("/file");
  const target = await upper.stat("/other");
  assert.equal(origin.dev, target.dev);
  assert.equal(origin.ino, target.ino);
  const overlay = createOverlayFileSystem({ upper, lower });
  await overlay.copyFile("/file", "/other");
  assert.deepEqual(await lower.readFile("/file"), sentinel);
  assert.deepEqual(await upper.readFile("/other"), sentinel);
});
