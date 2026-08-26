import assert from "node:assert/strict";
import test from "node:test";
import { FsError, isFsError } from "../../../src/contracts/errors.js";
import type { ErrnoCode } from "../../../src/contracts/errors.js";
import type { ReadStreamOptions, WriteFileOptions } from "../../../src/contracts/filesystem.js";
import { collectBytes, toByteSource } from "../../../src/contracts/io.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const text = (data: Uint8Array): string => new TextDecoder().decode(data);
const rejects = async (action: Promise<unknown>, code: ErrnoCode): Promise<void> => {
  await assert.rejects(action, (error: unknown) => isFsError(error, code));
};

test("relative paths, duplicate separators, dot components, and root-clamped parents", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir("//a///b/", { recursive: true });
  await filesystem.writeFile("a/b/./../file", bytes("value"));
  assert.equal(text(await filesystem.readFile("/../../a//file")), "value");
  assert.equal(await filesystem.realpath("a/b/.."), "/a");
  assert.equal(await filesystem.realpath("../../.."), "/");
  await filesystem.mkdir("/trailing/");
  assert.equal((await filesystem.stat("/trailing/")).type, "directory");
  assert.equal((await filesystem.stat(".")).type, "directory");
});

test("non-directory and missing components are not lexically erased by dot-dot", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/file", bytes("safe"));
  for (const path of ["/file/child", "/file/..", "/file/.", "/file/", "/file//"]) {
    await rejects(filesystem.stat(path), "ENOTDIR");
    await rejects(filesystem.writeFile(path, bytes("bad")), "ENOTDIR");
  }
  await rejects(filesystem.stat("/missing/../file"), "ENOENT");
  assert.equal(text(await filesystem.readFile("/file")), "safe");
});

test("symlink expansion happens before parent traversal", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir("/outside/deep", { recursive: true });
  await filesystem.mkdir("/inside");
  await filesystem.writeFile("/outside/file", bytes("outside"));
  await filesystem.writeFile("/inside/file", bytes("inside"));
  await filesystem.symlink("/outside/deep", "/inside/link");
  assert.equal(text(await filesystem.readFile("/inside/link/../file")), "outside");
  assert.equal(await filesystem.realpath("/inside/link/.."), "/outside");
  await filesystem.writeFile("/inside/link/../new", bytes("new"));
  assert.equal(text(await filesystem.readFile("/outside/new")), "new");
});

test("relative links resolve from their containing directory, including moved directories", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir("/one/deep", { recursive: true });
  await filesystem.writeFile("/one/target", bytes("value"));
  await filesystem.symlink("../target", "/one/deep/link");
  assert.equal(await filesystem.realpath("/one/deep/link"), "/one/target");
  await filesystem.rename("/one", "/two");
  assert.equal(await filesystem.realpath("/two/deep/link"), "/two/target");
});

test("dangling links are observable, exclusive writes refuse them, ordinary writes create targets", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.symlink("target", "/link");
  await rejects(filesystem.stat("/link"), "ENOENT");
  assert.equal((await filesystem.lstat("/link")).type, "symlink");
  await rejects(filesystem.writeFile("/link", bytes("bad"), { flag: "wx" }), "EEXIST");
  await rejects(filesystem.writeFile("/link", bytes("bad"), { flag: "ax" }), "EEXIST");
  await filesystem.appendFile("/link", bytes("created"));
  assert.equal(text(await filesystem.readFile("/target")), "created");
  await filesystem.rm("/target");
  await filesystem.rm("/link");
  assert.deepEqual(await filesystem.readdir("/"), []);
});

test("self loops, mutual loops, and intermediate loops report ELOOP", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.symlink("self", "/self");
  await filesystem.symlink("second", "/first");
  await filesystem.symlink("first", "/second");
  for (const path of ["/self", "/first", "/second", "/self/child"]) {
    await rejects(filesystem.stat(path), "ELOOP");
    await rejects(filesystem.readFile(path), "ELOOP");
    await rejects(filesystem.realpath(path), "ELOOP");
  }
  assert.equal(await filesystem.readlink("/self"), "self");
  assert.equal((await filesystem.lstat("/self")).type, "symlink");
  await filesystem.rm("/self");
});

test("exactly 40 symlink traversals succeed while 41 fail", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/target", bytes("value"));
  let previous = "/target";
  for (let index = 0; index < 41; index++) {
    const path = `/link-${index}`;
    await filesystem.symlink(previous, path);
    previous = path;
  }
  assert.equal(text(await filesystem.readFile("/link-39")), "value");
  await rejects(filesystem.readFile("/link-40"), "ELOOP");
});

test("directory symlinks retain entry types but support traversals and trailing slash stats", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir("/actual");
  await filesystem.symlink("actual", "/link");
  await filesystem.writeFile("/link/file", bytes("value"));
  assert.equal(await filesystem.realpath("/link/file"), "/actual/file");
  assert.equal((await filesystem.lstat("/link/")).type, "directory");
  assert.deepEqual(await filesystem.readdir("/"), [
    { name: "actual", type: "directory" }, { name: "link", type: "symlink" },
  ]);
  await filesystem.rm("/link", { recursive: true });
  assert.equal(text(await filesystem.readFile("/actual/file")), "value");
});

test("copy follows links but exclusive copy never replaces a dangling link", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/source", bytes("value"));
  await filesystem.symlink("source", "/source-link");
  await filesystem.symlink("destination", "/destination-link");
  await rejects(filesystem.copyFile("/source-link", "/destination-link", { exclusive: true }), "EEXIST");
  await filesystem.copyFile("/source-link", "/destination-link");
  assert.equal(text(await filesystem.readFile("/destination")), "value");
  assert.equal((await filesystem.lstat("/destination-link")).type, "symlink");
  await rejects(filesystem.copyFile("/source-link", "/source"), "EINVAL");
});

test("renaming symlinks moves the link and replacing one does not touch its target", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/target", bytes("safe"));
  await filesystem.symlink("target", "/link");
  await filesystem.rename("/link", "/moved");
  assert.equal(await filesystem.readlink("/moved"), "target");
  await filesystem.writeFile("/replacement", bytes("new"));
  await filesystem.rename("/replacement", "/moved");
  assert.equal(text(await filesystem.readFile("/moved")), "new");
  assert.equal(text(await filesystem.readFile("/target")), "safe");
});

test("rename rejects descendant destinations even through aliases and leaves state unchanged", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir("/source/child", { recursive: true });
  await filesystem.symlink("/source/child", "/alias");
  for (const destination of ["/source/child/new", "/alias/new"]) {
    await rejects(filesystem.rename("/source", destination), "EINVAL");
    assert.equal((await filesystem.stat("/source/child")).type, "directory");
    await rejects(filesystem.stat(destination), "ENOENT");
  }
});

test("rename type mismatches and nonempty destinations preserve both operands", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir("/directory");
  await filesystem.mkdir("/nonempty/child", { recursive: true });
  await filesystem.writeFile("/file", bytes("value"));
  await rejects(filesystem.rename("/directory", "/file"), "ENOTDIR");
  await rejects(filesystem.rename("/file", "/directory"), "EISDIR");
  await rejects(filesystem.rename("/directory", "/nonempty"), "ENOTEMPTY");
  await rejects(filesystem.rename("/file", "/missing/new"), "ENOENT");
  assert.equal(text(await filesystem.readFile("/file")), "value");
  assert.equal((await filesystem.stat("/directory")).type, "directory");
  await filesystem.rename("/nonempty", "/directory");
  assert.equal((await filesystem.stat("/directory/child")).type, "directory");
});

test("root aliases cannot be removed or renamed", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir("/child");
  for (const path of ["/", "//", "/..", ".", "/child/.."]) {
    const code = path.includes(".") ? "EINVAL" : "EBUSY";
    await rejects(filesystem.rm(path, { recursive: true, force: true }), code);
    await rejects(filesystem.rename(path, "/other"), code);
    await rejects(filesystem.rename("/child", path), code);
  }
  assert.equal((await filesystem.stat("/child")).type, "directory");
});

test("POSIX filenames keep Unicode, backslashes, shell characters, and prototype-like names literal", async () => {
  const filesystem = new MemoryFileSystem();
  const names = ["__proto__", "constructor", "a\\b", " space ", "雪", "$(echo ignored)", "*", "-rf", "a\nb"];
  for (const name of names) await filesystem.writeFile(`/${name}`, bytes(name));
  for (const name of names) assert.equal(text(await filesystem.readFile(`/${name}`)), name);
  assert.equal((await filesystem.readdir("/")).length, names.length);
});

test("invalid paths and overlong UTF-8 names fail without side effects", async () => {
  const filesystem = new MemoryFileSystem();
  for (const path of ["/bad\0name", "\0"]) {
    await rejects(filesystem.writeFile(path, bytes("bad")), "EINVAL");
    await rejects(filesystem.mkdir(path, { recursive: true }), "EINVAL");
    await rejects(filesystem.rm(path, { force: true }), "EINVAL");
  }
  await rejects(filesystem.stat(""), "ENOENT");
  await rejects(filesystem.writeFile(`/${"雪".repeat(86)}`, bytes("bad")), "ENAMETOOLONG");
  await filesystem.writeFile(`/${"a".repeat(255)}`, bytes("valid"));
  assert.equal((await filesystem.readdir("/")).length, 1);
});

test("readFile returns byte snapshots and readdir/stat return detached metadata", async () => {
  const filesystem = new MemoryFileSystem();
  const backing = Uint8Array.of(99, 1, 2, 99);
  await filesystem.writeFile("/file", backing.subarray(1, 3));
  backing.fill(0);
  assert.deepEqual(await filesystem.readFile("/file"), Uint8Array.of(1, 2));
  const stat = await filesystem.stat("/file");
  Object.assign(stat, { size: 99, mode: 0 });
  const entries = await filesystem.readdir("/");
  Object.assign(entries[0]!, { name: "mutated" });
  assert.equal((await filesystem.stat("/file")).size, 2);
  assert.deepEqual(await filesystem.readdir("/"), [{ name: "file", type: "file" }]);
});

test("file modes enforce owner access without host identity or umask", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/file", bytes("value"), { mode: 0o600 });
  await filesystem.chmod("/file", 0o200);
  await rejects(filesystem.readFile("/file"), "EACCES");
  await filesystem.writeFile("/file", bytes("next"));
  await filesystem.chmod("/file", 0o400);
  await rejects(filesystem.writeFile("/file", bytes("bad")), "EACCES");
  await rejects(filesystem.appendFile("/file", bytes("bad")), "EACCES");
  await rejects(filesystem.truncate("/file"), "EACCES");
  await filesystem.access("/file", 0);
  assert.equal(text(await filesystem.readFile("/file")), "next");
});

test("directory permissions distinguish traversal, listing, and parent mutations", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir("/directory");
  await filesystem.writeFile("/directory/file", bytes("value"));
  await filesystem.chmod("/directory", 0o400);
  assert.equal((await filesystem.readdir("/directory")).length, 1);
  await rejects(filesystem.stat("/directory/file"), "EACCES");
  await filesystem.chmod("/directory", 0o100);
  await rejects(filesystem.readdir("/directory"), "EACCES");
  assert.equal((await filesystem.stat("/directory/file")).type, "file");
  await rejects(filesystem.writeFile("/directory/new", bytes("bad")), "EACCES");
  await rejects(filesystem.rm("/directory/file"), "EACCES");
  await rejects(filesystem.rename("/directory/file", "/moved"), "EACCES");
  await filesystem.chmod("/directory", 0o700);
  assert.equal(text(await filesystem.readFile("/directory/file")), "value");
});

test("failed recursive removal is atomic and does not follow symlinks", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir("/tree/protected", { recursive: true });
  await filesystem.writeFile("/tree/protected/file", bytes("safe"));
  await filesystem.writeFile("/tree/first", bytes("first"));
  await filesystem.writeFile("/external", bytes("external"));
  await filesystem.symlink("/external", "/tree/link");
  await filesystem.chmod("/tree/protected", 0o500);
  await rejects(filesystem.rm("/tree", { recursive: true }), "EACCES");
  assert.equal(text(await filesystem.readFile("/tree/first")), "first");
  await filesystem.chmod("/tree/protected", 0o700);
  await filesystem.rm("/tree", { recursive: true });
  assert.equal(text(await filesystem.readFile("/external")), "external");
});

test("hardlink metadata follows overwrite, rename, chmod, truncate, and recursive unlink", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir("/tree");
  await filesystem.writeFile("/tree/file", bytes("value"));
  await filesystem.link("/tree/file", "/outside");
  await filesystem.link("/outside", "/tree/alias");
  await filesystem.rename("/outside", "/tree/file");
  assert.equal((await filesystem.stat("/outside")).nlink, 3);
  await filesystem.truncate("/outside", 2);
  assert.equal(text(await filesystem.readFile("/tree/alias")), "va");
  await filesystem.chmod("/outside", 0o640);
  assert.equal((await filesystem.stat("/tree/file")).mode & 0o777, 0o640);
  await filesystem.rm("/tree", { recursive: true });
  assert.equal((await filesystem.stat("/outside")).nlink, 1);
  await rejects(filesystem.link("/", "/bad"), "EPERM");
  await rejects(filesystem.link("/outside", "/outside"), "EEXIST");
});

test("hardlinking a symlink preserves link identity and relative target context", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir("/one");
  await filesystem.mkdir("/two");
  await filesystem.writeFile("/one/file", bytes("one"));
  await filesystem.writeFile("/two/file", bytes("two"));
  await filesystem.symlink("file", "/one/link");
  await filesystem.link("/one/link", "/two/link");
  assert.equal((await filesystem.lstat("/one/link")).ino, (await filesystem.lstat("/two/link")).ino);
  assert.equal(text(await filesystem.readFile("/two/link")), "two");
  assert.equal(text(await filesystem.readFile("/one/link")), "one");
});

test("rename replacement decrements displaced hardlink counts", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/target", bytes("old"));
  await filesystem.link("/target", "/alias");
  await filesystem.writeFile("/new", bytes("new"));
  await filesystem.rename("/new", "/target");
  assert.equal((await filesystem.stat("/alias")).nlink, 1);
  assert.equal(text(await filesystem.readFile("/alias")), "old");
  assert.equal(text(await filesystem.readFile("/target")), "new");
});

test("timestamps preserve birthtime and explicit values until the relevant operation", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/file", bytes("value"));
  const initial = await filesystem.stat("/file");
  await filesystem.utimes("/file", -123.5, 456.25);
  const explicit = await filesystem.stat("/file");
  assert.equal(explicit.atimeMs, -123.5);
  assert.equal(explicit.mtimeMs, 456.25);
  await filesystem.readFile("/file");
  assert.equal((await filesystem.stat("/file")).mtimeMs, 456.25);
  assert.ok((await filesystem.stat("/file")).atimeMs > 0);
  await filesystem.appendFile("/file", bytes("!"));
  const final = await filesystem.stat("/file");
  assert.ok(final.mtimeMs > 456.25);
  assert.equal(final.birthtimeMs, initial.birthtimeMs);
  assert.equal(final.ino, initial.ino);
});

test("directory link counts reflect child directory moves", async () => {
  const filesystem = new MemoryFileSystem();
  assert.equal((await filesystem.stat("/")).nlink, 2);
  await filesystem.mkdir("/one/child", { recursive: true });
  await filesystem.mkdir("/two");
  assert.equal((await filesystem.stat("/")).nlink, 4);
  assert.equal((await filesystem.stat("/one")).nlink, 3);
  await filesystem.rename("/one/child", "/two/child");
  assert.equal((await filesystem.stat("/one")).nlink, 2);
  assert.equal((await filesystem.stat("/two")).nlink, 3);
});

test("invalid numeric options fail with EINVAL and preserve content", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/file", bytes("safe"));
  for (const value of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await rejects(filesystem.truncate("/file", value), "EINVAL");
    await rejects(filesystem.readFile("/file", { maxBytes: value }), "EINVAL");
    await rejects(filesystem.chmod("/file", value), "EINVAL");
    await rejects(filesystem.access("/file", value), "EINVAL");
    await rejects(filesystem.writeFile("/file", bytes("bad"), { mode: value }), "EINVAL");
  }
  await rejects(filesystem.utimes("/file", NaN, 0), "EINVAL");
  await rejects(filesystem.utimes("/file", 0, Infinity), "EINVAL");
  await rejects(filesystem.writeFile("/file", bytes("bad"), { flag: "r" } as unknown as WriteFileOptions), "EINVAL");
  assert.equal(text(await filesystem.readFile("/file")), "safe");
});

test("errno errors include Node-like codes, negative errno, syscall, source and destination", async () => {
  const filesystem = new MemoryFileSystem();
  await assert.rejects(filesystem.readFile("/absent"), (error: unknown) => {
    assert.ok(error instanceof FsError);
    assert.equal(error.code, "ENOENT");
    assert.equal(error.path, "/absent");
    assert.equal(error.syscall, "readFile");
    assert.ok(error.errno < 0);
    return true;
  });
  for (const operation of ["rename", "copyFile"] as const) {
    await assert.rejects(filesystem[operation]("/source", "/destination"), (error: unknown) => {
      assert.ok(error instanceof FsError);
      assert.equal(error.path, "/source");
      assert.equal(error.dest, "/destination");
      assert.equal(error.syscall, operation);
      return true;
    });
  }
});

test("parallel appends and exclusive creators are linearizable", async () => {
  const filesystem = new MemoryFileSystem();
  const results = await Promise.allSettled(Array.from({ length: 100 }, () => filesystem.writeFile("/exclusive", bytes("value"), { flag: "wx" })));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  for (const result of results) if (result.status === "rejected") assert.ok(isFsError(result.reason, "EEXIST"));
  await Promise.all(Array.from({ length: 100 }, (_, index) => filesystem.appendFile("/append", Uint8Array.of(index))));
  assert.deepEqual(await filesystem.readFile("/append"), Uint8Array.from({ length: 100 }, (_, index) => index));
});

test("seeded mutation sequences match an independent byte-array model", async () => {
  const filesystem = new MemoryFileSystem();
  const model = new Map<string, number[]>();
  let seed = 0x12345678;
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let iteration = 0; iteration < 1000; iteration++) {
    const path = `/file-${random() % 17}`;
    const operation = random() % 6;
    const payload = Array.from({ length: random() % 12 }, () => random() % 256);
    if (operation === 0) {
      await filesystem.writeFile(path, Uint8Array.from(payload));
      model.set(path, payload);
    } else if (operation === 1) {
      await filesystem.appendFile(path, Uint8Array.from(payload));
      model.set(path, [...(model.get(path) ?? []), ...payload]);
    } else if (operation === 2 && model.has(path)) {
      const length = random() % 20;
      await filesystem.truncate(path, length);
      const previous = model.get(path)!;
      model.set(path, Array.from({ length }, (_, index) => previous[index] ?? 0));
    } else if (operation === 3 && model.has(path)) {
      const destination = `/file-${random() % 17}`;
      await filesystem.rename(path, destination);
      const previous = model.get(path)!;
      model.delete(path);
      model.set(destination, previous);
    } else if (operation === 4) {
      await filesystem.rm(path, { force: true });
      model.delete(path);
    } else if (operation === 5 && model.has(path)) {
      const destination = `/copy-${random() % 5}`;
      await filesystem.copyFile(path, destination);
      model.set(destination, [...model.get(path)!]);
    }
    if (iteration % 25 === 0) {
      assert.deepEqual((await filesystem.readdir("/")).map((entry) => `/${entry.name}`).sort(), [...model.keys()].sort());
      for (const [name, expected] of model) assert.deepEqual([...await filesystem.readFile(name)], expected);
    }
  }
});

test("pre-aborted operations never mutate or consume sources", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/file", bytes("safe"));
  const reason = new Error("stop");
  const options = { signal: AbortSignal.abort(reason) };
  let consumed = false;
  const source = (async function* () { consumed = true; yield bytes("bad"); })();
  const operations = [
    () => filesystem.readFile("/file", options),
    () => filesystem.writeFile("/file", bytes("bad"), options),
    () => filesystem.appendFile("/file", bytes("bad"), options),
    () => filesystem.stat("/file", options),
    () => filesystem.lstat("/file", options),
    () => filesystem.readdir("/", options),
    () => filesystem.mkdir("/new", options),
    () => filesystem.rm("/file", options),
    () => filesystem.rename("/file", "/new", options),
    () => filesystem.copyFile("/file", "/new", options),
    () => filesystem.realpath("/file", options),
    () => filesystem.access("/file", 0, options),
    () => filesystem.readlink("/file", options),
    () => filesystem.symlink("file", "/link", options),
    () => filesystem.link("/file", "/link", options),
    () => filesystem.chmod("/file", 0, options),
    () => filesystem.utimes("/file", 0, 0, options),
    () => filesystem.truncate("/file", 0, options),
    () => collectBytes(filesystem.readStream("/file", options), { maxBytes: 100 }),
    () => filesystem.writeStream("/file", source, options),
  ];
  for (const operation of operations) await assert.rejects(operation(), (error: unknown) => error === reason);
  assert.equal(consumed, false);
  assert.equal(text(await filesystem.readFile("/file")), "safe");
  assert.deepEqual((await filesystem.readdir("/")).map((entry) => entry.name), ["file"]);
});

test("read streams use stable snapshots and chunks do not alias storage", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/file", bytes("abcdef"));
  const iterator = filesystem.readStream("/file", { chunkSize: 2 })[Symbol.asyncIterator]();
  const first = await iterator.next();
  assert.equal(text(first.value!), "ab");
  first.value!.fill(0);
  await filesystem.writeFile("/file", bytes("new"));
  assert.equal(text((await iterator.next()).value!), "cd");
  assert.equal(text((await iterator.next()).value!), "ef");
  assert.equal((await iterator.next()).done, true);
  assert.equal(text(await filesystem.readFile("/file")), "new");
});

test("read stream bounds handle empty ranges, EOF, and invalid options", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/file", bytes("abc"));
  for (const options of [{ start: 9 }, { start: 2, endExclusive: 2 }, { endExclusive: 0 }]) {
    assert.equal((await collectBytes(filesystem.readStream("/file", options), { maxBytes: 10 })).length, 0);
  }
  assert.equal(text(await collectBytes(filesystem.readStream("/file", { endExclusive: 100 }), { maxBytes: 10 })), "abc");
  const invalid: ReadStreamOptions[] = [
    { start: -1 }, { start: 0.5 }, { endExclusive: NaN }, { start: 2, endExclusive: 1 },
    { chunkSize: 0 }, { chunkSize: -1 }, { chunkSize: Infinity },
  ];
  for (const options of invalid) await rejects(collectBytes(filesystem.readStream("/file", options), { maxBytes: 10 }), "EINVAL");
});

test("write streams preserve partial writes on source errors and close producers", async () => {
  const filesystem = new MemoryFileSystem();
  let closed = false;
  const failure = new Error("producer failed");
  const source = (async function* () {
    try {
      yield bytes("prefix");
      throw failure;
    } finally { closed = true; }
  })();
  await assert.rejects(filesystem.writeStream("/file", source), (error: unknown) => error === failure);
  assert.equal(closed, true);
  assert.equal(text(await filesystem.readFile("/file")), "prefix");
  await filesystem.writeStream("/file", toByteSource(""));
  assert.equal((await filesystem.stat("/file")).size, 0);
});

test("stream cancellation closes generators and preserves only accepted chunks", async () => {
  const filesystem = new MemoryFileSystem();
  const controller = new AbortController();
  const reason = new Error("stop streaming");
  let closed = false;
  const source = (async function* () {
    try {
      yield bytes("first");
      controller.abort(reason);
      yield bytes("second");
    } finally { closed = true; }
  })();
  await assert.rejects(filesystem.writeStream("/file", source, { signal: controller.signal }), (error: unknown) => error === reason);
  assert.equal(closed, true);
  assert.equal(text(await filesystem.readFile("/file")), "first");
  const readController = new AbortController();
  const iterator = filesystem.readStream("/file", { signal: readController.signal, chunkSize: 1 })[Symbol.asyncIterator]();
  assert.equal(text((await iterator.next()).value!), "f");
  readController.abort(reason);
  await assert.rejects(iterator.next(), (error: unknown) => error === reason);
});

test("write streams target opened inodes rather than resolving paths after every chunk", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/file", bytes("old"));
  const source = (async function* () {
    yield bytes("first");
    await filesystem.rename("/file", "/moved");
    await filesystem.writeFile("/file", bytes("replacement"));
    yield bytes("second");
  })();
  await filesystem.writeStream("/file", source);
  assert.equal(text(await filesystem.readFile("/moved")), "firstsecond");
  assert.equal(text(await filesystem.readFile("/file")), "replacement");
});

test("invalid byte values are rejected before overwrite and while streaming", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/file", bytes("safe"));
  await assert.rejects(filesystem.writeFile("/file", "bad" as unknown as Uint8Array), TypeError);
  assert.equal(text(await filesystem.readFile("/file")), "safe");
  const source = (async function* () { yield "bad" as unknown as Uint8Array; })();
  await assert.rejects(filesystem.writeStream("/stream", source), TypeError);
});

test("destructive operations on slash-suffixed symlinks never mutate their targets", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir("/target/nested", { recursive: true });
  await filesystem.writeFile("/target/nested/file", bytes("safe"));
  await filesystem.symlink("target", "/link");
  await filesystem.mkdir("/source");
  await rejects(filesystem.rm("/link/", { recursive: true }), "ENOTDIR");
  await rejects(filesystem.rename("/link/", "/moved"), "ENOTDIR");
  await rejects(filesystem.rename("/source", "/link/"), "ENOTDIR");
  assert.equal(await filesystem.readlink("/link"), "target");
  assert.equal(text(await filesystem.readFile("/target/nested/file")), "safe");
  assert.equal((await filesystem.stat("/source")).type, "directory");
});

test("terminal dot components do not remove or move their containing directory", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir("/target/nested", { recursive: true });
  await rejects(filesystem.rm("/target/.", { recursive: true }), "EINVAL");
  await rejects(filesystem.rm("/target/nested/..", { recursive: true }), "EINVAL");
  await rejects(filesystem.rename("/target/.", "/moved"), "EINVAL");
  await rejects(filesystem.rename("/target/nested", "/target/."), "EINVAL");
  assert.equal((await filesystem.stat("/target/nested")).type, "directory");
});

test("deep recursive removal uses bounded call-stack space", async () => {
  const filesystem = new MemoryFileSystem();
  const path = `/${Array.from({ length: 12000 }, () => "deep").join("/")}`;
  await filesystem.mkdir(path, { recursive: true });
  await filesystem.writeFile(`${path}/file`, bytes("value"));
  await filesystem.rm("/deep", { recursive: true });
  assert.deepEqual(await filesystem.readdir("/"), []);
});

test("directory rename accepts a new slash-suffixed destination", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir("/source");
  await filesystem.rename("/source/", "/destination/");
  assert.equal((await filesystem.stat("/destination")).type, "directory");
});

test("many-chunk streaming writes preserve byte order and logical size", async () => {
  const filesystem = new MemoryFileSystem();
  const count = 4096;
  const chunkSize = 1024;
  const source = (async function* () {
    const chunk = new Uint8Array(chunkSize);
    for (let index = 0; index < count; index++) {
      chunk.fill(index % 251);
      yield chunk;
    }
    chunk.fill(255);
  })();
  await filesystem.writeStream("/large", source);
  assert.equal((await filesystem.stat("/large")).size, count * chunkSize);
  const content = await filesystem.readFile("/large");
  for (let index = 0; index < count; index++) {
    assert.ok(content.subarray(index * chunkSize, (index + 1) * chunkSize).every((value) => value === index % 251));
  }
});

test("append capacity does not expose unwritten bytes or alter in-flight read snapshots", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.appendFile("/file", bytes("abc"));
  const iterator = filesystem.readStream("/file", { chunkSize: 1 })[Symbol.asyncIterator]();
  assert.equal(text((await iterator.next()).value!), "a");
  await filesystem.appendFile("/file", bytes("def"));
  assert.equal(text((await iterator.next()).value!), "b");
  assert.equal(text((await iterator.next()).value!), "c");
  assert.equal((await iterator.next()).done, true);
  assert.equal(text(await filesystem.readFile("/file")), "abcdef");
  await filesystem.truncate("/file", 2);
  await filesystem.truncate("/file", 6);
  assert.deepEqual(await filesystem.readFile("/file"), Uint8Array.of(97, 98, 0, 0, 0, 0));
});
