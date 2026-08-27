import assert from "node:assert/strict";
import test from "node:test";
import { FsError, toByteSource } from "../../../src/contracts/index.js";
import type { FileStat } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { OverlayFileSystem } from "../../../src/fs/overlay/index.js";
import { decode, encode, errno, immutable, snapshot, wrapped } from "./helpers.js";

type MutableStat = { -readonly [Field in keyof Required<FileStat>]: Required<FileStat>[Field] };

class GetterStat implements FileStat {
  readonly #values: MutableStat;

  constructor(values: MutableStat) { this.#values = values; }

  get type() { return this.#values.type; }
  get size() { return this.#values.size; }
  get allocatedBytes() { return this.#values.allocatedBytes; }
  get mode() { return this.#values.mode; }
  get mtimeMs() { return this.#values.mtimeMs; }
  get atimeMs() { return this.#values.atimeMs; }
  get ctimeMs() { return this.#values.ctimeMs; }
  get birthtimeMs() { return this.#values.birthtimeMs; }
  get identityScope() { return this.#values.identityScope; }
  get ino() { return this.#values.ino; }
  get dev() { return this.#values.dev; }
  get nlink() { return this.#values.nlink; }
  get uid() { return this.#values.uid; }
  get gid() { return this.#values.gid; }
}

const metadata: MutableStat = {
  type: "file", size: 5, allocatedBytes: 4096, mode: 0o100640, mtimeMs: 101, atimeMs: 102,
  ctimeMs: 103, birthtimeMs: 104, identityScope: Symbol(), ino: 105, dev: 0, nlink: 1, uid: 0, gid: 0,
};

const shapes: Record<string, (values: MutableStat) => FileStat> = {
  "prototype getters": (values) => new GetterStat(values),
  "nonenumerable properties": (values) => Object.create(null, Object.fromEntries(
    Object.keys(metadata).map((field) => [field, {
      enumerable: false,
      get: () => values[field as keyof MutableStat],
    }]),
  )) as FileStat,
};

for (const [name, shape] of Object.entries(shapes)) {
  for (const layer of ["upper", "lower"] as const) {
    test(`${layer} ${name}: stat, lstat and listings snapshot every named metadata field`, async () => {
      const backing = new MemoryFileSystem();
      const storage = new MemoryFileSystem();
      const selected = layer === "upper" ? storage : backing;
      await selected.writeFile("/file", encode("value"));
      const before = await snapshot(backing);
      const { lower: protectedLower, mutations } = immutable(backing);
      const values = { ...metadata };
      const shaped = shape(values);
      assert.deepEqual(Object.keys(shaped), []);
      const decorated = wrapped(layer === "upper" ? storage : protectedLower, {
        lstat: async (path, options) => path === "/file" ? shaped : selected.lstat(path, options),
      });
      const overlay = new OverlayFileSystem({
        upper: layer === "upper" ? decorated : storage,
        lower: layer === "lower" ? decorated : protectedLower,
      });
      const stat = await overlay.stat("/file");
      const lstat = await overlay.lstat("/file");
      assert.deepEqual(stat, metadata);
      assert.deepEqual(lstat, metadata);
      assert.notEqual(stat, shaped);
      assert.notEqual(stat, lstat);
      const listing = await overlay.readdir("/");
      assert.deepEqual(listing, [{ name: "file", type: "file" }]);
      values.type = "directory";
      values.size = 1234;
      values.allocatedBytes = 8192;
      values.mode = 0o40700;
      values.mtimeMs = values.atimeMs = values.ctimeMs = 987;
      values.birthtimeMs = values.ino = values.dev = values.nlink = values.uid = values.gid = 654;
      values.identityScope = Symbol();
      assert.deepEqual(stat, metadata);
      assert.deepEqual(lstat, metadata);
      assert.deepEqual(listing, [{ name: "file", type: "file" }]);
      assert.deepEqual(await overlay.lstat("/file"), values);
      Reflect.set(stat, "size", 222);
      Reflect.set(lstat, "uid", 333);
      Reflect.set(listing[0]!, "type", "symlink");
      assert.equal(shaped.size, 1234);
      assert.equal(shaped.uid, 654);
      assert.equal(shaped.type, "directory");
      assert.deepEqual(mutations, []);
      assert.deepEqual(await snapshot(backing), before);
    });
  }

  test(`${name}: directory traversal and lower copy-up preserve shaped metadata`, async () => {
    const backing = new MemoryFileSystem();
    const storage = new MemoryFileSystem();
    await backing.mkdir("/directory", { mode: 0o750 });
    await backing.writeFile("/directory/file", encode("value"), { mode: 0o640 });
    const before = await snapshot(backing);
    const { lower, mutations } = immutable(backing);
    const decorated = wrapped(lower, { lstat: async (path, options) => {
      const stat = await backing.lstat(path, options);
      return shape({ ...metadata, ...stat });
    } });
    const overlay = new OverlayFileSystem({ upper: storage, lower: decorated });
    assert.equal(decode(await overlay.readFile("/directory/file")), "value");
    await overlay.appendFile("/directory/file", encode("!"));
    assert.equal(decode(await overlay.readFile("/directory/file")), "value!");
    assert.equal((await overlay.stat("/directory/file")).mode & 0o7777, 0o640);
    assert.equal((await storage.stat("/directory")).mode & 0o7777, 0o750);
    assert.deepEqual(mutations, []);
    assert.deepEqual(await snapshot(backing), before);
  });
}

test("stat snapshots omit absent optional fields and backend-specific references", async () => {
  const backing = new MemoryFileSystem();
  await backing.writeFile("/file", encode("value"));
  const required: FileStat = {
    type: "file", size: 5, mode: 0o100644, atimeMs: 1, mtimeMs: 2, ctimeMs: 3,
  };
  const foreign = { mutable: true };
  const lower = wrapped(immutable(backing).lower, { lstat: async (path, options) =>
    path === "/file" ? { ...required, foreign } : backing.lstat(path, options),
  });
  const overlay = new OverlayFileSystem({ upper: new MemoryFileSystem(), lower });
  assert.deepEqual(await overlay.stat("/file"), required);
  assert.deepEqual(await overlay.lstat("/file"), required);
});

test("capability metadata cannot be reassigned, redefined, or mutated", () => {
  const overlay = new OverlayFileSystem({ upper: new MemoryFileSystem(), lower: new MemoryFileSystem() });
  const capabilities = overlay.capabilities;
  assert.equal(Reflect.set(capabilities, "hardlinks", true), false);
  assert.equal(Reflect.set(overlay, "capabilities", { ...capabilities, hardlinks: true, atomicRename: true }), false);
  assert.throws(() => Object.defineProperty(overlay, "capabilities", { value: { hardlinks: true } }), TypeError);
  assert.equal(overlay.capabilities, capabilities);
  assert.equal(overlay.capabilities.hardlinks, false);
  assert.equal(overlay.capabilities.atomicRename, false);
});

test("a metadata getter failure is not mistaken for backend absence", async () => {
  const backing = new MemoryFileSystem();
  const upper = new MemoryFileSystem();
  await backing.writeFile("/file", encode("value"));
  const failure = new FsError("ENOENT", { message: "metadata getter failed" });
  const lower = wrapped(immutable(backing).lower, { lstat: async (path, options) =>
    path === "/file" ? { ...metadata, get size(): number { throw failure; } } : backing.lstat(path, options),
  });
  const overlay = new OverlayFileSystem({ upper, lower });
  await assert.rejects(overlay.writeFile("/file", encode("bad"), { flag: "wx" }), (error: unknown) => error === failure);
  assert.deepEqual(await upper.readdir("/"), []);
  assert.equal(decode(await backing.readFile("/file")), "value");
});

const mutators: Record<string, (overlay: OverlayFileSystem, target: string) => Promise<unknown>> = {
  writeFile: (overlay, target) => overlay.writeFile(target, encode("bad")),
  appendFile: (overlay, target) => overlay.appendFile(target, encode("bad")),
  writeStream: (overlay, target) => overlay.writeStream(target, toByteSource("bad")),
  mkdir: (overlay, target) => overlay.mkdir(target),
  recursiveMkdir: (overlay, target) => overlay.mkdir(target, { recursive: true }),
  rm: (overlay, target) => overlay.rm(target, { recursive: true }),
  renameDestination: (overlay, target) => overlay.rename("/source", target),
  renameSource: (overlay, target) => overlay.rename(target, "/destination"),
  copyDestination: (overlay, target) => overlay.copyFile("/source", target),
  copySource: (overlay, target) => overlay.copyFile(target, "/destination"),
  symlink: (overlay, target) => overlay.symlink("/source", target),
  linkDestination: (overlay, target) => overlay.link("/source", target),
  linkSource: (overlay, target) => overlay.link(target, "/destination"),
  chmod: (overlay, target) => overlay.chmod(target, 0o600),
  utimes: (overlay, target) => overlay.utimes(target, 1, 2),
  truncate: (overlay, target) => overlay.truncate(target),
};

for (const [name, mutate] of Object.entries(mutators)) {
  for (const suffix of ["", "/entry/descendant"]) {
    test(`${name} cannot target a recorded private staging ${suffix ? "descendant" : "root"}`, async () => {
      const storage = new MemoryFileSystem();
      const backing = new MemoryFileSystem();
      await storage.writeFile("/source", encode("source"));
      await backing.writeFile("/source", encode("lower source"));
      const lowerBefore = await snapshot(backing);
      const { lower, mutations } = immutable(backing);
      let failCleanup = true;
      const upper = wrapped(storage, { rm: async (path, options) => {
        if (failCleanup && path.startsWith("/.virtual-bash-overlay-")) throw new FsError("EIO");
        await storage.rm(path, options);
      } });
      const overlay = new OverlayFileSystem({ upper, lower });
      await overlay.writeFile("/keeper", encode("keeper"));
      const privateName = (await storage.readdir("/")).find((entry) => entry.name.startsWith(".virtual-bash-overlay-"))!.name;
      const upperBefore = await snapshot(storage);
      await assert.rejects(mutate(overlay, `/${privateName}${suffix}`), (error: unknown) =>
        error instanceof FsError && ["EBUSY", "ENOENT", "ENOTSUP"].includes(error.code));
      assert.deepEqual(await snapshot(storage), upperBefore);
      assert.equal(decode(await overlay.readFile("/source")), "source");
      failCleanup = false;
      await overlay.cleanup();
      assert.equal(decode(await overlay.readFile("/source")), "source");
      assert.equal(decode(await storage.readFile("/source")), "source");
      assert.deepEqual(await overlay.readdir("/"), [{ name: "keeper", type: "file" }, { name: "source", type: "file" }]);
      assert.deepEqual(mutations, []);
      assert.deepEqual(await snapshot(backing), lowerBefore);
    });
  }
}

for (const optional of ["chmod", "utimes", "symlink", "link"] as const) {
  test(`unsupported ${optional} rejects before copy-up or any upper mutation`, async () => {
    const storage = new MemoryFileSystem();
    const backing = new MemoryFileSystem();
    await backing.mkdir("/parent");
    await backing.writeFile("/parent/file", encode("lower"));
    const before = await snapshot(backing);
    const { lower, mutations } = immutable(backing);
    const upperCalls: string[] = [];
    const capabilities = { ...storage.capabilities, permissions: false, timestamps: false, symlinks: false, hardlinks: false };
    const upper = new Proxy(storage, { get(target, property) {
      if (property === "capabilities") return capabilities;
      const value: unknown = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      if (["writeFile", "appendFile", "mkdir", "rm", "rename", "chmod", "utimes", "symlink", "link", "truncate"].includes(String(property))) {
        return async () => { upperCalls.push(String(property)); throw new Error("unexpected upper mutation"); };
      }
      return value.bind(target);
    } });
    const overlay = new OverlayFileSystem({ upper, lower });
    if (optional === "chmod") await assert.rejects(overlay.chmod("/parent/file", 0o600), errno("ENOTSUP"));
    if (optional === "utimes") await assert.rejects(overlay.utimes("/parent/file", 1, 2), errno("ENOTSUP"));
    if (optional === "symlink") await assert.rejects(overlay.symlink("/parent/file", "/parent/new"), errno("ENOTSUP"));
    if (optional === "link") await assert.rejects(overlay.link("/parent/file", "/parent/new"), errno("ENOTSUP"));
    assert.deepEqual(upperCalls, []);
    assert.deepEqual(mutations, []);
    assert.deepEqual(await snapshot(backing), before);
  });
}
