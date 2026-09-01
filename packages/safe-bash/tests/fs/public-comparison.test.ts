import assert from "node:assert/strict";
import test from "node:test";
import { FsError, MemoryFileSystem, createReadOnlyFileSystem } from "poe-code/safe-fs";
import { compareEntries } from "./public-comparison.js";

test("public readonly comparison preserves aliases, distinct storage and readonly views", async () => {
  const first = new MemoryFileSystem();
  const second = new MemoryFileSystem();
  await first.writeFile("/file", new Uint8Array([1]));
  await first.link("/file", "/alias");
  await second.writeFile("/file", new Uint8Array([2]));
  assert.equal(await compareEntries(first, "/file", createReadOnlyFileSystem(first), "/alias"), "same");
  assert.equal(await compareEntries(first, "/file", second, "/file"), "distinct");
  assert.deepEqual(await first.readFile("/file"), new Uint8Array([1]));
  assert.deepEqual(await second.readFile("/file"), new Uint8Array([2]));
});

test("public readonly comparison preserves cancellation and errors without callbacks after abort", async () => {
  let calls = 0;
  class Authority extends MemoryFileSystem {
    override async compareEntry(): Promise<never> { calls++; throw reason; }
    override async lstat(...args: Parameters<MemoryFileSystem["lstat"]>) {
      const { identityScope: ignoredScope, ...stat } = await super.lstat(...args);
      return stat;
    }
  }
  const reason = new FsError("EACCES");
  const filesystem = new Authority();
  const peer = new MemoryFileSystem();
  await filesystem.writeFile("/file", new Uint8Array([1]));
  await peer.writeFile("/file", new Uint8Array([2]));
  const signal = AbortSignal.abort(reason);
  await assert.rejects(compareEntries(filesystem, "/file", filesystem, "/file", { signal }), error => error === reason);
  assert.equal(calls, 0);
  await assert.rejects(compareEntries(filesystem, "/file", peer, "/file"), error => error === reason);
  assert.equal(calls, 1);
});
