import assert from "node:assert/strict";
import { test } from "vitest";
import { MemoryFileSystem } from "../src/fs/memory/index.js";

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
