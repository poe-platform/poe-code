import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../src/contracts/errors.js";
import type { FileStat, FileSystem } from "../../../src/contracts/filesystem.js";
import { collectBytes } from "../../../src/contracts/io.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../../src/fs/mount/index.js";
import { ReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const errno = (code: string) => (error: unknown): boolean => error instanceof FsError && error.code === code;

function snapshot(filesystems: readonly FileSystem[]): unknown {
  return filesystems.map((filesystem) => {
    const root: unknown = Reflect.get(filesystem, "root");
    assert.ok(root);
    return structuredClone({ root, nextInode: Reflect.get(filesystem, "nextInode") });
  });
}

for (const [target, path] of [
  ["../b", "/a/new/../escape/created"],
  ["new/../../b", "/a/escape/created"],
  ["../b", "//a/new/../escape/created/"],
  ["new/../../b", "//a/escape/created/"],
] as const) {
  test(`review: recursive mkdir preflights ${path} -> ${target} without any backend changes`, async () => {
    const root = createMemoryFileSystem();
    const first = createMemoryFileSystem();
    const second = createMemoryFileSystem();
    await first.symlink(target, "/escape");
    await second.writeFile("/untouched", encode("data"));
    const fs = createMountFileSystem({ root, mounts: { "/a": first, "/b": second } });
    const before = snapshot([root, first, second]);
    await assert.rejects(fs.mkdir(path, { recursive: true }), errno("EACCES"));
    assert.deepEqual(snapshot([root, first, second]), before);
  });
}

test("review: recursive mkdir rejects a later nested boundary without creating earlier prefixes", async () => {
  const root = createMemoryFileSystem();
  const first = createMemoryFileSystem();
  const nested = createMemoryFileSystem();
  await first.symlink("nested", "/escape");
  const fs = createMountFileSystem({ root, mounts: { "/a": first, "/a/nested": nested } });
  const before = snapshot([root, first, nested]);
  await assert.rejects(fs.mkdir("/a/new/../escape/created", { recursive: true }), errno("EACCES"));
  assert.deepEqual(snapshot([root, first, nested]), before);
});

test("review: unary errors never expose backend-local dest or messages", async () => {
  const base = createMemoryFileSystem();
  await base.writeFile("/file", encode("data"));
  const failure = new FsError("EACCES", { path: "/private-source", dest: "/private-destination" });
  const backend = new Proxy(base, {
    get(target, key) {
      if (key === "readFile") return async () => { throw failure; };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/public": backend } });
  await assert.rejects(fs.readFile("/public/file"), (error: unknown) => {
    assert.ok(error instanceof FsError);
    assert.equal(error.path, "/public/file");
    assert.equal(error.syscall, "readFile");
    assert.equal(error.dest, undefined);
    assert.equal(error.cause, failure);
    assert.doesNotMatch(error.message, /private-source|private-destination/);
    return true;
  });
});

function fields<Value extends object>(value: Value, prototype: boolean): Value {
  const descriptors = Object.fromEntries(Object.entries(value).map(([name, field]) => [name, {
    get: () => field,
    enumerable: false,
    configurable: false,
  }]));
  return prototype ? Object.create(Object.create(null, descriptors)) as Value
    : Object.create(null, descriptors) as Value;
}

for (const prototype of [false, true]) {
  test(`review: snapshots retain named metadata from ${prototype ? "prototype getters" : "nonenumerable own getters"}`, async () => {
    const base = createMemoryFileSystem();
    await base.writeFile("/file", encode("data"));
    const file: FileStat = {
      type: "file", size: 4, mode: 0o100640, mtimeMs: 101, atimeMs: 102, ctimeMs: 103,
      birthtimeMs: 0, ino: 11, dev: 12, nlink: 2, uid: 0, gid: 0,
    };
    const backend = new Proxy(base, {
      get(target, key) {
        if (key === "lstat") return async (path: string) => fields(path === "/file" ? file : await base.lstat(path), prototype);
        if (key === "readdir") return async () => [fields({ name: "file", type: "file" as const }, prototype)];
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const fs = createMountFileSystem({ root: backend });
    assert.deepEqual(await fs.stat("/file"), file);
    assert.deepEqual(await fs.lstat("/file"), file);
    assert.deepEqual(await fs.readdir("/"), [{ name: "file", type: "file" }]);
    const result = await fs.stat("/file");
    assert.notEqual(result, file);
    assert.equal(Object.hasOwn(result, "uid"), true);
    assert.equal(Object.hasOwn(result, "birthtimeMs"), true);
  });
}

for (const prefix of ["", "/outer"]) {
  test(`review: opaque ReadOnly(innerMount) at ${prefix || "/"} fails closed on ambiguous or forbidden symlinks`, async () => {
    const root = createMemoryFileSystem();
    const first = createMemoryFileSystem();
    const second = createMemoryFileSystem();
    const nested = createMemoryFileSystem();
    await root.writeFile("/value", encode("root-private"));
    await root.writeFile("/missing", encode("root-dangling-trap"));
    await root.mkdir("/nested");
    await root.writeFile("/nested/value", encode("root-nested-trap"));
    await root.symlink("/value", "/root-link");
    await first.writeFile("/value", encode("first"));
    await second.writeFile("/value", encode("second"));
    await nested.writeFile("/value", encode("nested"));
    await first.symlink("/value", "/absolute");
    await first.symlink("value", "/relative");
    await first.symlink("/missing", "/dangling");
    await first.symlink(".", "/here");
    await first.symlink("../b/value", "/escape");
    await first.symlink("/nested/value", "/nested-link");
    const inner = createMountFileSystem({ root, mounts: { "/a": first, "/b": second, "/a/nested": nested } });
    const readonly = new ReadOnlyFileSystem(inner);
    const fs = prefix ? createMountFileSystem({ root: createMemoryFileSystem(), mounts: { [prefix]: readonly } })
      : createMountFileSystem({ root: readonly });
    assert.deepEqual(await fs.readFile(`${prefix}/a/value`), encode("first"));
    assert.deepEqual(await fs.readFile(`${prefix}/a/relative`), encode("first"));
    assert.deepEqual(await fs.readFile(`${prefix}/root-link`), encode("root-private"));
    assert.deepEqual(await fs.readFile(`${prefix}/a/nested/value`), encode("nested"));
    assert.deepEqual(await fs.readFile(`${prefix}/b/value`), encode("second"));
    assert.equal(await fs.readlink(`${prefix}/a/absolute`), "/value");
    assert.equal((await fs.lstat(`${prefix}/a/dangling`)).type, "symlink");
    const before = snapshot([root, first, second, nested]);
    for (const operation of [
      () => fs.readFile(`${prefix}/a/absolute`),
      () => fs.stat(`${prefix}/a/absolute`),
      () => fs.realpath(`${prefix}/a/absolute`),
      () => collectBytes(fs.readStream(`${prefix}/a/absolute`), { maxBytes: 100 }),
    ]) await assert.rejects(operation(), errno("ENOTSUP"));
    await assert.rejects(fs.readFile(`${prefix}/a/dangling`), errno("ENOENT"));
    for (const path of [
      "/a/escape", "/a/nested-link", "/a/here/nested/value", "/a/here/../b/value",
      "/a/here/nested/../value", "/a/here/../a/value",
    ]) {
      await assert.rejects(fs.readFile(`${prefix}${path}`), errno("EACCES"));
    }
    for (const operation of [
      () => fs.lstat(`${prefix}/a/here/nested`),
      () => fs.rm(`${prefix}/a/here/nested`, { recursive: true }),
      () => fs.readlink(`${prefix}/a/here/nested`),
      () => fs.rename(`${prefix}/a/here/nested`, `${prefix}/a/new`),
      () => fs.rename(`${prefix}/a/value`, `${prefix}/a/here/nested`),
      () => fs.symlink("value", `${prefix}/a/here/nested`),
    ]) await assert.rejects(operation(), errno("EACCES"));
    assert.deepEqual(snapshot([root, first, second, nested]), before);
  });
}

test("review: symlink verification preserves no-follow final entry operations through a directory link", async () => {
  const base = createMemoryFileSystem();
  await base.mkdir("/dir");
  await base.writeFile("/dir/file", encode("data"));
  await base.symlink("file", "/dir/link");
  await base.symlink("dir", "/alias");
  const fs = createMountFileSystem({ root: base });
  assert.equal((await fs.lstat("/alias/link")).type, "symlink");
  assert.equal(await fs.readlink("/alias/link"), "file");
  await fs.symlink("file", "/alias/new");
  await fs.rename("/alias/new", "/alias/moved");
  await fs.link("/alias/link", "/alias/hardlink");
  assert.equal((await fs.lstat("/alias/hardlink")).type, "symlink");
  await fs.rm("/alias/moved");
  assert.deepEqual(await fs.readFile("/alias/link"), encode("data"));
});

test("review: recursive mkdir replays a complete plan in order across explicit mount paths", async () => {
  const root = createMemoryFileSystem();
  const first = createMemoryFileSystem();
  const second = createMemoryFileSystem();
  const fs = createMountFileSystem({ root, mounts: { "/a": first, "/b": second } });
  await fs.mkdir("/a/new/deep/../../new/../..//b/new/deep", { recursive: true, mode: 0o750 });
  assert.equal((await first.stat("/new/deep")).mode & 0o777, 0o750);
  assert.equal((await second.stat("/new/deep")).mode & 0o777, 0o750);
});

test("review: recursive mkdir execution failures retain documented partial-creation behavior", async () => {
  const base = createMemoryFileSystem();
  let calls = 0;
  const backend = new Proxy(base, {
    get(target, key) {
      if (key === "mkdir") return async (path: string) => {
        if (++calls === 2) throw new FsError("ENOSPC");
        await base.mkdir(path);
      };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const fs = createMountFileSystem({ root: backend });
  await assert.rejects(fs.mkdir("/one/two/three", { recursive: true }), errno("ENOSPC"));
  assert.equal((await base.stat("/one")).type, "directory");
  await assert.rejects(base.stat("/one/two"), errno("ENOENT"));
  assert.equal(calls, 2);
});

test("review: an inconsistent backend realpath cannot redirect a symlink read", async () => {
  const base = createMemoryFileSystem();
  await base.writeFile("/target", encode("data"));
  await base.symlink("target", "/link");
  let reads = 0;
  const backend = new Proxy(base, {
    get(target, key) {
      if (key === "realpath") return async () => "/elsewhere";
      if (key === "readFile") return async () => { reads++; return encode("should not read"); };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const fs = createMountFileSystem({ root: backend });
  await assert.rejects(fs.readFile("/link"), errno("ENOTSUP"));
  assert.equal(reads, 0);
});

test("review: metadata snapshots omit absent optional fields rather than inventing undefined properties", async () => {
  const base = createMemoryFileSystem();
  const stat: FileStat = { type: "directory", size: 0, mode: 0o40755, mtimeMs: 1, atimeMs: 2, ctimeMs: 3 };
  const backend = new Proxy(base, {
    get(target, key) {
      if (key === "lstat") return async () => fields(stat, true);
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const fs = createMountFileSystem({ root: backend });
  const result = await fs.stat("/");
  assert.deepEqual(result, stat);
  for (const field of ["birthtimeMs", "ino", "dev", "nlink", "uid", "gid"]) assert.equal(Object.hasOwn(result, field), false);
});

test("review: conservative dangling-target denials do not mutate metadata or consume streams", async () => {
  const base = createMemoryFileSystem();
  await base.writeFile("/source", encode("data"));
  await base.symlink("/missing", "/dangling");
  const fs = createMountFileSystem({ root: base });
  let consumed = false;
  const source = (async function* () { consumed = true; yield encode("data"); })();
  const before = snapshot([base]);
  for (const operation of [
    () => fs.writeFile("/dangling", encode("data")),
    () => fs.appendFile("/dangling", encode("data")),
    () => fs.writeStream("/dangling", source),
    () => fs.copyFile("/source", "/dangling"),
    () => fs.mkdir("/dangling/deep", { recursive: true }),
  ]) await assert.rejects(operation(), errno("ENOENT"));
  assert.equal(consumed, false);
  assert.deepEqual(snapshot([base]), before);
});
