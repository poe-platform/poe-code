import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { FsError } from "../../../src/contracts/index.js";
import type { FileStat, FileSystem } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../../src/fs/mount/index.js";
import { createOverlayFileSystem } from "../../../src/fs/overlay/index.js";
import { createReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";
import { createRealFileSystem } from "../../../src/fs/real/index.js";

const sentinel = new TextEncoder().encode("identity guard sentinel\n");

function wrapped(backend: FileSystem, overrides: Partial<FileSystem>): FileSystem {
  return new Proxy(backend, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function guarded(backend: FileSystem) {
  const calls: string[] = [];
  function forbidden(name: string): never {
    calls.push(name);
    throw new FsError("ENOSPC", { message: `unexpected ${name}` });
  }
  const filesystem = wrapped(backend, {
    async readFile() { return forbidden("readFile"); },
    readStream() { return forbidden("readStream"); },
    async writeFile() { forbidden("writeFile"); },
    async writeStream() { forbidden("writeStream"); },
    async appendFile() { forbidden("appendFile"); },
    async copyFile() { forbidden("copyFile"); },
    async rename() { forbidden("rename"); },
    async rm() { forbidden("rm"); },
    async mkdir() { forbidden("mkdir"); },
    async link() { forbidden("link"); },
    async symlink() { forbidden("symlink"); },
    async chmod() { forbidden("chmod"); },
    async utimes() { forbidden("utimes"); },
    async truncate() { forbidden("truncate"); },
  });
  return { filesystem, calls };
}

async function realPair(context: TestContext) {
  const root = await mkdtemp(fileURLToPath(new URL(".real-identity-guard-", import.meta.url)));
  context.after(() => rm(root, { recursive: true, force: true }));
  const left = await createRealFileSystem({ root });
  const right = await createRealFileSystem({ root });
  await left.writeFile("/file", sentinel);
  return { left, right };
}

function failure(code: string, source: string, destination: string) {
  return (error: unknown) => {
    assert.ok(error instanceof FsError);
    assert.equal(error.code, code);
    assert.equal(error.syscall, "copyFile");
    assert.equal(error.path, source);
    assert.equal(error.dest, destination);
    return true;
  };
}

function unchanged(before: FileStat, after: FileStat): void {
  for (const key of ["type", "size", "mode", "mtimeMs", "ctimeMs", "birthtimeMs", "dev", "ino", "nlink"] as const) {
    assert.equal(after[key], before[key], key);
  }
}

const wrappers = {
  direct: (backend: FileSystem) => backend,
  readonly: (backend: FileSystem) => createReadOnlyFileSystem(backend),
  nested: (backend: FileSystem) => createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/nested": backend } }),
  "overlay-lower": (backend: FileSystem) => createOverlayFileSystem({ upper: createMemoryFileSystem(), lower: backend }),
  "overlay-upper": (backend: FileSystem) => createOverlayFileSystem({ upper: backend, lower: createMemoryFileSystem() }),
  "readonly-overlay": (backend: FileSystem) => createReadOnlyFileSystem(createOverlayFileSystem({ upper: createMemoryFileSystem(), lower: backend })),
};

for (const [name, wrap] of Object.entries(wrappers)) {
  for (const alias of ["same-path", "hardlink", "symlink"] as const) {
    for (const reverse of name.includes("readonly") ? [false] : [false, true]) {
      test(`${name} ${alias}, reverse=${reverse}: rejects before I/O or publication`, async (context) => {
        const { left, right } = await realPair(context);
        const destination = alias === "same-path" ? "/file" : "/alias";
        if (alias === "hardlink") await right.link("/file", destination);
        if (alias === "symlink") await right.symlink("/file", destination);
        const origin = guarded(left);
        const target = guarded(right);
        const mount = createMountFileSystem({
          root: createMemoryFileSystem(),
          mounts: { "/left": wrap(origin.filesystem), "/right": target.filesystem },
        });
        const sourcePath = `/left${name === "nested" ? "/nested" : ""}/file`;
        const targetPath = `/right${destination}`;
        const source = reverse ? targetPath : sourcePath;
        const dest = reverse ? sourcePath : targetPath;
        const before = await left.stat("/file");
        const entry = await right.lstat(destination);
        const names = await right.readdir("/");
        await assert.rejects(mount.copyFile(source, dest), failure("EINVAL", source, dest));
        assert.deepEqual(origin.calls, []);
        assert.deepEqual(target.calls, []);
        unchanged(before, await left.stat("/file"));
        unchanged(entry, await right.lstat(destination));
        assert.deepEqual(await right.readdir("/"), names);
        assert.deepEqual(await left.readFile("/file"), sentinel);
        assert.deepEqual(await right.readFile(destination), sentinel);
        if (alias === "symlink") assert.equal(await right.readlink(destination), "/file");
      });
    }
  }
}

for (const multipleMounts of [false, true]) {
  test(`same memory backend, multipleMounts=${multipleMounts}: mount rejects before delegation`, async () => {
    const backend = createMemoryFileSystem();
    await backend.writeFile("/file", sentinel);
    await backend.link("/file", "/alias");
    const guard = guarded(backend);
    const mount = createMountFileSystem({ root: guard.filesystem, ...(multipleMounts ? { mounts: { "/other": guard.filesystem } } : {}) });
    const destination = `${multipleMounts ? "/other" : ""}/alias`;
    await assert.rejects(mount.copyFile("/file", destination), failure("EINVAL", "/file", destination));
    assert.deepEqual(guard.calls, []);
    assert.deepEqual(await backend.readFile("/file"), sentinel);
  });
}

test("overlapping native roots identify the same file without exposing host paths", async (context) => {
  const root = await mkdtemp(fileURLToPath(new URL(".real-identity-root-", import.meta.url)));
  context.after(() => rm(root, { recursive: true, force: true }));
  const outer = await createRealFileSystem({ root });
  await outer.mkdir("/nested");
  await outer.writeFile("/nested/file", sentinel);
  const inner = await createRealFileSystem({ root: `${root}/nested` });
  const origin = guarded(outer);
  const target = guarded(inner);
  const mount = createMountFileSystem({ root: origin.filesystem, mounts: { "/alias": target.filesystem } });
  await assert.rejects(mount.copyFile("/nested/file", "/alias/file"), (error: unknown) => {
    assert.ok(error instanceof FsError);
    assert.equal(error.code, "EINVAL");
    assert.equal(String(error).includes(root), false);
    assert.equal(JSON.stringify(error).includes(root), false);
    return true;
  });
  assert.deepEqual(origin.calls, []);
  assert.deepEqual(target.calls, []);
  assert.deepEqual(await inner.readFile("/file"), sentinel);
});

test("separate native roots and files remain copyable", async (context) => {
  const first = await realPair(context);
  const second = await realPair(context);
  const copied = new TextEncoder().encode("different native source");
  await first.left.writeFile("/file", copied);
  const mount = createMountFileSystem({ root: first.left, mounts: { "/other": second.left } });
  await mount.copyFile("/file", "/other/file");
  assert.deepEqual(await first.left.readFile("/file"), copied);
  assert.deepEqual(await second.left.readFile("/file"), copied);
});

function unknownIdentity(backend: FileSystem): FileSystem {
  function omitCoordinates(stat: FileStat): FileStat {
    const { dev: ignoredDev, ino: ignoredIno, ...rest } = stat;
    return rest;
  }
  return wrapped(backend, {
    async stat(path, options) { return omitCoordinates(await backend.stat(path, options)); },
    async lstat(path, options) { return omitCoordinates(await backend.lstat(path, options)); },
  });
}

for (const unknown of ["source", "target", "both"] as const) {
  test(`unknown ${unknown} identity rejects existing cross-mount target before effects`, async () => {
    const left = createMemoryFileSystem();
    const right = createMemoryFileSystem();
    await left.writeFile("/file", sentinel);
    await right.writeFile("/file", sentinel);
    const origin = guarded(unknown === "target" ? left : unknownIdentity(left));
    const target = guarded(unknown === "source" ? right : unknownIdentity(right));
    const mount = createMountFileSystem({ root: origin.filesystem, mounts: { "/right": target.filesystem } });
    await assert.rejects(mount.copyFile("/file", "/right/file"), failure("ENOTSUP", "/file", "/right/file"));
    assert.deepEqual(origin.calls, []);
    assert.deepEqual(target.calls, []);
    assert.deepEqual(await left.readFile("/file"), sentinel);
    assert.deepEqual(await right.readFile("/file"), sentinel);
  });
}

test("unknown providers can copy to missing targets using exclusive creation", async () => {
  const left = createMemoryFileSystem();
  const right = createMemoryFileSystem();
  await left.writeFile("/file", sentinel);
  const flags: unknown[] = [];
  const target = wrapped(unknownIdentity(right), {
    async writeStream(path, source, options) {
      flags.push(options?.flag);
      return right.writeStream(path, source, options);
    },
  });
  const mount = createMountFileSystem({ root: unknownIdentity(left), mounts: { "/right": target } });
  await mount.copyFile("/file", "/right/new");
  assert.deepEqual(flags, ["wx"]);
  assert.deepEqual(await right.readFile("/new"), sentinel);
  assert.deepEqual(await left.readFile("/file"), sentinel);
});

for (const streaming of [false, true]) {
  test(`destination races from missing to source alias, streaming=${streaming}: exclusive write preserves source`, async () => {
    const backend = createMemoryFileSystem();
    await backend.writeFile("/file", sentinel);
    const flags: unknown[] = [];
    const target = wrapped(backend, {
      capabilities: { ...backend.capabilities, streamingWrite: streaming },
      async writeFile(path, data, options) {
        flags.push(options?.flag);
        await backend.link("/file", path);
        return backend.writeFile(path, data, options);
      },
      async writeStream(path, source, options) {
        flags.push(options?.flag);
        await backend.link("/file", path);
        return backend.writeStream(path, source, options);
      },
    });
    const mount = createMountFileSystem({ root: backend, mounts: { "/right": target } });
    await assert.rejects(mount.copyFile("/file", "/right/new"), failure("EEXIST", "/file", "/right/new"));
    assert.deepEqual(flags, ["wx"]);
    assert.deepEqual(await backend.readFile("/file"), sentinel);
    assert.deepEqual(await backend.readFile("/new"), sentinel);
  });
}

for (const streaming of [false, true]) {
  test(`disjoint failed writer, streaming=${streaming}: source survives genuine target failure`, async () => {
    const left = createMemoryFileSystem();
    const right = createMemoryFileSystem();
    await left.writeFile("/file", sentinel);
    await right.writeFile("/file", new TextEncoder().encode("old target"));
    let attempts = 0;
    const target = wrapped(right, {
      capabilities: { ...right.capabilities, streamingWrite: streaming },
      async writeFile(path) {
        attempts++;
        await right.writeFile(path, new Uint8Array());
        throw new FsError("ENOSPC");
      },
      async writeStream(path) {
        attempts++;
        await right.writeFile(path, new Uint8Array());
        throw new FsError("ENOSPC");
      },
    });
    const mount = createMountFileSystem({ root: left, mounts: { "/right": target } });
    await assert.rejects(mount.copyFile("/file", "/right/file"), failure("ENOSPC", "/file", "/right/file"));
    assert.equal(attempts, 1);
    assert.deepEqual(await left.readFile("/file"), sentinel);
    assert.deepEqual(await right.readFile("/file"), new Uint8Array());
  });
}
