import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { FsError } from "../../../src/contracts/index.js";
import type { FileSystem } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../../src/fs/mount/index.js";
import { createRealFileSystem } from "../../../src/fs/real/index.js";

const sentinel = new TextEncoder().encode("alias sentinel\n");

for (const alias of ["same-path", "hardlink", "symlink"] as const) {
  test(`direct cross-mount copy rejects a real ${alias} alias without touching source bytes`, async (context) => {
    const root = await mkdtemp(fileURLToPath(new URL(".real-copy-identity-", import.meta.url)));
    context.after(() => rm(root, { recursive: true, force: true }));
    const left = await createRealFileSystem({ root });
    const right = await createRealFileSystem({ root });
    await left.writeFile("/file", sentinel);
    const destination = alias === "same-path" ? "/file" : "/alias";
    if (alias === "hardlink") await left.link("/file", destination);
    if (alias === "symlink") await left.symlink("/file", destination);
    const sourceStat = await left.stat("/file");
    const targetStat = await right.stat(destination);
    assert.equal(sourceStat.dev, targetStat.dev);
    assert.equal(sourceStat.ino, targetStat.ino);
    const mount = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/left": left, "/right": right } });
    let failure: unknown;
    try { await mount.copyFile("/left/file", `/right${destination}`); }
    catch (error) { failure = error; }
    assert.deepEqual(await left.readFile("/file"), sentinel, "source bytes survive the direct VFS call");
    assert.deepEqual(await right.readFile(destination), sentinel, "alias bytes survive the direct VFS call");
    assert.ok(failure instanceof FsError);
    assert.equal(failure.code, "EINVAL");
    assert.equal(failure.syscall, "copyFile");
    assert.equal(failure.path, "/left/file");
    assert.equal(failure.dest, `/right${destination}`);
  });
}

function collidingMetadata(backend: FileSystem): FileSystem {
  return new Proxy(backend, {
    get(target, property) {
      if (property === "stat" || property === "lstat") {
        return async (...parameters: Parameters<FileSystem["stat"]>) => ({
          ...await target[property](...parameters), dev: 7, ino: 11,
        });
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

test("cross-mount copy does not treat unrelated synthetic dev/ino collisions as identity", async () => {
  const left = collidingMetadata(createMemoryFileSystem());
  const right = collidingMetadata(createMemoryFileSystem());
  await left.writeFile("/file", sentinel);
  await right.writeFile("/file", new TextEncoder().encode("unrelated destination\n"));
  assert.equal((await left.stat("/file")).dev, (await right.stat("/file")).dev);
  assert.equal((await left.stat("/file")).ino, (await right.stat("/file")).ino);
  const mount = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/left": left, "/right": right } });
  await mount.copyFile("/left/file", "/right/file");
  assert.deepEqual(await left.readFile("/file"), sentinel);
  assert.deepEqual(await right.readFile("/file"), sentinel);
});
