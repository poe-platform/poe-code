import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource, type CommandContext } from "safe-bash-contracts";
import { RandomIntegers } from "./random.js";

function context(): CommandContext {
  return { command: "shuf", args: [], cwd: "/", env: {}, fs: createMemoryFileSystem(),
    stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: { async write() {} }, stderr: { async write() {} } };
}

for (const sync of [false, true]) test(`secure entropy preserves exact BigInt sampling (${sync ? "sync" : "async"})`, async t => {
  let calls = 0;
  t.mock.method(globalThis.crypto, "getRandomValues", (bytes: Uint8Array) => {
    assert.ok(bytes instanceof Uint8Array);
    assert.equal(bytes.length, 4096);
    calls++;
    bytes.fill(0);
    bytes.set([255, 7]); // Reject 255 for size 10; accept 7.
    return bytes;
  });
  const random = new RandomIntegers(context(), undefined);
  const choose = (size: bigint) => sync ? random.chooseSync(size) : random.choose(size);
  assert.equal(await choose(1n), 0n);
  assert.equal(calls, 0);
  assert.equal(await choose(10n), 7n);
  await random.close();

  t.mock.restoreAll();
  t.mock.method(globalThis.crypto, "getRandomValues", (bytes: Uint8Array) => {
    bytes.fill(255); bytes[7] = 254;
    return bytes;
  });
  const wide = new RandomIntegers(context(), undefined);
  assert.equal(await (sync ? wide.chooseSync((1n << 64n) - 1n) : wide.choose((1n << 64n) - 1n)), (1n << 64n) - 2n);
  await wide.close();
});

test("default entropy refills securely and clears its owned buffer on close", async t => {
  const buffers: Uint8Array[] = [];
  t.mock.method(globalThis.crypto, "getRandomValues", (bytes: Uint8Array) => {
    buffers.push(bytes); bytes.fill(buffers.length); return bytes;
  });
  const random = new RandomIntegers(context(), undefined);
  for (let i = 0; i < 4097; i++) assert.equal(random.chooseSync(256n), i < 4096 ? 1n : 2n);
  assert.equal(buffers.length, 2);
  await random.close();
  assert.ok(buffers.every(bytes => bytes.every(byte => byte === 0)));
});

test("explicit entropy uses only the supplied VFS and never Web Crypto", async t => {
  t.mock.method(globalThis.crypto, "getRandomValues", () => { throw new Error("ambient entropy accessed"); });
  const ctx = context();
  await ctx.fs.writeFile("/entropy", Uint8Array.of(255, 7));
  const random = new RandomIntegers(ctx, "/entropy");
  await random.open();
  assert.equal(await random.choose(10n), 7n);
  await assert.rejects(random.choose(1n << 32n), /end of file/);
  await random.close();
});

test("entropy failure never exposes partial bytes on retry", async t => {
  const failure = new Error("secure entropy unavailable");
  t.mock.method(globalThis.crypto, "getRandomValues", (bytes: Uint8Array) => { bytes.fill(42); throw failure; });
  const random = new RandomIntegers(context(), undefined);
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.throws(() => random.chooseSync(256n), error => error === failure);
  }
  await random.close();
});
