import { vol } from "memfs";
import assert from "node:assert/strict";
import { beforeEach,test,vi } from "vitest";
import type { FileStat,FileSystem } from "../../../../src/contracts/index.js";
import { FsError } from "../../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { compareIdentity } from "../../../../src/fs/mount/identity.js";
import { createMountFileSystem } from "../../../../src/fs/mount/index.js";
import { createOverlayFileSystem } from "../../../../src/fs/overlay/index.js";
import { createReadOnlyFileSystem } from "../../../../src/fs/readonly/index.js";
import { createRealFileSystem } from "../../../../src/fs/real/index.js";
import { wrapped } from "../overlay/helpers.js";

const bytes = new TextEncoder().encode("identity sentinel");
vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return { ...fs.promises, default: fs.promises };
});
vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return { constants: fs.constants };
});
beforeEach(() => {
  vol.reset();
  vol.mkdirSync("/machine");
});

function metadata(identityScope: object | symbol = Symbol()): FileStat {
  return { type: "file", size: 1, mode: 0o100644, atimeMs: 0, mtimeMs: 0, ctimeMs: 0, identityScope, dev: 0, ino: 1 };
}

test("complete opaque scopes compare only by reference and require both coordinates", () => {
  const opaque = { toString() { throw new Error("scope coercion"); }, [Symbol.toPrimitive]() { throw new Error("scope coercion"); } };
  const origin = metadata(opaque);
  assert.equal(compareIdentity(origin, { ...origin }), "same");
  assert.equal(compareIdentity(origin, { ...origin, dev: 1 }), "distinct");
  assert.equal(compareIdentity(origin, { ...origin, ino: 2 }), "distinct");
  assert.equal(compareIdentity(origin, metadata({})), "distinct");
  assert.equal(compareIdentity(metadata(Symbol("same")), metadata(Symbol("same"))), "distinct");
  assert.equal(compareIdentity(undefined, origin), "unknown");
  assert.equal(compareIdentity(origin, undefined), "unknown");
});

for (const field of ["identityScope", "dev", "ino"] as const) {
  test(`invalid ${field} never proves distinctness, in either direction, before effects`, async () => {
    const invalid = field === "identityScope" ? [undefined, null, "native", 0, () => {}]
      : [undefined, NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, "1"];
    for (const value of invalid) {
      const incomplete = Object.defineProperty(metadata(), field, { value });
      assert.equal(compareIdentity(incomplete, metadata()), "unknown");
      assert.equal(compareIdentity(metadata(), incomplete), "unknown");
      const left = createMemoryFileSystem();
      const right = createMemoryFileSystem();
      await left.writeFile("/file", bytes);
      await right.writeFile("/file", bytes);
      const calls: string[] = [];
      const forbidden = (name: string): never => { calls.push(name); throw new FsError("ENOSPC"); };
      const guard = (backend: FileSystem, broken: boolean) => wrapped(backend, {
        lstat: async (path, options) => {
          const stat = await backend.lstat(path, options);
          return broken && path === "/file" ? Object.defineProperty(stat, field, { value }) : stat;
        },
        async readFile() { return forbidden("readFile"); },
        readStream() { return forbidden("readStream"); },
        async writeFile() { forbidden("writeFile"); },
        async writeStream() { forbidden("writeStream"); },
        async copyFile() { forbidden("copyFile"); },
      });
      const mount = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/left": guard(left, true), "/right": guard(right, false) } });
      for (const [source, destination] of [["/left/file", "/right/file"], ["/right/file", "/left/file"]] as const) {
        await assert.rejects(mount.copyFile(source, destination), { code: "ENOTSUP", syscall: "copyFile", path: source, dest: destination });
      }
      assert.deepEqual(calls, []);
      assert.deepEqual(await left.readFile("/file"), bytes);
      assert.deepEqual(await right.readFile("/file"), bytes);
    }
  });
}

test("memory scopes are store-specific; hardlinks and wrapper views preserve the backing tuple", async () => {
  const left = createMemoryFileSystem();
  const right = createMemoryFileSystem();
  await left.writeFile("/file", bytes);
  await left.link("/file", "/alias");
  await right.writeFile("/file", bytes);
  const stat = await left.stat("/file");
  assert.equal(compareIdentity(stat, await left.stat("/alias")), "same");
  assert.equal(compareIdentity(stat, await right.stat("/file")), "distinct");
  const readonly = createReadOnlyFileSystem(left);
  const mount = createMountFileSystem({ root: readonly });
  assert.equal(compareIdentity(stat, await mount.stat("/alias")), "same");
  assert.equal((await mount.lstat("/alias")).identityScope, stat.identityScope);
});

test("unknown same-mount destination cannot rely on arbitrary backend copyFile presence", async () => {
  const backing = createMemoryFileSystem();
  await backing.writeFile("/file", bytes);
  await backing.link("/file", "/alias");
  const calls: string[] = [];
  const backend = wrapped(backing, {
    async lstat(path, options) {
      const { identityScope: ignoredScope, ...stat } = await backing.lstat(path, options);
      return stat;
    },
    async copyFile() { calls.push("copyFile"); throw new FsError("ENOSPC"); },
  });
  const mount = createMountFileSystem({ root: backend });
  await assert.rejects(mount.copyFile("/file", "/alias"), { code: "ENOTSUP", syscall: "copyFile", path: "/file", dest: "/alias" });
  assert.deepEqual(calls, []);
  assert.deepEqual(await backing.readFile("/file"), bytes);
  assert.deepEqual(await backing.readFile("/alias"), bytes);
});

test("native roots and instances publish the agreed host identity scope", async () => {
  const root = "/machine";
  const filesystem = await createRealFileSystem({ root });
  const other = await createRealFileSystem({ root });
  await filesystem.writeFile("/file", bytes);
  await filesystem.link("/file", "/alias");
  const stat = await filesystem.stat("/file");
  assert.equal(stat.identityScope, Symbol.for("virtual-bash.fs.native"));
  assert.equal(compareIdentity(stat, await other.stat("/alias")), "same");
});

test("overlay copy-up changes exposed identity to the actual upper entry through wrappers", async () => {
  const upper = createMemoryFileSystem();
  const lower = createMemoryFileSystem();
  await lower.writeFile("/file", bytes);
  const overlay = createOverlayFileSystem({ upper, lower });
  const mount = createMountFileSystem({ root: createReadOnlyFileSystem(overlay) });
  const original = await lower.stat("/file");
  assert.equal(compareIdentity(original, await mount.stat("/file")), "same");
  await overlay.appendFile("/file", new Uint8Array([33]));
  assert.equal(compareIdentity(original, await mount.stat("/file")), "distinct");
  assert.equal(compareIdentity(await upper.stat("/file"), await mount.stat("/file")), "same");
  assert.deepEqual(await lower.readFile("/file"), bytes);
});

test("pending overlay garbage is not mutated by direct or mounted alias rejection", async () => {
  const upper = createMemoryFileSystem();
  let clean = false;
  const removals: string[] = [];
  const overlay = createOverlayFileSystem({ upper: wrapped(upper, {
    async rm(path, options) {
      removals.push(path);
      if (!clean) throw new FsError("EIO");
      await upper.rm(path, options);
    },
  }), lower: createMemoryFileSystem() });
  await overlay.writeFile("/file", bytes);
  await upper.symlink("/file", "/alias");
  const before = await upper.readdir("/");
  assert.ok(before.some((entry) => entry.name.startsWith(".virtual-bash-overlay-")));
  removals.length = 0;
  clean = true;
  await assert.rejects(overlay.copyFile("/file", "/alias"), { code: "EINVAL" });
  const mount = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/view": overlay, "/backing": upper } });
  await assert.rejects(mount.copyFile("/view/alias", "/backing/file"), { code: "EINVAL" });
  assert.deepEqual(removals, []);
  assert.deepEqual(await upper.readdir("/"), before);
  assert.deepEqual(await upper.readFile("/file"), bytes);
  await overlay.cleanup();
});
