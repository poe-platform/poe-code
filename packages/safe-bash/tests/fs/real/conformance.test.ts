import assert from "node:assert/strict";
import * as native from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { ACCESS_MODES, collectBytes, isFsError, toByteSource } from "../../../src/contracts/index.js";
import type { FileSystem } from "../../../src/contracts/index.js";
import { RealFileSystem, createRealFileSystem } from "../../../src/fs/real/index.js";
import { bytes, errno, fixture, text } from "./helpers.js";

test("exports implement the FileSystem contract with an explicitly existing root", async (context) => {
  const { filesystem, root, temporary } = await fixture(context);
  const contract: FileSystem = filesystem;
  assert.equal((await contract.stat("/")).type, "directory");
  assert.ok(filesystem instanceof RealFileSystem);
  assert.equal((await new RealFileSystem(root).stat("/")).type, "directory");
  assert.equal((await createRealFileSystem(root)).capabilities.streamingRead, true);
  assert.ok(Object.isFrozen(filesystem.capabilities));
  assert.throws(() => new RealFileSystem({ root: "relative" }), errno("EINVAL"));
  assert.throws(() => new RealFileSystem({ root: "" }), errno("EINVAL"));
  assert.throws(() => new RealFileSystem({ root: "/bad\0root" }), errno("EINVAL"));
  await assert.rejects(createRealFileSystem(join(temporary, "missing")), errno("ENOENT"));
  await native.writeFile(join(temporary, "file-root"), "file");
  await assert.rejects(createRealFileSystem(join(temporary, "file-root")), errno("ENOTDIR"));
});

test("binary data round-trips without text coercion or shared mutable views", async (context) => {
  const { filesystem, root } = await fixture(context);
  const contract: FileSystem = filesystem;
  const original = new Uint8Array([0, 255, 128, 13, 10, 65]);
  await contract.writeFile("/binary", original);
  original.fill(1);
  const actual = await contract.readFile("binary");
  assert.deepEqual(actual, new Uint8Array([0, 255, 128, 13, 10, 65]));
  actual.fill(2);
  assert.deepEqual(await contract.readFile("binary"), new Uint8Array([0, 255, 128, 13, 10, 65]));
  assert.deepEqual(new Uint8Array(await native.readFile(join(root, "binary"))), new Uint8Array([0, 255, 128, 13, 10, 65]));
});

test("writes replace, append preserves bytes, and exclusive flags never overwrite", async (context) => {
  const { filesystem } = await fixture(context);
  await filesystem.writeFile("/file", bytes("long original"));
  await filesystem.writeFile("/file", bytes("new"));
  await filesystem.appendFile("/file", bytes("+append"));
  await filesystem.writeFile("/file", bytes("+flag"), { flag: "a" });
  assert.equal(text(await filesystem.readFile("/file")), "new+append+flag");
  for (const flag of ["wx", "ax"] as const) {
    await assert.rejects(filesystem.writeFile("/file", bytes("bad"), { flag }), errno("EEXIST", "/file", "writeFile"));
    await filesystem.writeFile(`/${flag}`, bytes(flag), { flag });
  }
  await filesystem.appendFile("/created", bytes("created"));
  assert.equal(text(await filesystem.readFile("/created")), "created");
});

test("empty writes and truncate shrink, extend with zeroes, and default to zero", async (context) => {
  const { filesystem } = await fixture(context);
  await filesystem.writeFile("file", bytes("abcdef"));
  await filesystem.truncate("file", 2);
  assert.equal(text(await filesystem.readFile("file")), "ab");
  await filesystem.truncate("file", 5);
  assert.deepEqual(await filesystem.readFile("file"), new Uint8Array([97, 98, 0, 0, 0]));
  await filesystem.truncate("file");
  assert.equal((await filesystem.stat("file")).size, 0);
  await filesystem.writeFile("empty", new Uint8Array());
  assert.equal((await filesystem.readFile("empty")).length, 0);
  await assert.rejects(filesystem.truncate("missing"), errno("ENOENT"));
  await assert.rejects(filesystem.truncate("file", -1), errno("EINVAL"));
});

test("directories support recursive creation, typed entries, and removal", async (context) => {
  const { filesystem } = await fixture(context);
  await filesystem.mkdir("/tree/deep", { recursive: true });
  await filesystem.mkdir("/tree/deep", { recursive: true });
  await filesystem.writeFile("/tree/file", bytes("data"));
  await filesystem.symlink("file", "/tree/link");
  assert.deepEqual((await filesystem.readdir("/tree")).sort((left, right) => left.name.localeCompare(right.name)), [
    { name: "deep", type: "directory" }, { name: "file", type: "file" }, { name: "link", type: "symlink" },
  ]);
  await assert.rejects(filesystem.mkdir("/tree"), errno("EEXIST"));
  await assert.rejects(filesystem.mkdir("/missing/child"), errno("ENOENT"));
  await assert.rejects(filesystem.rm("/tree"), errno("EISDIR"));
  await filesystem.rm("/tree", { recursive: true });
  await assert.rejects(filesystem.stat("/tree"), errno("ENOENT"));
  await filesystem.rm("/missing/child", { force: true });
  await assert.rejects(filesystem.rm("/missing"), errno("ENOENT"));
});

test("stat metadata exposes host identity, mode, size, and millisecond times", async (context) => {
  const { filesystem, root } = await fixture(context);
  await filesystem.writeFile("file", bytes("data"), { mode: 0o600 });
  await filesystem.chmod("file", 0o640);
  const atimeMs = (Math.floor(Date.now() / 1000) + 86400) * 1000 + 125;
  await filesystem.utimes("file", atimeMs, 1_650_000_000_250);
  const stats = await filesystem.stat("file");
  const host = await native.stat(join(root, "file"));
  assert.equal(stats.type, "file");
  assert.equal(stats.size, 4);
  assert.equal(stats.mode & 0o777, 0o640);
  assert.equal(stats.mode, host.mode);
  assert.equal(stats.ino, host.ino);
  assert.equal(stats.dev, host.dev);
  assert.equal(stats.uid, host.uid);
  assert.equal(stats.gid, host.gid);
  assert.ok(Math.abs(stats.atimeMs - atimeMs) < 2);
  assert.ok(Math.abs(stats.mtimeMs - 1_650_000_000_250) < 2);
  assert.ok(Number.isFinite(stats.ctimeMs));
  assert.ok(Number.isFinite(stats.birthtimeMs));
  await filesystem.mkdir("private", { mode: 0o700 });
  assert.equal((await filesystem.stat("private")).mode & 0o777, 0o700);
  await filesystem.access("file", ACCESS_MODES.R_OK | ACCESS_MODES.W_OK);
  await assert.rejects(filesystem.access("missing"), errno("ENOENT"));
});

test("copy and rename overwrite files and preserve directory trees", async (context) => {
  const { filesystem } = await fixture(context);
  await filesystem.writeFile("source", bytes("source"), { mode: 0o600 });
  await filesystem.copyFile("source", "copy");
  await filesystem.writeFile("source", bytes("changed"));
  assert.equal(text(await filesystem.readFile("copy")), "source");
  await assert.rejects(filesystem.copyFile("source", "copy", { exclusive: true }), errno("EEXIST", "source", "copyFile"));
  await filesystem.copyFile("source", "copy");
  await filesystem.rename("source", "copy");
  assert.equal(text(await filesystem.readFile("copy")), "changed");
  await assert.rejects(filesystem.stat("source"), errno("ENOENT"));
  await filesystem.mkdir("tree/deep", { recursive: true });
  await filesystem.writeFile("tree/deep/file", bytes("nested"));
  await filesystem.rename("tree", "moved");
  assert.equal(text(await filesystem.readFile("moved/deep/file")), "nested");
  await assert.rejects(filesystem.copyFile("moved", "bad-copy"), (error) => isFsError(error, "EISDIR") || isFsError(error, "ENOTSUP"));
  await assert.rejects(filesystem.rename("missing", "destination"), (error: unknown) => {
    errno("ENOENT", "missing", "rename")(error);
    assert.equal((error as { dest: string }).dest, "destination");
    return true;
  });
});

test("relative and absolute symlinks have virtual readlink and realpath semantics", async (context) => {
  const { filesystem, root } = await fixture(context);
  await filesystem.mkdir("dir");
  await filesystem.writeFile("dir/file", bytes("target"));
  await filesystem.symlink("dir/file", "relative");
  await filesystem.symlink("/dir/file", "absolute");
  await filesystem.symlink("/dir", "directory-link");
  assert.equal(await filesystem.readlink("relative"), "dir/file");
  assert.equal(await filesystem.readlink("absolute"), "/dir/file");
  assert.equal(await native.readlink(join(root, "absolute")), join(root, "dir/file"));
  assert.equal((await filesystem.lstat("relative")).type, "symlink");
  assert.equal((await filesystem.stat("relative")).type, "file");
  assert.equal(await filesystem.realpath("directory-link/file"), "/dir/file");
  assert.equal(await filesystem.realpath("/"), "/");
  assert.equal(text(await filesystem.readFile("absolute")), "target");
  await filesystem.appendFile("relative", bytes("+append"));
  await filesystem.truncate("absolute", 6);
  await filesystem.chmod("absolute", 0o600);
  assert.equal(text(await filesystem.readFile("dir/file")), "target");
  assert.equal((await filesystem.stat("dir/file")).mode & 0o777, 0o600);
});

test("dangling links are inspectable and ordinary writes create their in-root targets", async (context) => {
  const { filesystem } = await fixture(context);
  await filesystem.symlink("missing", "dangling");
  assert.equal((await filesystem.lstat("dangling")).type, "symlink");
  assert.equal(await filesystem.readlink("dangling"), "missing");
  await assert.rejects(filesystem.stat("dangling"), errno("ENOENT"));
  for (const flag of ["wx", "ax"] as const) {
    await assert.rejects(filesystem.writeFile("dangling", bytes("bad"), { flag }), errno("EEXIST"));
  }
  await filesystem.writeFile("dangling", bytes("created"));
  assert.equal(text(await filesystem.readFile("missing")), "created");
  await filesystem.rm("dangling");
  assert.equal(text(await filesystem.readFile("missing")), "created");
});

test("copy follows symlinks while exclusive copy and rename operate on destination entries", async (context) => {
  const { filesystem } = await fixture(context);
  await filesystem.writeFile("source", bytes("new"));
  await filesystem.writeFile("target", bytes("old"));
  await filesystem.symlink("source", "source-link");
  await filesystem.symlink("target", "target-link");
  await filesystem.copyFile("source-link", "target-link");
  assert.equal(text(await filesystem.readFile("target")), "new");
  assert.equal((await filesystem.lstat("target-link")).type, "symlink");
  await filesystem.symlink("absent", "dangling");
  await assert.rejects(filesystem.copyFile("source", "dangling", { exclusive: true }), errno("EEXIST"));
  await filesystem.rename("source-link", "moved-link");
  assert.equal((await filesystem.lstat("moved-link")).type, "symlink");
  await filesystem.rename("source", "target-link");
  assert.equal((await filesystem.lstat("target-link")).type, "file");
  assert.equal(text(await filesystem.readFile("target")), "new");
});

test("hardlinks share inode and data, and removing one preserves the other", async (context) => {
  const { filesystem } = await fixture(context);
  await filesystem.writeFile("first", bytes("first"));
  await filesystem.link("first", "second");
  assert.equal((await filesystem.stat("first")).ino, (await filesystem.stat("second")).ino);
  assert.equal((await filesystem.stat("first")).nlink, 2);
  await filesystem.appendFile("second", bytes("+second"));
  assert.equal(text(await filesystem.readFile("first")), "first+second");
  await assert.rejects(filesystem.link("first", "second"), errno("EEXIST"));
  await filesystem.rm("first");
  assert.equal((await filesystem.stat("second")).nlink, 1);
});

test("common type errors use contract FsError with virtual paths and errno", async (context) => {
  const { filesystem } = await fixture(context);
  await filesystem.writeFile("file", bytes("file"));
  await filesystem.mkdir("dir");
  await assert.rejects(filesystem.readFile("absent"), errno("ENOENT", "absent", "readFile"));
  await assert.rejects(filesystem.readFile("dir"), errno("EISDIR", "dir", "readFile"));
  await assert.rejects(filesystem.writeFile("dir", bytes("bad")), errno("EISDIR"));
  await assert.rejects(filesystem.readdir("file"), errno("ENOTDIR"));
  await assert.rejects(filesystem.stat("file/child"), errno("ENOTDIR"));
  await assert.rejects(filesystem.writeFile("file/child", bytes("bad")), errno("ENOTDIR"));
  await assert.rejects(filesystem.readlink("file"), errno("EINVAL"));
  await assert.rejects(filesystem.chmod("missing", 0o600), errno("ENOENT"));
});

test("bounded reads enforce exact byte limits including an empty file", async (context) => {
  const { filesystem } = await fixture(context);
  await filesystem.writeFile("data", new Uint8Array([0, 1, 2, 3]));
  assert.equal((await filesystem.readFile("data", { maxBytes: 4 })).length, 4);
  await assert.rejects(filesystem.readFile("data", { maxBytes: 3 }), errno("EFBIG", "data", "readFile"));
  await assert.rejects(filesystem.readFile("data", { maxBytes: 0 }), errno("EFBIG"));
  await filesystem.writeFile("empty", new Uint8Array());
  assert.equal((await filesystem.readFile("empty", { maxBytes: 0 })).length, 0);
  await assert.rejects(filesystem.readFile("data", { maxBytes: -1 }), errno("EINVAL"));
});

test("byte streams honor offsets, chunk size, end-exclusive limits, and early return", async (context) => {
  const { filesystem } = await fixture(context);
  await filesystem.writeStream("data", (async function* () {
    yield bytes("abc"); yield new Uint8Array(); yield bytes("defghi");
  })());
  const chunks: Uint8Array[] = [];
  for await (const chunk of filesystem.readStream("data", { start: 2, endExclusive: 8, chunkSize: 2 })) chunks.push(chunk);
  assert.deepEqual(chunks.map(text), ["cd", "ef", "gh"]);
  assert.deepEqual(await collectBytes(filesystem.readStream("data", { start: 50 }), { maxBytes: 100 }), new Uint8Array());
  assert.deepEqual(await collectBytes(filesystem.readStream("data", { start: 3, endExclusive: 3 }), { maxBytes: 0 }), new Uint8Array());
  const iterator = filesystem.readStream("data", { chunkSize: 1 })[Symbol.asyncIterator]();
  assert.equal(text((await iterator.next()).value!), "a");
  await iterator.return!();
  await filesystem.writeStream("data", toByteSource("+append"), { flag: "a" });
  assert.equal(text(await filesystem.readFile("data")), "abcdefghi+append");
  await assert.rejects(collectBytes(filesystem.readStream("data", { chunkSize: 0 }), { maxBytes: 100 }), errno("EINVAL"));
  await assert.rejects(collectBytes(filesystem.readStream("data", { start: 2, endExclusive: 1 }), { maxBytes: 100 }), errno("EINVAL"));
});

test("stream failure closes files and preserves explicitly documented partial writes", async (context) => {
  const { filesystem } = await fixture(context);
  await assert.rejects(filesystem.writeStream("partial", (async function* () {
    yield bytes("prefix");
    throw new Error("source failed");
  })()), errno("EIO"));
  assert.equal(text(await filesystem.readFile("partial")), "prefix");
  await filesystem.rename("partial", "closed");
  await filesystem.rm("closed");
});

test("cancellation preserves the abort reason and stops a streaming write", async (context) => {
  const { filesystem } = await fixture(context);
  const controller = new AbortController();
  const reason = new Error("stop now");
  await assert.rejects(filesystem.writeStream("partial", (async function* () {
    yield bytes("first");
    controller.abort(reason);
    yield bytes("never");
  })(), { signal: controller.signal }), (error) => error === reason);
  assert.equal(text(await filesystem.readFile("partial")), "first");
  const operations = [
    () => filesystem.readFile("partial", { signal: controller.signal }),
    () => filesystem.writeFile("never-created", bytes("bad"), { signal: controller.signal }),
    () => filesystem.mkdir("never-dir", { signal: controller.signal }),
    () => filesystem.rm("partial", { signal: controller.signal }),
    () => filesystem.copyFile("partial", "never-copy", { signal: controller.signal }),
    () => filesystem.rename("partial", "never-move", { signal: controller.signal }),
  ];
  for (const operation of operations) await assert.rejects(operation(), (error) => error === reason);
  assert.deepEqual((await filesystem.readdir("/")).map((entry) => entry.name), ["partial"]);
});
