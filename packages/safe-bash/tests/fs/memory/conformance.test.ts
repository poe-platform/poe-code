import assert from "node:assert/strict";
import test from "node:test";
import { ACCESS_MODES } from "../../../src/contracts/filesystem.js";
import type { FileSystem, FileSystemFactory } from "../../../src/contracts/filesystem.js";
import { isFsError } from "../../../src/contracts/errors.js";
import type { ErrnoCode } from "../../../src/contracts/errors.js";
import { collectBytes, toByteSource } from "../../../src/contracts/io.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";

const factory: FileSystemFactory = createMemoryFileSystem;
const encode = (value: string): Uint8Array => new TextEncoder().encode(value);
const decode = (value: Uint8Array): string => new TextDecoder().decode(value);
const rejects = async (action: Promise<unknown>, code: ErrnoCode): Promise<void> => {
  await assert.rejects(action, (error: unknown) => isFsError(error, code));
};

async function filesystem(): Promise<FileSystem> {
  return factory({});
}

test("contract: instances start with isolated, writable directory roots", async () => {
  const first = await filesystem();
  const second = await filesystem();
  assert.equal((await first.stat("/")).type, "directory");
  assert.deepEqual(await first.readdir("/"), []);
  await first.writeFile("/only-first", encode("data"));
  await rejects(second.stat("/only-first"), "ENOENT");
  assert.equal(first.capabilities.readOnly, false);
});

test("contract: byte writes and reads preserve arbitrary binary values and isolate buffers", async () => {
  const filesystem = await factory({});
  const original = Uint8Array.from({ length: 256 }, (_, index) => index);
  const expected = new Uint8Array(original);
  await filesystem.writeFile("/binary", original);
  original.fill(0);
  const received = await filesystem.readFile("/binary");
  assert.deepEqual(received, expected);
  received.fill(255);
  assert.deepEqual(await filesystem.readFile("/binary"), expected);
  assert.equal((await filesystem.stat("/binary")).size, 256);
});

test("contract: write flags distinguish creation, replacement, and appending", async () => {
  const filesystem = await factory({});
  await filesystem.writeFile("/file", encode("first"), { flag: "wx", mode: 0o640 });
  await rejects(filesystem.writeFile("/file", encode("bad"), { flag: "wx" }), "EEXIST");
  await rejects(filesystem.writeFile("/file", encode("bad"), { flag: "ax" }), "EEXIST");
  await filesystem.writeFile("/file", encode("!"), { flag: "a", mode: 0o777 });
  assert.equal(decode(await filesystem.readFile("/file")), "first!");
  assert.equal((await filesystem.stat("/file")).mode & 0o777, 0o640);
  await filesystem.writeFile("/file", encode("next"));
  assert.equal(decode(await filesystem.readFile("/file")), "next");
  await filesystem.appendFile("/new", encode("created"));
  await filesystem.writeFile("/exclusive-append", encode("created"), { flag: "ax" });
  assert.equal(decode(await filesystem.readFile("/new")), "created");
});

test("contract: directories support recursive creation and typed, immediate children", async () => {
  const filesystem = await factory({});
  await rejects(filesystem.mkdir("/missing/child"), "ENOENT");
  await filesystem.mkdir("/parent/child/grandchild", { recursive: true, mode: 0o750 });
  await filesystem.mkdir("/parent/child", { recursive: true });
  await rejects(filesystem.mkdir("/parent/child"), "EEXIST");
  await filesystem.writeFile("/parent/file", encode("value"));
  assert.deepEqual(await filesystem.readdir("/parent"), [
    { name: "child", type: "directory" }, { name: "file", type: "file" },
  ]);
  assert.equal((await filesystem.stat("/parent/child")).mode & 0o777, 0o750);
  await rejects(filesystem.readdir("/parent/file"), "ENOTDIR");
  await rejects(filesystem.readFile("/parent"), "EISDIR");
  await rejects(filesystem.writeFile("/parent", encode("bad")), "EISDIR");
});

test("contract: rename moves directory trees and preserves file identity", async () => {
  const filesystem = await factory({});
  await filesystem.mkdir("/source/nested", { recursive: true });
  await filesystem.writeFile("/source/nested/file", encode("content"));
  const before = await filesystem.stat("/source/nested/file");
  await filesystem.rename("/source", "/destination");
  await rejects(filesystem.stat("/source"), "ENOENT");
  assert.equal(decode(await filesystem.readFile("/destination/nested/file")), "content");
  assert.equal((await filesystem.stat("/destination/nested/file")).ino, before.ino);
  await filesystem.rename("/destination", "/destination");
});

test("contract: copy is independent, overwrites, and respects exclusivity", async () => {
  const filesystem = await factory({});
  await filesystem.writeFile("/source", encode("original"), { mode: 0o600 });
  await filesystem.copyFile("/source", "/copy");
  assert.equal((await filesystem.stat("/copy")).mode & 0o777, 0o600);
  await filesystem.appendFile("/copy", encode("!"));
  assert.equal(decode(await filesystem.readFile("/source")), "original");
  await rejects(filesystem.copyFile("/source", "/copy", { exclusive: true }), "EEXIST");
  await filesystem.copyFile("/source", "/copy");
  assert.equal(decode(await filesystem.readFile("/copy")), "original");
  await rejects(filesystem.copyFile("/source", "/source"), "EINVAL");
});

test("contract: removal requires recursion for directories and force only ignores missing paths", async () => {
  const filesystem = await factory({});
  await filesystem.mkdir("/tree/nested", { recursive: true });
  await filesystem.writeFile("/tree/nested/file", encode("value"));
  await rejects(filesystem.rm("/tree"), "EISDIR");
  await rejects(filesystem.rm("/tree", { force: true }), "EISDIR");
  await filesystem.rm("/tree", { recursive: true });
  await rejects(filesystem.rm("/tree"), "ENOENT");
  await filesystem.rm("/tree", { force: true });
  await rejects(filesystem.rm("/", { recursive: true, force: true }), "EBUSY");
  assert.equal((await filesystem.stat("/")).type, "directory");
});

test("contract: symlinks distinguish stat, lstat, readlink, and realpath", async () => {
  const filesystem = await factory({});
  assert.ok(filesystem.capabilities.symlinks);
  assert.ok(filesystem.symlink && filesystem.readlink);
  await filesystem.mkdir("/directory");
  await filesystem.writeFile("/directory/target", encode("value"));
  await filesystem.symlink("directory/target", "/link");
  assert.equal(await filesystem.readlink("/link"), "directory/target");
  assert.equal((await filesystem.stat("/link")).type, "file");
  assert.equal((await filesystem.lstat("/link")).type, "symlink");
  assert.equal(await filesystem.realpath("/link"), "/directory/target");
  assert.equal(decode(await filesystem.readFile("/link")), "value");
  await filesystem.rm("/link");
  assert.equal(decode(await filesystem.readFile("/directory/target")), "value");
});

test("contract: permissions and timestamps have usable optional methods", async () => {
  const filesystem = await factory({});
  assert.ok(filesystem.capabilities.permissions && filesystem.capabilities.timestamps);
  assert.ok(filesystem.chmod && filesystem.utimes);
  await filesystem.writeFile("/file", encode("value"));
  await filesystem.chmod("/file", 0o400);
  await filesystem.access("/file", ACCESS_MODES.R_OK);
  await rejects(filesystem.access("/file", ACCESS_MODES.W_OK), "EACCES");
  await rejects(filesystem.access("/file", ACCESS_MODES.X_OK), "EACCES");
  await filesystem.utimes("/file", 1234.5, 6789.25);
  const stat = await filesystem.stat("/file");
  assert.equal(stat.atimeMs, 1234.5);
  assert.equal(stat.mtimeMs, 6789.25);
  assert.equal(stat.mode & 0o170000, 0o100000);
});

test("contract: truncation shrinks or zero-fills and defaults to zero", async () => {
  const filesystem = await factory({});
  assert.ok(filesystem.truncate);
  await filesystem.writeFile("/file", Uint8Array.of(1, 2, 3));
  await filesystem.truncate("/file", 5);
  assert.deepEqual(await filesystem.readFile("/file"), Uint8Array.of(1, 2, 3, 0, 0));
  await filesystem.truncate("/file", 2);
  assert.deepEqual(await filesystem.readFile("/file"), Uint8Array.of(1, 2));
  await filesystem.truncate("/file");
  assert.equal((await filesystem.stat("/file")).size, 0);
});

test("contract: hardlinks preserve shared contents, inode, and link count", async () => {
  const filesystem = await factory({});
  assert.ok(filesystem.capabilities.hardlinks && filesystem.link);
  await filesystem.writeFile("/file", encode("first"));
  await filesystem.link("/file", "/alias");
  assert.equal((await filesystem.stat("/file")).ino, (await filesystem.stat("/alias")).ino);
  assert.equal((await filesystem.stat("/file")).nlink, 2);
  await filesystem.writeFile("/alias", encode("changed"));
  assert.equal(decode(await filesystem.readFile("/file")), "changed");
  await filesystem.rm("/file");
  assert.equal((await filesystem.stat("/alias")).nlink, 1);
});

test("contract: streaming round trips bytes and applies half-open read ranges", async () => {
  const filesystem = await factory({});
  assert.ok(filesystem.capabilities.streamingRead && filesystem.capabilities.streamingWrite);
  assert.ok(filesystem.readStream && filesystem.writeStream);
  await filesystem.writeStream("/file", toByteSource("0123456789"));
  const chunks = [];
  for await (const chunk of filesystem.readStream("/file", { start: 2, endExclusive: 8, chunkSize: 2 })) chunks.push(chunk);
  assert.deepEqual(chunks.map(decode), ["23", "45", "67"]);
  await filesystem.writeStream("/file", toByteSource("!"), { flag: "a" });
  assert.equal(decode(await collectBytes(filesystem.readStream("/file"), { maxBytes: 11 })), "0123456789!");
});

test("contract: bounded reads reject overflow and permit exact or empty reads", async () => {
  const filesystem = await factory({});
  await filesystem.writeFile("/file", Uint8Array.of(1, 2));
  await rejects(filesystem.readFile("/file", { maxBytes: 1 }), "EFBIG");
  assert.equal((await filesystem.readFile("/file", { maxBytes: 2 })).byteLength, 2);
  await filesystem.writeFile("/empty", new Uint8Array());
  assert.equal((await filesystem.readFile("/empty", { maxBytes: 0 })).byteLength, 0);
});
