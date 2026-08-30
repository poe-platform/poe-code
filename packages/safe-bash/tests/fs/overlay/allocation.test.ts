import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import * as native from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { FsError } from "../../../src/contracts/index.js";
import type { FileSystem } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../../src/fs/mount/index.js";
import { OverlayFileSystem } from "../../../src/fs/overlay/index.js";
import { createReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";
import { createRealFileSystem } from "../../../src/fs/real/index.js";
import { encode, immutable, snapshot, wrapped } from "./helpers.js";

type Representation = "enumerable-own" | "nonenumerable-own" | "prototype-accessor";

function reporting(backend: FileSystem, allocation: (path: string) => number | undefined,
  representation: Representation = "prototype-accessor"): FileSystem {
  return wrapped(backend, {
    async lstat(path, options) {
      const source = await backend.lstat(path, options);
      const owner = representation === "prototype-accessor" ? {} : source;
      Object.defineProperty(owner, "allocatedBytes", {
        enumerable: representation === "enumerable-own",
        get() {
          assert.equal(this, source);
          return allocation(path);
        },
      });
      if (owner !== source) Object.setPrototypeOf(source, owner);
      Object.defineProperty(source, "adapterState", {
        enumerable: true,
        get() { throw new Error("must not copy unrelated provider metadata"); },
      });
      Object.defineProperty(source, "blocks", { value: 91, enumerable: true });
      return source;
    },
  });
}

for (const layer of ["upper", "lower"] as const) {
  for (const representation of ["enumerable-own", "nonenumerable-own", "prototype-accessor"] as const) {
    for (const reported of [undefined, 0, 1, 4096, Number.MAX_SAFE_INTEGER]) {
      test(`${layer} ${representation} forwards reported allocation ${reported}`, async () => {
        const backing = new MemoryFileSystem();
        const storage = new MemoryFileSystem();
        const selected = layer === "upper" ? storage : backing;
        await selected.writeFile("/file", encode("value"));
        const { lower, mutations } = immutable(backing);
        let current = reported;
        const decorated = reporting(layer === "upper" ? storage : lower, () => current, representation);
        const overlay = new OverlayFileSystem({
          upper: layer === "upper" ? decorated : storage,
          lower: layer === "lower" ? decorated : lower,
        });
        const results = [await overlay.stat("/file"), await overlay.lstat("/file")];
        for (const result of results) {
          assert.equal(result.allocatedBytes, reported);
          assert.equal(Object.hasOwn(result, "allocatedBytes"), reported !== undefined);
          assert.equal(result.size, 5);
          assert.equal(Object.hasOwn(result, "adapterState"), false);
          assert.equal(Object.hasOwn(result, "blocks"), false);
          if (reported !== undefined) assert.equal(Object.getOwnPropertyDescriptor(result, "allocatedBytes")?.get, undefined);
        }
        current = 8192;
        for (const result of results) assert.equal(result.allocatedBytes, reported);
        assert.equal((await overlay.stat("/file")).allocatedBytes, 8192);
        assert.deepEqual(mutations, []);
        if (layer === "lower") assert.deepEqual(await storage.readdir("/"), []);
      });
    }
  }
}

for (const operation of ["chmod", "appendFile"] as const) {
  for (const upperAllocation of [undefined, 0, 8192]) {
    test(`${operation} copy-up replaces lower allocation with upper report ${upperAllocation}`, async () => {
      const backing = new MemoryFileSystem();
      const storage = new MemoryFileSystem();
      await backing.writeFile("/file", encode("value"));
      const before = await snapshot(backing);
      const { lower, mutations } = immutable(backing);
      const overlay = new OverlayFileSystem({
        upper: reporting(storage, () => upperAllocation),
        lower: reporting(lower, () => 4096),
      });
      assert.equal((await overlay.stat("/file")).allocatedBytes, 4096);
      if (operation === "chmod") await overlay.chmod("/file", 0o600);
      else await overlay.appendFile("/file", encode("!"));
      const expected = await storage.lstat("/file");
      for (const method of ["stat", "lstat"] as const) {
        const result = await overlay[method]("/file");
        assert.deepEqual(result, { ...expected, ...(upperAllocation === undefined ? {} : { allocatedBytes: upperAllocation }) });
        assert.equal(result.allocatedBytes, upperAllocation);
        assert.equal(Object.hasOwn(result, "allocatedBytes"), upperAllocation !== undefined);
      }
      assert.deepEqual(mutations, []);
      assert.deepEqual(await snapshot(backing), before);
      await overlay.cleanup();
      assert.deepEqual((await storage.readdir("/")).map(entry => entry.name), ["file"]);
    });
  }
}

test("overlay allocation composes through mount and read-only views with link semantics", async () => {
  const backing = new MemoryFileSystem();
  await backing.writeFile("/file", encode("value"));
  await backing.symlink("file", "/link");
  const overlay = new OverlayFileSystem({ upper: new MemoryFileSystem(), lower: reporting(
    createReadOnlyFileSystem(backing), path => path === "/link" ? 0 : 4096,
  ) });
  const filesystem = createReadOnlyFileSystem(createMountFileSystem({ root: new MemoryFileSystem(), mounts: { "/data": overlay } }));
  const link = await filesystem.lstat("/data/link");
  const target = await filesystem.stat("/data/link");
  assert.equal(link.type, "symlink");
  assert.equal(link.allocatedBytes, 0);
  assert.equal(target.type, "file");
  assert.equal(target.allocatedBytes, 4096);
  assert.equal((await filesystem.stat("/data")).allocatedBytes, undefined);
});

test("overlay memory allocation stays unknown before and after copy-up", async () => {
  const backing = new MemoryFileSystem();
  await backing.writeFile("/file", new Uint8Array(8192));
  const overlay = new OverlayFileSystem({ upper: new MemoryFileSystem(), lower: createReadOnlyFileSystem(backing) });
  for (const phase of ["lower", "upper"] as const) {
    if (phase === "upper") await overlay.chmod("/file", 0o600);
    for (const method of ["stat", "lstat"] as const) {
      const result = await overlay[method]("/file");
      assert.equal(result.size, 8192);
      assert.equal(result.allocatedBytes, undefined);
      assert.equal(Object.hasOwn(result, "allocatedBytes"), false);
    }
  }
  await overlay.cleanup();
});

for (const trigger of ["readFile", "cleanup"] as const) {
  test(`stat/lstat do not clean pending staging or copy up; existing ${trigger} cleanup remains`, async context => {
    const backing = new MemoryFileSystem();
    const storage = new MemoryFileSystem();
    await backing.writeFile("/file", encode("value"));
    const before = await snapshot(backing);
    const { lower, mutations } = immutable(backing);
    let denyCleanup = true;
    const removals: string[] = [];
    const mutationCalls: string[] = [];
    const mutators = new Set(["writeFile", "appendFile", "writeStream", "mkdir", "rm", "rmdir",
      "rename", "copyFile", "symlink", "link", "chmod", "utimes", "truncate"]);
    const upper = new Proxy(wrapped(storage, {
      async rm(path, options) {
        removals.push(path);
        if (denyCleanup) throw new FsError("EACCES");
        await storage.rm(path, options);
      },
    }), {
      get(target, property) {
        const value: unknown = Reflect.get(target, property);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          if (typeof property === "string" && mutators.has(property)) mutationCalls.push(property);
          return Reflect.apply(value, target, args);
        };
      },
    });
    const overlay = new OverlayFileSystem({ upper, lower: reporting(lower, () => 4096) });
    context.after(async () => { denyCleanup = false; await overlay.cleanup(); });
    await overlay.mkdir("/created");
    const staged = await storage.readdir("/");
    assert.ok(staged.some(entry => entry.name.startsWith(".virtual-bash-overlay-")));
    removals.length = 0;
    mutationCalls.length = 0;
    const upperBefore = await snapshot(storage);
    for (const method of ["stat", "lstat"] as const) {
      assert.equal((await overlay[method]("/file")).allocatedBytes, 4096);
      await assert.rejects(overlay[method]("/missing"), { code: "ENOENT" });
    }
    assert.deepEqual(removals, []);
    assert.deepEqual(mutationCalls, []);
    assert.deepEqual(await snapshot(storage), upperBefore);
    assert.deepEqual(mutations, []);
    assert.deepEqual(await snapshot(backing), before);
    denyCleanup = false;
    if (trigger === "readFile") assert.deepEqual(await overlay.readFile("/file"), encode("value"));
    else {
      assert.deepEqual((await overlay.readdir("/")).map(entry => entry.name), ["created", "file"]);
      assert.deepEqual(removals, []);
      assert.deepEqual(mutationCalls, []);
      await overlay.cleanup();
    }
    assert.ok(removals.length > 0);
    assert.deepEqual((await storage.readdir("/")).map(entry => entry.name), ["created"]);
    assert.deepEqual(mutations, []);
    assert.deepEqual(await snapshot(backing), before);
  });
}

test("Real allocation survives read-only, mount and overlay views and follows actual copy-up metadata", async context => {
  const parent = join(dirname(fileURLToPath(import.meta.url)), "allocation-evidence");
  const temporary = await native.mkdtemp(join(parent, ".native-"));
  context.after(async () => {
    await native.rm(temporary, { recursive: true, force: true });
    await assert.rejects(native.lstat(temporary), { code: "ENOENT" });
  });
  const root = await native.realpath(temporary);
  const lowerRoot = join(root, "lower");
  const upperRoot = join(root, "upper");
  await native.mkdir(lowerRoot);
  await native.mkdir(upperRoot);
  await native.writeFile(join(lowerRoot, "dense"), randomBytes(8192), { flag: "wx" });
  const sparse = await native.open(join(lowerRoot, "sparse"), "wx");
  try { await sparse.truncate(1024 * 1024); }
  finally { await sparse.close(); }
  await native.mkdir(join(lowerRoot, "directory"));
  await native.symlink("dense", join(lowerRoot, "link"));
  const lower = await createRealFileSystem({ root: lowerRoot });
  const upper = await createRealFileSystem({ root: upperRoot });
  const overlay = new OverlayFileSystem({ upper, lower: createReadOnlyFileSystem(lower) });
  const views = [
    { name: "read-only", filesystem: createReadOnlyFileSystem(lower), prefix: "" },
    { name: "mount", filesystem: createMountFileSystem({ root: new MemoryFileSystem(), mounts: { "/data": lower } }), prefix: "/data" },
    { name: "overlay", filesystem: overlay, prefix: "" },
    { name: "read-only/mount/overlay", filesystem: createReadOnlyFileSystem(createMountFileSystem({
      root: new MemoryFileSystem(), mounts: { "/data": overlay },
    })), prefix: "/data" },
  ];
  const observations = [];
  for (const name of ["dense", "sparse", "directory", "link"]) {
    for (const method of ["stat", "lstat"] as const) {
      const before = await native[method](join(lowerRoot, name), { bigint: true });
      const bytes = before.blocks * 512n;
      const supported = process.platform === "darwin" || process.platform === "linux";
      const expected = supported && before.blocks >= 0n && bytes <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(bytes) : undefined;
      for (const view of views) {
        const result = await view.filesystem[method](`${view.prefix}/${name}`);
        assert.equal(result.allocatedBytes, expected, `${view.name} ${method} ${name}`);
        assert.equal(Object.hasOwn(result, "allocatedBytes"), expected !== undefined);
        assert.equal(result.size, Number(before.size));
        assert.equal(result.ino, Number(before.ino));
        assert.equal(result.dev, Number(before.dev));
      }
      const after = await native[method](join(lowerRoot, name), { bigint: true });
      assert.equal(after.blocks, before.blocks);
      assert.equal(after.ino, before.ino);
      observations.push({ name, method, blocks: before.blocks.toString(), allocatedBytes: expected ?? null });
    }
  }
  assert.deepEqual(await native.readdir(upperRoot), []);
  const lowerBefore = await native.stat(join(lowerRoot, "sparse"), { bigint: true });
  await overlay.chmod("/sparse", 0o600);
  const upperBefore = await native.stat(join(upperRoot, "sparse"), { bigint: true });
  for (const method of ["stat", "lstat"] as const) {
    const expected = await upper[method]("/sparse");
    assert.deepEqual(await overlay[method]("/sparse"), expected);
    assert.deepEqual(await views[3]!.filesystem[method]("/data/sparse"), expected);
  }
  const upperAfter = await native.stat(join(upperRoot, "sparse"), { bigint: true });
  const lowerAfter = await native.stat(join(lowerRoot, "sparse"), { bigint: true });
  assert.equal(upperAfter.blocks, upperBefore.blocks);
  assert.equal(upperAfter.ino, upperBefore.ino);
  assert.equal(lowerAfter.blocks, lowerBefore.blocks);
  assert.equal(lowerAfter.mode, lowerBefore.mode);
  assert.equal(lowerAfter.ino, lowerBefore.ino);
  assert.equal(lowerAfter.size, lowerBefore.size);
  await overlay.cleanup();
  assert.deepEqual(await native.readdir(upperRoot), ["sparse"]);
  context.diagnostic(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
    uv: process.versions.uv, filesystemType: (await native.statfs(root)).type, observations,
    copyUp: { lowerBlocks: lowerAfter.blocks.toString(), upperBlocks: upperAfter.blocks.toString() } }));
});
