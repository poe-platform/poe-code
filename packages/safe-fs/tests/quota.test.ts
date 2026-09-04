import assert from "node:assert/strict";
import { test } from "vitest";
import { createMemoryFileSystem } from "../src/fs/memory/index.js";
import { withFileSystemQuota } from "../src/fs/quota/index.js";
import { createNodeFsBridge } from "../src/node/index.js";
import { OverlayFileSystem } from "../src/fs/overlay/index.js";
import { ReadOnlyFileSystem } from "../src/fs/readonly/index.js";

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

test("quota composes with Overlay and readonly without changing frozen backend capabilities", async () => {
  const upper = createMemoryFileSystem();
  const overlay = new OverlayFileSystem({ upper, lower: createMemoryFileSystem() });
  const descriptor = Object.getOwnPropertyDescriptor(overlay, "capabilities");
  assert.equal(descriptor?.configurable, false);
  assert.equal(descriptor?.writable, false);
  const quota = withFileSystemQuota(overlay, { maxBytes: 4 });
  const readonly = new ReadOnlyFileSystem(quota);
  assert.equal(quota.capabilities.readOnly, overlay.capabilities.readOnly);
  assert.equal(readonly.capabilities.readOnly, true);
  assert.equal((await readonly.capabilitiesFor("/"))?.streamingWrite, false);
  await quota.writeFile("/file", bytes("1234"));
  assert.deepEqual(await readonly.readFile("/file"), bytes("1234"));
  await assert.rejects(quota.appendFile("/file", bytes("5")), /quota/i);
  assert.deepEqual(await upper.readFile("/file"), bytes("1234"));
  assert.deepEqual(Object.getOwnPropertyDescriptor(overlay, "capabilities"), descriptor);
});

test("quota transforms frozen global and path capabilities instead of returning raw descriptors", async () => {
  const raw = createMemoryFileSystem();
  const capabilities = Object.freeze({ ...raw.capabilities, append: false, streamingWrite: true });
  const options = { signal: new AbortController().signal };
  Object.defineProperty(raw, "capabilities", { value: capabilities, configurable: false, writable: false });
  Object.defineProperty(raw, "capabilitiesFor", { configurable: false, writable: false,
    async value(this: typeof raw, path: string, received: unknown) {
      assert.equal(this, raw);
      assert.equal(path, "/file");
      assert.equal(received, options);
      return capabilities;
    }
  });
  const quota = withFileSystemQuota(raw, { maxBytes: 4 });
  assert.equal(quota.capabilities.streamingWrite, false);
  assert.equal((await quota.capabilitiesFor!("/file", options)).streamingWrite, false);
  assert.equal(raw.capabilities, capabilities);
  assert.equal(raw.capabilities.streamingWrite, true);
});

test("quota forwards frozen own methods with the backend receiver and keeps writes guarded", async () => {
  const raw = createMemoryFileSystem();
  for (const name of ["readFile", "writeFile"] as const) {
    Object.defineProperty(raw, name, { value: raw[name], configurable: false, writable: false });
  }
  Object.preventExtensions(raw);
  const quota = Object.freeze(withFileSystemQuota(raw, { maxBytes: 4 }));
  assert.equal("readFile" in quota, true);
  assert.equal("writeFile" in quota, true);
  assert.equal("missingMethod" in quota, false);
  const write = quota.writeFile;
  const read = quota.readFile;
  await write("/file", bytes("1234"));
  assert.deepEqual(await read("/file"), bytes("1234"));
  await assert.rejects(write("/file", bytes("12345")), /quota/i);
  assert.deepEqual(await raw.readFile("/file"), bytes("1234"));
});

test("quota covers cumulative writes, copies, appends, and truncation", async () => {
  const raw = createMemoryFileSystem();
  const fs = withFileSystemQuota(raw, { maxBytes: 8 });
  await fs.writeFile("/a", bytes("1234"));
  await fs.copyFile("/a", "/b");
  await assert.rejects(fs.appendFile("/a", bytes("9")), /quota/i);
  await fs.rm("/b");
  await fs.appendFile("/a", bytes("9"));
  await assert.rejects(fs.truncate!("/a", 9), /quota/i);
  assert.equal(new TextDecoder().decode(await fs.readFile("/a")), "12349");
});

test("quota covers streaming writes without buffering the source", async () => {
  const raw = createMemoryFileSystem();
  const fs = withFileSystemQuota(raw, { maxBytes: 4 });
  const source = (async function* () { yield bytes("12"); yield bytes("345"); })();
  await assert.rejects(fs.writeStream!("/stream", source), /quota/i);
  assert.equal((await fs.stat("/stream")).size, 2);
});

test("guest writes through a dangling symlink cannot subtract the link's storage", async () => {
  const raw = createMemoryFileSystem();
  const guest = createNodeFsBridge(withFileSystemQuota(raw, { maxBytes: 128 }));
  const target = "/" + "t".repeat(99);
  await guest.symlink(target, "/alias");
  await assert.rejects(guest.writeFile("/alias", "x".repeat(128)), /quota/i);
  await assert.rejects(raw.stat(target), { code: "ENOENT" });
  assert.equal((await raw.lstat("/alias")).size, 100);
});

for (const operation of ["write", "append", "append-flag", "copy", "truncate", "stream", "stream-append"] as const) {
  test(`quota accounts for the symlink referent during ${operation}`, async () => {
    const raw = createMemoryFileSystem();
    const fs = withFileSystemQuota(raw, { maxBytes: 72 });
    const target = "/" + "t".repeat(39);
    await fs.writeFile(target, bytes("12345"));
    await fs.writeFile("/source", bytes("x".repeat(20)));
    await fs.symlink!(target, "/alias");
    const mutate = async () => {
      switch (operation) {
        case "write": return fs.writeFile("/alias", bytes("x".repeat(20)));
        case "append": return fs.appendFile("/alias", bytes("x".repeat(15)));
        case "append-flag": return fs.writeFile("/alias", bytes("x".repeat(15)), { flag: "a" });
        case "copy": return fs.copyFile("/source", "/alias");
        case "truncate": return fs.truncate!("/alias", 20);
        case "stream": return fs.writeStream!("/alias", (async function* () { yield bytes("12345"); yield bytes("x".repeat(15)); })());
        case "stream-append": return fs.writeStream!("/alias", (async function* () { yield bytes("x".repeat(15)); })(), { flag: "a" });
      }
    };
    await assert.rejects(mutate(), /quota/i);
    assert.equal((await raw.stat(target)).size, 5);
    assert.equal((await raw.lstat("/alias")).size, 40);
    await fs.appendFile("/alias", bytes("1234567"));
    assert.equal((await raw.stat(target)).size, 12);
  });
}

test("hard-linking a symlink charges the new link entry, not its referent", async () => {
  const raw = createMemoryFileSystem();
  const fs = withFileSystemQuota(raw, { maxBytes: 32 });
  const target = "/" + "t".repeat(19);
  await fs.writeFile(target, bytes("x"));
  await fs.symlink!(target, "/alias");
  await assert.rejects(fs.link!("/alias", "/copy"), /quota/i);
  await assert.rejects(raw.lstat("/copy"), { code: "ENOENT" });
});
