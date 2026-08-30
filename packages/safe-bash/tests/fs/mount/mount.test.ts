import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../src/contracts/errors.js";
import type { ErrnoCode } from "../../../src/contracts/errors.js";
import type { FileSystem, FsOptions, ReadStreamOptions, WriteFileOptions } from "../../../src/contracts/filesystem.js";
import { collectBytes, toByteSource } from "../../../src/contracts/io.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createMountFileSystem, MountFileSystem } from "../../../src/fs/mount/index.js";

const bytes = new Uint8Array([0, 1, 2, 127, 128, 255]);
const encode = (value: string): Uint8Array => new TextEncoder().encode(value);
const decode = (value: Uint8Array): string => new TextDecoder().decode(value);
const errno = (code: ErrnoCode, path?: string, dest?: string, syscall?: string) => (error: unknown): boolean => {
  assert.ok(error instanceof FsError);
  assert.equal(error.code, code);
  if (path !== undefined) assert.equal(error.path, path);
  if (dest !== undefined) assert.equal(error.dest, dest);
  if (syscall !== undefined) assert.equal(error.syscall, syscall);
  return true;
};

type Overrides = { [Key in keyof FileSystem]?: FileSystem[Key] | undefined };

function backend(overrides: Overrides = {}, base = createMemoryFileSystem()): FileSystem {
  return new Proxy(base, {
    get(target, key) {
      if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function fixture(): { fs: MountFileSystem; root: ReturnType<typeof createMemoryFileSystem>; disk: ReturnType<typeof createMemoryFileSystem> } {
  const root = createMemoryFileSystem();
  const disk = createMemoryFileSystem();
  return { fs: createMountFileSystem({ root, mounts: { "/disk": disk } }), root, disk };
}

for (const prefix of ["", "/disk"]) {
  test(`contract ${prefix || "root"}: binary writes, append, exclusive flags, stat and remove`, async () => {
    const { fs } = fixture();
    await fs.mkdir(`${prefix}/dir`);
    await fs.writeFile(`${prefix}/dir/file`, bytes, { mode: 0o600 });
    await fs.appendFile(`${prefix}/dir/file`, new Uint8Array([42]));
    assert.deepEqual(await fs.readFile(`${prefix}/dir/file`), new Uint8Array([...bytes, 42]));
    await assert.rejects(fs.readFile(`${prefix}/dir/file`, { maxBytes: 2 }), errno("EFBIG"));
    await assert.rejects(fs.writeFile(`${prefix}/dir/file`, bytes, { flag: "wx" }), errno("EEXIST"));
    await assert.rejects(fs.writeFile(`${prefix}/dir/file`, bytes, { flag: "ax" }), errno("EEXIST"));
    assert.equal((await fs.stat(`${prefix}/dir/file`)).mode & 0o777, 0o600);
    assert.equal((await fs.lstat(`${prefix}/dir/file`)).type, "file");
    await fs.access(`${prefix}/dir/file`, 6);
    await fs.rm(`${prefix}/dir`, { recursive: true });
    await fs.rm(`${prefix}/missing`, { force: true });
    await assert.rejects(fs.stat(`${prefix}/dir`), errno("ENOENT"));
  });

  test(`contract ${prefix || "root"}: mkdir, copy, rename, realpath and directory entries`, async () => {
    const { fs } = fixture();
    await fs.mkdir(`${prefix}/parent/child/`, { recursive: true });
    await fs.mkdir(`${prefix}/parent/child`, { recursive: true });
    await fs.writeFile(`${prefix}/parent/child/file`, bytes);
    await fs.copyFile(`${prefix}/parent/child/file`, `${prefix}/parent/copied`, { exclusive: true });
    await assert.rejects(fs.copyFile(`${prefix}/parent/child/file`, `${prefix}/parent/copied`, { exclusive: true }), errno("EEXIST"));
    await fs.rename(`${prefix}/parent/copied`, `${prefix}/parent/renamed`);
    assert.deepEqual(await fs.readFile(`${prefix}/parent/renamed`), bytes);
    assert.equal(await fs.realpath(`${prefix}/parent//child/../renamed`), `${prefix}/parent/renamed`);
    assert.deepEqual(await fs.readdir(`${prefix}/parent`), [
      { name: "child", type: "directory" }, { name: "renamed", type: "file" },
    ]);
  });

  test(`contract ${prefix || "root"}: optional metadata, hardlinks and bounded streams`, async () => {
    const { fs } = fixture();
    await fs.writeStream(`${prefix}/file`, toByteSource(bytes));
    await fs.link(`${prefix}/file`, `${prefix}/alias`);
    await fs.truncate(`${prefix}/alias`, 3);
    await fs.chmod(`${prefix}/alias`, 0o640);
    await fs.utimes(`${prefix}/alias`, 1000, 2000);
    const stat = await fs.stat(`${prefix}/file`);
    assert.equal(stat.size, 3);
    assert.equal(stat.mode & 0o777, 0o640);
    assert.equal(stat.mtimeMs, 2000);
    assert.equal(stat.ino, (await fs.stat(`${prefix}/alias`)).ino);
    assert.deepEqual(await collectBytes(fs.readStream(`${prefix}/file`, { start: 1, endExclusive: 3, chunkSize: 1 }), { maxBytes: 2 }), bytes.slice(1, 3));
  });
}

test("configuration snapshots mounts and rejects ambiguous normalized keys", async () => {
  const root = createMemoryFileSystem();
  const disk = createMemoryFileSystem();
  const mounts: Record<string, FileSystem> = { "/first/../disk//": disk };
  const fs = new MountFileSystem({ root, mounts });
  mounts["/later"] = createMemoryFileSystem();
  assert.deepEqual(await fs.readdir("/"), [{ name: "disk", type: "directory" }]);
  for (const invalid of [
    { "relative": disk }, { "/": disk },
    { "/disk": disk, "/disk/.": createMemoryFileSystem() },
  ]) assert.throws(() => new MountFileSystem({ root, mounts: invalid }), errno("EINVAL"));
  assert.throws(() => new MountFileSystem({ root, mounts: { "/bad\0": disk } }), errno("EINVAL"));
});

test("one backing store can be mounted at multiple locations without losing alias identity", async () => {
  const root = createMemoryFileSystem();
  const fs = new MountFileSystem({ root, mounts: { "/first": root, "/second": root } });
  await fs.writeFile("/first/file", encode("shared"));
  assert.equal(decode(await fs.readFile("/second/file")), "shared");
  assert.deepEqual(await fs.stat("/first/file"), await fs.stat("/second/file"));
  await assert.rejects(fs.copyFile("/first/file", "/second/file"), errno("EINVAL"));
  assert.equal(decode(await fs.readFile("/file")), "shared");
  await fs.copyFile("/first/file", "/second/distinct");
  assert.equal(decode(await fs.readFile("/distinct")), "shared");
});

test("longest component prefix distinguishes siblings and nested mounts", async () => {
  const root = createMemoryFileSystem();
  const short = createMemoryFileSystem();
  const sibling = createMemoryFileSystem();
  const nested = createMemoryFileSystem();
  const fs = createMountFileSystem({ root, mounts: { "/data": short, "/database": sibling, "/data/nested": nested } });
  await fs.writeFile("/data/file", encode("short"));
  await fs.writeFile("/database/file", encode("sibling"));
  await fs.writeFile("/data/nested/file", encode("nested"));
  await fs.writeFile("/data-more", encode("root"));
  assert.equal(decode(await short.readFile("/file")), "short");
  assert.equal(decode(await sibling.readFile("/file")), "sibling");
  assert.equal(decode(await nested.readFile("/file")), "nested");
  assert.equal(decode(await root.readFile("/data-more")), "root");
  assert.equal(await fs.realpath("data//nested/./file"), "/data/nested/file");
});

test("nested synthetic parents provide consistent stat, access, realpath and merged listings", async () => {
  const root = createMemoryFileSystem();
  const fs = createMountFileSystem({ root, mounts: {
    "/deep/parent/one": createMemoryFileSystem(),
    "/deep/parent/two": createMemoryFileSystem(),
    "/deep/other": createMemoryFileSystem(),
  } });
  await root.writeFile("/ordinary", bytes);
  assert.deepEqual(await fs.readdir("/"), [{ name: "deep", type: "directory" }, { name: "ordinary", type: "file" }]);
  assert.deepEqual(await fs.readdir("/deep"), [{ name: "other", type: "directory" }, { name: "parent", type: "directory" }]);
  assert.deepEqual(await fs.readdir("/deep/parent"), [{ name: "one", type: "directory" }, { name: "two", type: "directory" }]);
  const first = await fs.stat("/deep/parent/");
  assert.equal(first.type, "directory");
  assert.equal(first.mode, 0o40555);
  assert.deepEqual(await fs.lstat("/deep/parent"), first);
  await fs.access("/deep/parent", 5);
  await assert.rejects(fs.access("/deep/parent", 2), errno("EACCES"));
  assert.equal(await fs.realpath("/deep/parent/one/.."), "/deep/parent");
  await assert.rejects(fs.readFile("/deep"), errno("EISDIR"));
  await assert.rejects(fs.writeFile("/deep/new", bytes), errno("ENOTSUP"));
  await assert.rejects(fs.mkdir("/deep/new", { recursive: true }), errno("ENOTSUP"));
  await fs.mkdir("/deep/parent", { recursive: true });
  assert.deepEqual(await root.readdir("/"), [{ name: "ordinary", type: "file" }]);
});

for (const hiddenType of ["file", "symlink", "directory"] as const) {
  test(`mount ancestors hide underlying ${hiddenType} without leaking its descendants`, async () => {
    const root = createMemoryFileSystem();
    await root.mkdir("/private");
    await root.writeFile("/private/secret", bytes);
    if (hiddenType === "file") await root.writeFile("/ancestor", bytes);
    if (hiddenType === "symlink") await root.symlink("/private", "/ancestor");
    if (hiddenType === "directory") {
      await root.mkdir("/ancestor");
      await root.writeFile("/ancestor/visible", bytes);
      await root.writeFile("/ancestor/store", bytes);
    }
    const disk = createMemoryFileSystem();
    const fs = createMountFileSystem({ root, mounts: { "/ancestor/store": disk } });
    assert.equal((await fs.stat("/ancestor")).type, "directory");
    assert.equal((await fs.lstat("/ancestor")).type, "directory");
    assert.deepEqual(await fs.readdir("/ancestor"), hiddenType === "directory"
      ? [{ name: "store", type: "directory" }, { name: "visible", type: "file" }]
      : [{ name: "store", type: "directory" }]);
    assert.equal((await fs.readdir("/")).find((entry) => entry.name === "ancestor")?.type, "directory");
    await assert.rejects(fs.readFile("/ancestor/secret"), errno("ENOENT"));
    if (hiddenType === "directory") {
      await fs.writeFile("/ancestor/secret", bytes);
      assert.deepEqual(await fs.readFile("/ancestor/secret"), bytes);
    } else {
      await assert.rejects(fs.writeFile("/ancestor/secret", bytes), errno("ENOTSUP"));
    }
    await fs.writeFile("/ancestor/store/public", bytes);
    assert.deepEqual(await disk.readFile("/public"), bytes);
    assert.deepEqual(await fs.readdir("/ancestor/store"), [{ name: "public", type: "file" }]);
    assert.deepEqual(await root.readFile("/private/secret"), bytes);
  });
}

test("mount roots hide underlying directories and nested mounts hide backend entries", async () => {
  const { root, disk } = fixture();
  await root.mkdir("/disk");
  await root.writeFile("/disk/hidden", bytes);
  await disk.mkdir("/nested");
  await disk.writeFile("/nested/hidden", bytes);
  await disk.writeFile("/ordinary", bytes);
  const nested = createMemoryFileSystem();
  const fs = createMountFileSystem({ root, mounts: { "/disk": disk, "/disk/nested": nested } });
  assert.deepEqual(await fs.readdir("/disk"), [{ name: "nested", type: "directory" }, { name: "ordinary", type: "file" }]);
  assert.deepEqual(await fs.readdir("/disk/nested"), []);
  await assert.rejects(fs.readFile("/disk/hidden"), errno("ENOENT"));
  await assert.rejects(fs.readFile("/disk/nested/hidden"), errno("ENOENT"));
});

test("absolute symlinks are mount-local, and chains resolve before dotdot", async () => {
  const { fs, root, disk } = fixture();
  await root.writeFile("/value", encode("root"));
  await disk.mkdir("/dir/sub", { recursive: true });
  await disk.writeFile("/value", encode("disk"));
  await disk.writeFile("/dir/value", encode("parent"));
  await fs.symlink("/value", "/disk/absolute");
  await fs.symlink("absolute", "/disk/chain");
  await fs.symlink("/dir/sub", "/disk/directory");
  assert.equal(decode(await fs.readFile("/disk/chain")), "disk");
  assert.equal(await fs.readlink("/disk/absolute"), "/value");
  assert.equal(await fs.realpath("/disk/chain"), "/disk/value");
  assert.equal(decode(await fs.readFile("/disk/directory/../value")), "parent");
  assert.equal(await fs.realpath("/disk/directory/.."), "/disk/dir");
  assert.equal((await fs.lstat("/disk/directory")).type, "symlink");
  assert.equal((await fs.lstat("/disk/directory/")).type, "directory");
});

test("dangling symlinks support inspection but require explicit target creation", async () => {
  const { fs, disk } = fixture();
  await fs.symlink("/target", "/disk/dangling");
  assert.equal((await fs.lstat("/disk/dangling")).type, "symlink");
  assert.equal(await fs.readlink("/disk/dangling"), "/target");
  await assert.rejects(fs.stat("/disk/dangling"), errno("ENOENT", "/disk/dangling", undefined, "stat"));
  await assert.rejects(fs.writeFile("/disk/dangling", bytes, { flag: "wx" }), errno("EEXIST"));
  await assert.rejects(fs.writeFile("/disk/dangling", bytes), errno("ENOENT"));
  await assert.rejects(disk.lstat("/target"), errno("ENOENT"));
  await fs.writeFile("/disk/target", bytes);
  await fs.writeFile("/disk/dangling", bytes);
  assert.deepEqual(await disk.readFile("/target"), bytes);
  await fs.rm("/disk/dangling");
  assert.deepEqual(await disk.readFile("/target"), bytes);
});

test("symlink expansion bound accepts 40 links and rejects chains and cycles beyond it", async () => {
  const { fs, disk } = fixture();
  await disk.writeFile("/target", bytes);
  for (let index = 40; index >= 0; index--) await disk.symlink(index === 40 ? "/target" : `/link${index + 1}`, `/link${index}`);
  assert.deepEqual(await fs.readFile("/disk/link1"), bytes);
  await assert.rejects(fs.readFile("/disk/link0"), errno("ELOOP", "/disk/link0"));
  await disk.symlink("cycle-b", "/cycle-a");
  await disk.symlink("cycle-a", "/cycle-b");
  await assert.rejects(fs.realpath("/disk/cycle-a"), errno("ELOOP"));
});

for (const target of ["../victim", "/../victim", "../../disk/victim", "/nested/victim", "nested/../victim"]) {
  test(`symlink boundary rejects target ${target} without touching sibling or nested data`, async () => {
    const { root, disk } = fixture();
    const nested = createMemoryFileSystem();
    const fs = createMountFileSystem({ root, mounts: { "/disk": disk, "/disk/nested": nested } });
    await root.writeFile("/victim", bytes);
    await disk.writeFile("/victim", bytes);
    await nested.writeFile("/victim", bytes);
    await fs.symlink(target, "/disk/escape");
    await assert.rejects(fs.readFile("/disk/escape"), errno("EACCES", "/disk/escape"));
    await assert.rejects(fs.writeFile("/disk/escape", encode("changed")), errno("EACCES"));
    assert.equal(await fs.readlink("/disk/escape"), target);
    assert.deepEqual(await root.readFile("/victim"), bytes);
    assert.deepEqual(await disk.readFile("/victim"), bytes);
    assert.deepEqual(await nested.readFile("/victim"), bytes);
    await fs.rm("/disk/escape");
  });
}

test("symlink pinning also rejects caller suffix crossings and root aliases into mounted backends", async () => {
  const { root, disk } = fixture();
  const fs = createMountFileSystem({ root, mounts: { "/disk": disk, "/disk/nested": createMemoryFileSystem() } });
  await disk.symlink("/", "/alias");
  await root.symlink("/disk", "/root-alias");
  assert.equal(await fs.realpath("/disk/alias"), "/disk");
  await assert.rejects(fs.stat("/disk/alias/nested"), errno("EACCES"));
  await assert.rejects(fs.stat("/disk/alias/.."), errno("EACCES"));
  await assert.rejects(fs.stat("/root-alias"), errno("EACCES"));
  assert.equal(await fs.realpath("/disk/../disk/nested/.."), "/disk");
});

test("missing and nondirectory components cannot be removed by lexical dotdot normalization", async () => {
  const { fs } = fixture();
  await fs.writeFile("/disk/file", bytes);
  await assert.rejects(fs.stat("/missing/../disk"), errno("ENOENT"));
  await assert.rejects(fs.stat("/disk/file/../file"), errno("ENOTDIR"));
  await assert.rejects(fs.stat("/disk/file/"), errno("ENOTDIR"));
  await assert.rejects(fs.stat(""), errno("ENOENT"));
  await assert.rejects(fs.stat("/disk/bad\0"), errno("EINVAL"));
  assert.equal(await fs.realpath("////./../disk/.."), "/");
});

test("trailing slash entry mutations cannot delete or rename a symlink referent", async () => {
  const { fs } = fixture();
  await fs.mkdir("/disk/dir/");
  await fs.writeFile("/disk/dir/file", bytes);
  await fs.symlink("dir", "/disk/link");
  await assert.rejects(fs.rm("/disk/link/", { recursive: true }), errno("ENOTDIR"));
  await assert.rejects(fs.rename("/disk/link/", "/disk/moved"), errno("ENOTDIR"));
  await assert.rejects(fs.rename("/disk/dir", "/disk/link/"), errno("ENOTDIR"));
  await assert.rejects(fs.writeFile("/disk/missing/", bytes), errno("ENOENT"));
  await assert.rejects(fs.rm("/disk/dir/.", { recursive: true }), errno("EINVAL"));
  await fs.rename("/disk/dir/", "/disk/moved/");
  assert.deepEqual(await fs.readFile("/disk/moved/file"), bytes);
  assert.equal((await fs.lstat("/disk/link")).type, "symlink");
});

for (const path of ["/", "//", "/.", "/..", "/disk/..", "/disk", "/disk/", "/parent", "/parent/deep"]) {
  test(`protected namespace ${path} cannot be mutated through any writing dispatcher`, async () => {
    const { root, disk } = fixture();
    const fs = createMountFileSystem({ root, mounts: { "/disk": disk, "/parent/deep/store": createMemoryFileSystem() } });
    await fs.writeFile("/ordinary", bytes);
    for (const operation of [
      () => fs.rm(path, { recursive: true, force: true }),
      () => fs.rename(path, "/changed"),
      () => fs.rename("/ordinary", path),
      () => fs.copyFile("/ordinary", path),
      () => fs.writeFile(path, bytes),
      () => fs.appendFile(path, bytes),
      () => fs.writeStream(path, toByteSource(bytes)),
      () => fs.chmod(path, 0o777),
      () => fs.utimes(path, 1, 2),
      () => fs.truncate(path),
      () => fs.symlink("ordinary", path),
      () => fs.link("/ordinary", path),
      () => fs.mkdir(path),
    ]) await assert.rejects(operation(), errno("EBUSY"));
    assert.deepEqual(await fs.readFile("/ordinary"), bytes);
    assert.equal((await fs.stat(path)).type, "directory");
  });
}

test("existing directories containing mounts are protected even through same-backend symlinks", async () => {
  const root = createMemoryFileSystem();
  await root.mkdir("/parent");
  await root.symlink("/parent", "/alias");
  const fs = createMountFileSystem({ root, mounts: { "/parent/store": createMemoryFileSystem() } });
  await fs.writeFile("/parent/ordinary", bytes);
  await assert.rejects(fs.rm("/parent", { recursive: true }), errno("EBUSY"));
  await assert.rejects(fs.chmod("/alias", 0), errno("EBUSY"));
  await assert.rejects(fs.rename("/parent", "/moved"), errno("EBUSY"));
  await fs.rm("/parent/ordinary");
  await fs.rm("/alias");
  assert.equal((await fs.stat("/parent/store")).type, "directory");
});

test("cross-mount copyFile transfers bytes without deleting its source", async () => {
  const { fs, root, disk } = fixture();
  await root.writeFile("/source", bytes);
  await disk.writeFile("/destination", encode("old"));
  await fs.copyFile("/source", "/disk/destination");
  assert.deepEqual(await disk.readFile("/destination"), bytes);
  assert.deepEqual(await root.readFile("/source"), bytes);
  await fs.copyFile("/disk/destination", "/returned", { exclusive: true });
  assert.deepEqual(await root.readFile("/returned"), bytes);
  await assert.rejects(fs.copyFile("/source", "/disk/destination", { exclusive: true }), errno("EEXIST"));
});

for (const method of ["rename", "link"] as const) {
  test(`cross-mount ${method} is EXDEV and never transfers or mutates data`, async () => {
    const root = createMemoryFileSystem();
    const disk = createMemoryFileSystem();
    await root.writeFile("/source", bytes);
    await disk.writeFile("/destination", encode("keep"));
    let calls = 0;
    const forbidden = async (): Promise<never> => { calls++; throw new Error("data transfer must not happen"); };
    const operations = { readFile: forbidden, writeFile: forbidden, rm: forbidden, rename: forbidden, copyFile: forbidden, link: forbidden };
    const fs = createMountFileSystem({ root: backend(operations, root), mounts: { "/disk": backend(operations, disk) } });
    await assert.rejects(fs[method]("source", "/disk/destination"), errno("EXDEV", "/source", "/disk/destination", method));
    await assert.rejects(fs[method]("source", "/disk/new"), errno("EXDEV"));
    assert.equal(calls, 0);
    assert.deepEqual(await root.readFile("/source"), bytes);
    assert.equal(decode(await disk.readFile("/destination")), "keep");
    await assert.rejects(disk.stat("/new"), errno("ENOENT"));
  });
}

test("same-mount copy failure retains backend partial semantics and global error metadata", async () => {
  const disk = createMemoryFileSystem();
  await disk.writeFile("/source", bytes);
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/disk": backend({
    async copyFile(source, destination, options) {
      await disk.writeFile(destination, new Uint8Array([99]), options);
      throw new FsError("ENOSPC", { syscall: "backend-copy", path: source, dest: destination });
    },
  }, disk) } });
  await assert.rejects(fs.copyFile("/disk/source", "disk/destination"), errno("ENOSPC", "/disk/source", "/disk/destination", "copyFile"));
  assert.deepEqual(await disk.readFile("/destination"), new Uint8Array([99]));
  assert.deepEqual(await disk.readFile("/source"), bytes);
});

test("backend errors expose only global top-level metadata, preserving their cause", async () => {
  const failure = new FsError("EACCES", { syscall: "private", path: "/file", dest: "/other" });
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/disk": backend({ readFile: async () => { throw failure; } }) } });
  await fs.writeFile("/disk/file", bytes);
  await assert.rejects(fs.readFile("disk/file"), (error: unknown) => {
    errno("EACCES", "/disk/file", undefined, "readFile")(error);
    assert.ok(error instanceof FsError);
    assert.equal(error.cause, failure);
    assert.equal(error.dest, undefined);
    return true;
  });
});

test("heterogeneous capability intersections do not disable a capable selected mount", async () => {
  const unsupported = backend({
    capabilities: {}, readlink: undefined, symlink: undefined, link: undefined,
    chmod: undefined, utimes: undefined, truncate: undefined, readStream: undefined, writeStream: undefined,
  });
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/limited": unsupported } });
  for (const key of ["symlinks", "hardlinks", "permissions", "timestamps", "atomicRename"]) assert.equal(fs.capabilities[key], false);
  assert.equal(fs.capabilities.streamingRead, undefined);
  assert.equal(fs.capabilities.streamingWrite, undefined);
  await fs.writeFile("/limited/file", bytes);
  await fs.writeFile("/file", bytes);
  await fs.symlink("file", "/alias");
  assert.deepEqual(await fs.readFile("/alias"), bytes);
  await fs.chmod("/file", 0o600);
  for (const operation of [
    () => fs.symlink("file", "/limited/alias"),
    () => fs.link("/limited/file", "/limited/alias"),
    () => fs.chmod("/limited/file", 0),
    () => fs.utimes("/limited/file", 1, 2),
    () => fs.truncate("/limited/file"),
    () => collectBytes(fs.readStream("/limited/file"), { maxBytes: 10 }),
    () => fs.writeStream("/limited/file", toByteSource(bytes)),
  ]) await assert.rejects(operation(), errno("ENOTSUP"));
  assert.deepEqual(await fs.readFile("/limited/file"), bytes);
});

test("missing readlink fails closed on preexisting symlinks", async () => {
  const disk = createMemoryFileSystem();
  await disk.writeFile("/target", bytes);
  await disk.symlink("/target", "/alias");
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/disk": backend({ readlink: undefined }, disk) } });
  assert.equal(fs.capabilities.symlinks, false);
  await assert.rejects(fs.readFile("/disk/alias"), errno("ENOTSUP"));
  await assert.rejects(fs.readlink("/disk/alias"), errno("ENOTSUP"));
  assert.equal((await fs.lstat("/disk/alias")).type, "symlink");
  await fs.rm("/disk/alias");
  assert.deepEqual(await disk.readFile("/target"), bytes);
});

test("explicit false capabilities are enforced even when optional methods exist", async () => {
  let calls = 0;
  const fs = createMountFileSystem({ root: backend({
    capabilities: { symlinks: false, streamingWrite: false },
    symlink: async () => { calls++; },
    writeStream: async () => { calls++; },
  }) });
  await assert.rejects(fs.symlink("target", "/alias"), errno("ENOTSUP"));
  await assert.rejects(fs.writeStream("/file", toByteSource(bytes)), errno("ENOTSUP"));
  assert.equal(calls, 0);
});

test("read-only mounted backend cannot be mutated through the wrapper", async () => {
  const disk = createMemoryFileSystem();
  await disk.writeFile("/file", bytes);
  const readOnly = backend({ capabilities: { ...disk.capabilities, readOnly: true } }, disk);
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/disk": readOnly } });
  assert.equal(fs.capabilities.readOnly, false);
  assert.equal(createMountFileSystem({ root: readOnly }).capabilities.readOnly, true);
  await assert.rejects(fs.writeFile("/disk/file", encode("mutated")), errno("EROFS"));
  await assert.rejects(fs.rm("/disk/file"), errno("EROFS"));
  assert.deepEqual(await fs.readFile("/disk/file"), bytes);
});

const cancellableOperations: Record<string, (fs: MountFileSystem, options: FsOptions) => Promise<unknown>> = {
  readFile: (fs, options) => fs.readFile("/disk/file", options),
  writeFile: (fs, options) => fs.writeFile("/disk/file", bytes, options),
  appendFile: (fs, options) => fs.appendFile("/disk/file", bytes, options),
  stat: (fs, options) => fs.stat("/disk/file", options),
  lstat: (fs, options) => fs.lstat("/disk/file", options),
  readdir: (fs, options) => fs.readdir("/disk", options),
  mkdir: (fs, options) => fs.mkdir("/disk/new", { ...options, recursive: true }),
  rm: (fs, options) => fs.rm("/disk/file", options),
  rename: (fs, options) => fs.rename("/disk/file", "/disk/renamed", options),
  copyFile: (fs, options) => fs.copyFile("/disk/file", "/disk/copy", options),
  realpath: (fs, options) => fs.realpath("/disk/file", options),
  access: (fs, options) => fs.access("/disk/file", 0, options),
  readlink: (fs, options) => fs.readlink("/disk/link", options),
  symlink: (fs, options) => fs.symlink("file", "/disk/new-link", options),
  link: (fs, options) => fs.link("/disk/file", "/disk/hardlink", options),
  chmod: (fs, options) => fs.chmod("/disk/file", 0, options),
  utimes: (fs, options) => fs.utimes("/disk/file", 1, 2, options),
  truncate: (fs, options) => fs.truncate("/disk/file", 0, options),
  readStream: (fs, options) => collectBytes(fs.readStream("/disk/file", options), { maxBytes: 10 }),
  writeStream: (fs, options) => fs.writeStream("/disk/file", toByteSource(bytes), options),
};

for (const [method, operation] of Object.entries(cancellableOperations)) {
  test(`pre-aborted ${method} preserves abort identity without backend work`, async () => {
    let calls = 0;
    const root = backend({ lstat: async () => { calls++; throw new Error("must not inspect backend"); } });
    const fs = createMountFileSystem({ root, mounts: { "/disk": createMemoryFileSystem() } });
    const signal = AbortSignal.abort(new Error("cancelled"));
    await assert.rejects(operation(fs, { signal }), (error: unknown) => error === signal.reason);
    assert.equal(calls, 0);
  });
}

test("resolution and streaming operations forward signals, ranges, flags and sources", async () => {
  const disk = createMemoryFileSystem();
  await disk.writeFile("/file", bytes);
  const controller = new AbortController();
  const observed: FsOptions[] = [];
  let readOptions: ReadStreamOptions | undefined;
  let writeOptions: WriteFileOptions | undefined;
  const source = toByteSource(bytes);
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/disk": backend({
    async lstat(path, options) { observed.push(options!); return disk.lstat(path, options); },
    async access(path, mode, options) { observed.push(options!); await disk.access(path, mode, options); },
    readStream(path, options) { readOptions = options; return disk.readStream(path, options); },
    async writeStream(path, input, options) {
      assert.equal(input, source);
      writeOptions = options;
      await disk.writeStream(path, input, options);
    },
  }, disk) } });
  const read: ReadStreamOptions = { signal: controller.signal, start: 1, endExclusive: 4, chunkSize: 2 };
  assert.deepEqual(await collectBytes(fs.readStream("/disk/file", read), { maxBytes: 3 }), bytes.slice(1, 4));
  assert.equal(readOptions, read);
  const write: WriteFileOptions = { signal: controller.signal, flag: "wx", mode: 0o600 };
  await fs.writeStream("/disk/new", source, write);
  assert.equal(writeOptions, write);
  assert.ok(observed.length > 0);
  assert.ok(observed.every((options) => options.signal === controller.signal));
});

test("read streams remain lazy and close their backend iterator on consumer return", async () => {
  const disk = createMemoryFileSystem();
  await disk.writeFile("/file", bytes);
  let started = 0;
  let closed = 0;
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/disk": backend({
    async *readStream() {
      started++;
      try { yield bytes; yield bytes; } finally { closed++; }
    },
  }, disk) } });
  const stream = fs.readStream("/disk/file");
  assert.equal(started, 0);
  for await (const chunk of stream) { assert.deepEqual(chunk, bytes); break; }
  assert.equal(started, 1);
  assert.equal(closed, 1);
});

test("midstream cancellation closes backend readers and preserves the signal reason", async () => {
  const disk = createMemoryFileSystem();
  await disk.writeFile("/file", bytes);
  const controller = new AbortController();
  let closed = false;
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/disk": backend({
    async *readStream() {
      try { yield bytes; controller.abort(new Error("stop")); yield bytes; } finally { closed = true; }
    },
  }, disk) } });
  await assert.rejects(collectBytes(fs.readStream("/disk/file", { signal: controller.signal }), { maxBytes: 20 }), (error: unknown) => error === controller.signal.reason);
  assert.equal(closed, true);
});

test("streaming errors retain partial write behavior and global metadata", async () => {
  const { fs, disk } = fixture();
  let closed = false;
  const source = (async function* () {
    try { yield bytes; throw new Error("producer failed"); } finally { closed = true; }
  })();
  await assert.rejects(fs.writeStream("/disk/partial", source), errno("EIO", "/disk/partial", undefined, "writeStream"));
  assert.equal(closed, true);
  assert.deepEqual(await disk.readFile("/partial"), bytes);
  const badReader = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/disk": backend({
    async *readStream() { yield bytes; throw new FsError("EIO", { path: "/partial" }); },
  }, disk) } });
  await assert.rejects(collectBytes(badReader.readStream("/disk/partial"), { maxBytes: 20 }), errno("EIO", "/disk/partial", undefined, "readStream"));
});

test("unsupported streaming write rejects before consuming or modifying anything", async () => {
  const disk = createMemoryFileSystem();
  await disk.writeFile("/file", bytes);
  let consumed = false;
  const source = (async function* () { consumed = true; yield encode("changed"); })();
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/disk": backend({ writeStream: undefined }, disk) } });
  await assert.rejects(fs.writeStream("/disk/file", source), errno("ENOTSUP"));
  assert.equal(consumed, false);
  assert.deepEqual(await disk.readFile("/file"), bytes);
});

test("malformed directory names from a backend cannot forge global namespace entries", async () => {
  for (const name of ["", ".", "..", "../escape", "a/b", "bad\0"]) {
    const fs = createMountFileSystem({ root: backend({ readdir: async () => [{ name, type: "file" }] }) });
    await assert.rejects(fs.readdir("/"), errno("EIO", "/", undefined, "readdir"));
  }
});

test("copyFile cannot read a hidden file beneath a synthetic mount ancestor", async () => {
  const root = createMemoryFileSystem();
  await root.writeFile("/hidden", encode("private"));
  const fs = createMountFileSystem({ root, mounts: { "/hidden/nested/store": createMemoryFileSystem() } });
  await assert.rejects(fs.copyFile("/hidden", "/leaked"), errno("EISDIR", "/hidden", "/leaked", "copyFile"));
  await assert.rejects(root.stat("/leaked"), errno("ENOENT"));
  assert.equal(decode(await root.readFile("/hidden")), "private");
});

test("ordinary native-style ENOENT errors still produce synthetic parents", async () => {
  const base = createMemoryFileSystem();
  const root = backend({
    async lstat(path, options) {
      try { return await base.lstat(path, options); } catch {
        throw Object.assign(new Error("missing"), { code: "ENOENT", path });
      }
    },
  }, base);
  const fs = createMountFileSystem({ root, mounts: { "/parent/child": createMemoryFileSystem() } });
  assert.equal((await fs.stat("/parent")).type, "directory");
  assert.deepEqual(await fs.readdir("/parent"), [{ name: "child", type: "directory" }]);
});

test("cancellation during metadata resolution prevents the next backend operation", async () => {
  const disk = createMemoryFileSystem();
  await disk.writeFile("/file", bytes);
  const controller = new AbortController();
  let writes = 0;
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/disk": backend({
    async access(path, mode, options) {
      await disk.access(path, mode, options);
      controller.abort(new Error("cancel during resolution"));
    },
    async writeFile() { writes++; },
  }, disk) } });
  await assert.rejects(fs.writeFile("/disk/file", bytes, { signal: controller.signal }), (error: unknown) => error === controller.signal.reason);
  assert.equal(writes, 0);
});

test("backend metadata cannot complete successfully after aborting its supplied signal", async () => {
  const controller = new AbortController();
  const base = createMemoryFileSystem();
  const fs = createMountFileSystem({ root: backend({
    async lstat(path, options) {
      const stat = await base.lstat(path, options);
      controller.abort(new Error("late abort"));
      return stat;
    },
  }, base) });
  await assert.rejects(fs.stat("/", { signal: controller.signal }), (error: unknown) => error === controller.signal.reason);
});

test("all path dispatchers reject intermediate escape links before touching another backend", async () => {
  const { root, disk } = fixture();
  const sibling = createMemoryFileSystem();
  await disk.symlink("/../sibling", "/escape");
  await disk.writeFile("/source", bytes);
  await sibling.writeFile("/victim", bytes);
  const fs = createMountFileSystem({ root, mounts: { "/disk": disk, "/sibling": sibling } });
  const path = "/disk/escape/victim";
  for (const operation of [
    () => fs.readFile(path), () => fs.writeFile(path, bytes), () => fs.appendFile(path, bytes),
    () => fs.stat(path), () => fs.lstat(path), () => fs.readdir(path),
    () => fs.mkdir(path), () => fs.mkdir(path, { recursive: true }), () => fs.rm(path, { recursive: true }),
    () => fs.rename(path, "/disk/new"), () => fs.rename("/disk/source", path),
    () => fs.copyFile(path, "/disk/new"), () => fs.copyFile("/disk/source", path),
    () => fs.realpath(path), () => fs.access(path), () => fs.readlink(path),
    () => fs.symlink("target", path), () => fs.link(path, "/disk/new"), () => fs.link("/disk/source", path),
    () => fs.chmod(path, 0), () => fs.utimes(path, 1, 2), () => fs.truncate(path),
    () => collectBytes(fs.readStream(path), { maxBytes: 10 }), () => fs.writeStream(path, toByteSource(bytes)),
  ]) await assert.rejects(operation(), errno("EACCES"));
  assert.deepEqual(await sibling.readFile("/victim"), bytes);
  assert.deepEqual(await disk.readFile("/source"), bytes);
  await assert.rejects(disk.stat("/new"), errno("ENOENT"));
});

test("permissions on traversed backing directories cannot be bypassed by dotdot or mounts", async () => {
  const root = createMemoryFileSystem();
  await root.mkdir("/private", { mode: 0o600 });
  const fs = createMountFileSystem({ root, mounts: { "/private/store": createMemoryFileSystem() } });
  await assert.rejects(fs.stat("/private/store"), errno("EACCES"));
  await assert.rejects(fs.stat("/private/.."), errno("EACCES"));
  assert.equal((await fs.stat("/private")).type, "directory");
});

test("recursive mkdir denies unverifiable missing symlink suffixes before materialization", async () => {
  const { fs, disk } = fixture();
  await disk.mkdir("/actual/deep", { recursive: true });
  await disk.symlink("/actual/deep", "/alias");
  await assert.rejects(fs.mkdir("/disk/alias/../new/child/", { recursive: true, mode: 0o750 }), errno("ENOENT"));
  await assert.rejects(disk.stat("/actual/new"), errno("ENOENT"));
  await fs.mkdir("/disk/actual/new/child", { recursive: true, mode: 0o750 });
  await fs.mkdir("/disk/alias/../new/child/", { recursive: true, mode: 0o750 });
  assert.equal((await disk.stat("/actual/new/child")).mode & 0o777, 0o750);
  await assert.rejects(disk.stat("/new"), errno("ENOENT"));
});

test("same-backend hardlinked symlink targets are resolved at their new parent", async () => {
  const { fs, disk } = fixture();
  await disk.mkdir("/one");
  await disk.mkdir("/two");
  await disk.writeFile("/one/target", encode("one"));
  await disk.writeFile("/two/target", encode("two"));
  await fs.symlink("target", "/disk/one/link");
  await fs.link("/disk/one/link", "/disk/two/link");
  assert.equal((await fs.lstat("/disk/two/link")).type, "symlink");
  assert.equal(decode(await fs.readFile("/disk/two/link")), "two");
});

test("nested filesystem wrappers compose as backends without losing mount-local absolute targets", async () => {
  const innerRoot = createMemoryFileSystem();
  const innerDisk = createMemoryFileSystem();
  const inner = createMountFileSystem({ root: innerRoot, mounts: { "/inner": innerDisk } });
  const outer = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/outer": inner } });
  await outer.writeFile("/outer/inner/file", bytes);
  assert.deepEqual(await innerDisk.readFile("/file"), bytes);
  assert.deepEqual(await outer.readdir("/outer"), [{ name: "inner", type: "directory" }]);
  await outer.symlink("/file", "/outer/inner/alias");
  assert.deepEqual(await outer.readFile("/outer/inner/alias"), bytes);
  assert.equal(await outer.realpath("/outer/inner/alias"), "/outer/inner/file");
  await assert.rejects(outer.rename("/outer/inner/file", "/outer/file"), errno("EXDEV"));
  await outer.symlink("..", "/outer/inner/escape");
  await assert.rejects(outer.stat("/outer/inner/escape"), errno("EACCES"));
  await assert.rejects(outer.rm("/outer/inner", { recursive: true }), errno("EBUSY"));
  const rootWrapper = createMountFileSystem({ root: inner });
  assert.deepEqual(await rootWrapper.readFile("/inner/alias"), bytes);
  assert.throws(() => createMountFileSystem({ root: inner, mounts: { "/inner": createMemoryFileSystem() } }), errno("EINVAL"));
  const aliases = createMountFileSystem({ root: inner, mounts: { "/alias": innerDisk } });
  assert.deepEqual(await aliases.stat("/inner/file"), await aliases.stat("/alias/file"));
  await assert.rejects(aliases.copyFile("/inner/file", "/alias/file"), errno("EINVAL"));
  assert.deepEqual(await innerDisk.readFile("/file"), bytes);
});

test("cross-device errors remain EXDEV even when a backend is read-only", async () => {
  const root = createMemoryFileSystem();
  const disk = createMemoryFileSystem();
  await root.writeFile("/source", bytes);
  await disk.writeFile("/source", bytes);
  const fs = createMountFileSystem({ root, mounts: { "/disk": backend({ capabilities: { readOnly: true } }, disk) } });
  for (const method of ["rename", "link"] as const) {
    await assert.rejects(fs[method]("/source", "/disk/new"), errno("EXDEV"));
    await assert.rejects(fs[method]("/disk/source", "/new"), errno("EXDEV"));
  }
  assert.deepEqual(await root.readFile("/source"), bytes);
  assert.deepEqual(await disk.readFile("/source"), bytes);
  await assert.rejects(fs.copyFile("/source", "/disk/new"), errno("EROFS"));
  await fs.copyFile("/disk/source", "/new");
  assert.deepEqual(await root.readFile("/new"), bytes);
});

test("same-device backend rename failure preserves source and remaps both error paths", async () => {
  const disk = createMemoryFileSystem();
  await disk.writeFile("/source", bytes);
  const failure = new FsError("EACCES", { path: "/source", dest: "/destination", syscall: "native-rename" });
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/disk": backend({
    rename: async () => { throw failure; },
  }, disk) } });
  await assert.rejects(fs.rename("/disk/source", "disk/destination"), errno("EACCES", "/disk/source", "/disk/destination", "rename"));
  assert.deepEqual(await disk.readFile("/source"), bytes);
  await assert.rejects(disk.stat("/destination"), errno("ENOENT"));
});

test("many sibling and nested mounts retain routing and listing consistency under concurrent work", async () => {
  const mounts: Record<string, FileSystem> = {};
  for (let index = 0; index < 32; index++) {
    mounts[`/store${index}`] = createMemoryFileSystem();
    mounts[`/store${index}/nested/deep`] = createMemoryFileSystem();
  }
  const root = createMemoryFileSystem();
  const fs = createMountFileSystem({ root, mounts });
  await Promise.all(Object.entries(mounts).map(async ([path, disk], index) => {
    const content = encode(`${index}:${path}`);
    await fs.writeFile(`${path}/value`, content);
    await fs.rename(`${path}/value`, `${path}/renamed`);
    await fs.copyFile(`${path}/renamed`, `${path}/copied`);
    assert.deepEqual(await disk.readFile("/renamed"), content);
    assert.deepEqual(await fs.readFile(`${path}/copied`), content);
    await fs.rm(`${path}/copied`);
    for (const entry of await fs.readdir(path)) assert.equal((await fs.lstat(`${path}/${entry.name}`)).type, entry.type);
  }));
  assert.equal((await fs.readdir("/")).length, 32);
  assert.deepEqual(await root.readdir("/"), []);
});
