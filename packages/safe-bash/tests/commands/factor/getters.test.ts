import assert from "node:assert/strict";
import test from "node:test";
import { createFactorCommand } from "../../../src/commands/factor/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { toByteSource, type ByteSink, type ByteSource, type CommandContext } from "../../../src/contracts/index.js";

async function execute(overrides: Partial<CommandContext>) {
  return createFactorCommand().execute({
    command: "factor", args: [], cwd: "/", env: { LC_ALL: "C" }, fs: new MemoryFileSystem(),
    signal: new AbortController().signal, stdin: toByteSource("12"),
    stdout: { async write() {} }, stderr: { async write() {} }, ...overrides,
  });
}

for (const phase of ["factory", "next"] as const) for (const reason of [false, 0, "", null]) {
  test(`input ${phase} getter cancellation refuses method admission: ${JSON.stringify(reason)}`, async () => {
    const caller = new AbortController();
    let factories = 0, reads = 0, returned = 0;
    const iterator: AsyncIterator<Uint8Array> = {
      get next() {
        if (phase === "next") caller.abort(reason);
        return async function () { reads++; return { done: false, value: Buffer.from("12 ") }; };
      },
      async return() { returned++; return { done: true, value: undefined }; },
    };
    const stdin: ByteSource = {
      get [Symbol.asyncIterator]() {
        if (phase === "factory") caller.abort(reason);
        return function () { factories++; return iterator; };
      },
    };
    await assert.rejects(execute({ stdin, signal: caller.signal }), error => Object.is(error, reason));
    assert.deepEqual({ factories, reads, returned }, phase === "factory" ? { factories: 0, reads: 0, returned: 0 } : { factories: 1, reads: 0, returned: 1 });
  });
}

for (const phase of ["capability", "write"] as const) for (const reason of [false, 0, "", null]) {
  test(`stderr ${phase} getter cancellation refuses write admission: ${JSON.stringify(reason)}`, async () => {
    const caller = new AbortController();
    let writes = 0;
    const capability = {
      consumerClosed: new AbortController().signal,
      get write() {
        if (phase === "write") caller.abort(reason);
        return async function () { writes++; };
      },
    };
    const stderr: ByteSink = {
      async write() { assert.fail("unexpected opaque route"); },
      get ownedOutput() {
        if (phase === "capability") caller.abort(reason);
        return capability;
      },
    };
    await assert.rejects(execute({ args: ["bad"], stderr, signal: caller.signal }), error => Object.is(error, reason));
    assert.equal(writes, 0);
  });
}

test("admitted iterator and destination methods preserve their receivers", async () => {
  let reads = 0, writes = 0;
  const iterator: AsyncIterator<Uint8Array> = {
    async next() {
      assert.equal(this, iterator);
      return reads++ ? { done: true, value: undefined } : { done: false, value: Buffer.from("12") };
    },
  };
  const stdin: ByteSource = { [Symbol.asyncIterator]() { assert.equal(this, stdin); return iterator; } };
  const capability = {
    consumerClosed: new AbortController().signal,
    async write(value: Uint8Array) { assert.equal(this, capability); writes++; assert.equal(Buffer.from(value).toString(), "12: 2 2 3\n"); },
  };
  const result = await execute({ stdin, stdout: { async write() { assert.fail("unexpected opaque route"); }, ownedOutput: capability } });
  assert.equal(result.exitCode, 0);
  assert.deepEqual({ reads, writes }, { reads: 2, writes: 1 });
});
