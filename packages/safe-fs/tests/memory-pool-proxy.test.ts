import assert from "node:assert/strict";
import { test } from "vitest";
import { MemoryFileSystem, tryWriteMemoryFileSync } from "../src/fs/memory/index.js";

test("forwarded Memory receivers reuse released storage without retaining bytes or file identity", async () => {
  const memory = new MemoryFileSystem();
  const forwarded = new Proxy(memory, { get: (target, key) => Reflect.get(target, key) });
  await forwarded.writeFile("/first", new Uint8Array(64).fill(91), { mode: 0o600 });
  const first = await forwarded.stat("/first");
  await forwarded.unlink!("/first");
  await memory.writeFile("/second", Uint8Array.of(7), { mode: 0o640 });
  const second = await forwarded.stat("/second");
  assert.notEqual(second.ino, first.ino);
  assert.equal(second.nlink, 1);
  assert.equal(second.mode & 0o777, 0o640);
  await forwarded.truncate!("/second", 64);
  assert.deepEqual(await memory.readFile("/second"), Uint8Array.from({ length: 64 }, (_, index) => index === 0 ? 7 : 0));
  await forwarded.unlink!("/second");
  await forwarded.writeFile("/third", Uint8Array.of(3));
  assert.deepEqual(await memory.readFile("/third"), Uint8Array.of(3));
});

test("Memory pool reuse preserves retained handles, hardlinks and independent stores", async () => {
  const memory = new MemoryFileSystem();
  const forwarded = new Proxy(memory, { get: (target, key) => Reflect.get(target, key) });
  const other = new MemoryFileSystem();
  await forwarded.writeFile("/retained", new Uint8Array(64).fill(19));
  await assert.rejects(forwarded.openReadFile!("/retained"), { code: "ENOTSUP" });
  const handle = await memory.openReadFile!("/retained");
  const original = await handle.stat();
  await forwarded.link!("/retained", "/alias");
  await forwarded.unlink!("/retained");
  await forwarded.writeFile("/replacement", new Uint8Array(64).fill(29));
  assert.deepEqual(await forwarded.readFile("/alias"), new Uint8Array(64).fill(19));
  assert.equal((await handle.stat()).ino, original.ino);
  assert.equal((await handle.stat()).nlink, 1);
  await forwarded.unlink!("/alias");
  await forwarded.unlink!("/replacement");
  await forwarded.writeFile("/reused", new Uint8Array(64).fill(39));
  await other.writeFile("/other", new Uint8Array(64).fill(49));
  assert.deepEqual(await handle.read(0, 64), new Uint8Array(64).fill(19));
  assert.equal((await handle.stat()).nlink, 0);
  await handle.close();
  await forwarded.writeFile("/after-close", new Uint8Array(64).fill(59));
  assert.deepEqual(await memory.readFile("/reused"), new Uint8Array(64).fill(39));
  assert.deepEqual(await other.readFile("/other"), new Uint8Array(64).fill(49));
  await assert.rejects(handle.stat(), { code: "EBADF" });
});

test("forwarded ancestor rename invalidates direct file and directory write caches", async () => {
  const memory = new MemoryFileSystem();
  const forwarded = new Proxy(memory, { get: (target, key) => Reflect.get(target, key) });
  await memory.mkdir("/work/nested", { recursive: true });
  assert.equal(tryWriteMemoryFileSync(memory, "/work/nested/file", Uint8Array.of(1), true, 0o666), true);

  await forwarded.rename("/work", "/moved");
  assert.throws(() => tryWriteMemoryFileSync(memory, "/work/nested/file", Uint8Array.of(2), true, 0o666), { code: "ENOENT" });
  assert.throws(() => tryWriteMemoryFileSync(memory, "/work/nested/sibling", Uint8Array.of(3), false, 0o666), { code: "ENOENT" });
  await forwarded.mkdir("/work/nested", { recursive: true });
  assert.equal(tryWriteMemoryFileSync(memory, "/work/nested/file", Uint8Array.of(4), true, 0o666), true);
  assert.deepEqual(await memory.readFile("/work/nested/file"), Uint8Array.of(4));
  assert.deepEqual(await memory.readFile("/moved/nested/file"), Uint8Array.of(1));
  assert.deepEqual(await memory.readdir("/moved/nested"), [{ name: "file", type: "file" }]);
});

test("forwarded file rename cannot redirect a cached append to the moved inode", async () => {
  const memory = new MemoryFileSystem();
  const forwarded = new Proxy(memory, { get: (target, key) => Reflect.get(target, key) });
  await memory.mkdir("/work");
  assert.equal(tryWriteMemoryFileSync(memory, "/work/file", Uint8Array.of(1), true, 0o666), true);
  await forwarded.rename("/work/file", "/work/moved");
  await forwarded.writeFile("/work/file", Uint8Array.of(2));
  assert.equal(tryWriteMemoryFileSync(memory, "/work/file", Uint8Array.of(3), true, 0o666), true);
  assert.deepEqual(await memory.readFile("/work/file"), Uint8Array.of(2, 3));
  assert.deepEqual(await memory.readFile("/work/moved"), Uint8Array.of(1));
});

for (const operation of ["unlink", "rm"] as const) {
  for (const retainedLink of [false, true]) test(`forwarded ${operation} invalidates cached writes before ${retainedLink ? "hardlink retention" : "pool reuse"}`, async () => {
    const memory = new MemoryFileSystem();
    const forwarded = new Proxy(memory, { get: (target, key) => Reflect.get(target, key) });
    await memory.mkdir("/work");
    assert.equal(tryWriteMemoryFileSync(memory, "/work/file", Uint8Array.of(1), true, 0o666), true);
    if (retainedLink) await forwarded.link("/work/file", "/work/other");
    await forwarded[operation]("/work/file");
    if (!retainedLink) await forwarded.writeFile("/work/other", Uint8Array.of(1));

    assert.equal(tryWriteMemoryFileSync(memory, "/work/file", Uint8Array.of(2), true, 0o666), true);
    assert.deepEqual(await memory.readFile("/work/file"), Uint8Array.of(2));
    assert.deepEqual(await memory.readFile("/work/other"), Uint8Array.of(1));
    assert.notEqual((await memory.stat("/work/file")).ino, (await memory.stat("/work/other")).ino);
  });
}

test("forwarded descriptor close releases an unlinked cached file and its quota", async () => {
  const memory = new MemoryFileSystem({ maxBytes: 2 });
  const forwarded = new Proxy(memory, { get: (target, key) => Reflect.get(target, key) });
  await memory.mkdir("/work");
  assert.equal(tryWriteMemoryFileSync(memory, "/work/file", Uint8Array.of(1, 2), true, 0o666), true);
  const handle = await forwarded.open("/work/file", { access: "read" });
  await memory.unlink("/work/file");
  const buffer = new Uint8Array(2);
  assert.equal(await handle.read(buffer, 0), 2);
  assert.deepEqual(buffer, Uint8Array.of(1, 2));
  await handle.close();
  await forwarded.writeFile("/work/other", Uint8Array.of(3));
  assert.equal(tryWriteMemoryFileSync(memory, "/work/file", Uint8Array.of(4), true, 0o666), true);
  assert.deepEqual(await memory.readFile("/work/other"), Uint8Array.of(3));
  assert.deepEqual(await memory.readFile("/work/file"), Uint8Array.of(4));
});

test("forwarded rmdir releases a cached directory before its path is recreated", async () => {
  const memory = new MemoryFileSystem();
  const forwarded = new Proxy(memory, { get: (target, key) => Reflect.get(target, key) });
  await memory.mkdir("/work");
  assert.equal(tryWriteMemoryFileSync(memory, "/work/file", Uint8Array.of(1), true, 0o666), true);
  await memory.removeFileConditional("/work/file", { parent: await memory.stat("/work"), expected: await memory.stat("/work/file") });
  await forwarded.rmdir("/work");
  await forwarded.mkdir("/work");
  assert.equal(tryWriteMemoryFileSync(memory, "/work/file", Uint8Array.of(2), true, 0o666), true);
  assert.deepEqual(await memory.readFile("/work/file"), Uint8Array.of(2));
});

for (const path of ["/work", "/work/nested"]) test(`prepared permissions invalidate cached reads below ${path}`, async () => {
  const memory = new MemoryFileSystem();
  await memory.mkdir("/work/nested", { recursive: true });
  await memory.writeFile("/work/nested/file", Uint8Array.of(1));
  assert.deepEqual(await memory.readFile("/work/nested/file"), Uint8Array.of(1));
  await memory.prepareDirectory(path, {
    parent: await memory.stat(path === "/work" ? "/" : "/work"),
    expected: await memory.stat(path), mode: 0,
  });
  await assert.rejects(memory.readFile("/work/nested/file"), { code: "EACCES" });
});

test("cached reads resolve a recreated staging directory while cleanup retains the old one", async () => {
  const memory = new MemoryFileSystem();
  await memory.mkdir("/work");
  const staged = await memory.createStagedFile("/work/.stage", "file", { type: "file", data: Uint8Array.of(1) }, {
    parent: await memory.stat("/work"), retainCleanup: true,
  });
  try {
    assert.deepEqual(await memory.readFile("/work/.stage/file"), Uint8Array.of(1));
    await memory.removeStagedFile(staged);
    await memory.mkdir("/work/.stage");
    await memory.writeFile("/work/.stage/file", Uint8Array.of(2));
    assert.deepEqual(await memory.readFile("/work/.stage/file"), Uint8Array.of(2));
  } finally {
    await staged.cleanup!.close();
  }
});

for (const readOtherDirectory of [false, true]) test(`conditional unlink invalidates cached appends with intervening read: ${readOtherDirectory}`, async () => {
  const memory = new MemoryFileSystem();
  await memory.mkdir("/work", { mode: readOtherDirectory ? 0o700 : 0o777 });
  await memory.mkdir("/other");
  await memory.writeFile("/other/file", Uint8Array.of(9));
  assert.equal(tryWriteMemoryFileSync(memory, "/work/file", Uint8Array.of(1), true, 0o666), true);
  await memory.link("/work/file", "/alias");
  await memory.removeFileConditional("/work/file", {
    parent: await memory.stat("/work"), expected: await memory.stat("/work/file"),
  });
  if (readOtherDirectory) assert.deepEqual(await memory.readFile("/other/file"), Uint8Array.of(9));
  assert.equal(tryWriteMemoryFileSync(memory, "/work/file", Uint8Array.of(2), true, 0o666), true);
  assert.deepEqual(await memory.readFile("/work/file"), Uint8Array.of(2));
  assert.deepEqual(await memory.readFile("/alias"), Uint8Array.of(1));
});
