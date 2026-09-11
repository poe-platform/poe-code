import assert from "node:assert/strict";
import test from "node:test";
import { createPrCommand } from "../../../src/commands/pr/index.js";
import { createTsortCommand } from "../../../src/commands/tsort/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { toByteSource, type ByteSource, type ByteSink, type CommandContext } from "../../../src/contracts/index.js";

for (const [name, create, args] of [["pr", createPrCommand, ["-t"]], ["tsort", createTsortCommand, []]] as const) {
  const execute = async (overrides: Partial<CommandContext>) => create().execute({
    command: name, args, cwd: "/", env: { LC_ALL: "C", TZ: "UTC" }, fs: new MemoryFileSystem(),
    signal: new AbortController().signal, stdin: toByteSource("12 "),
    stdout: { async write() { assert.fail("unexpected stdout"); } },
    stderr: { async write() { assert.fail("unexpected stderr"); } }, ...overrides,
  });
  for (const phase of ["factory", "next"] as const) for (const reason of [false, 0, "", null]) {
    test(`${name} direct ${phase} getter cancellation blocks input admission ${JSON.stringify(reason)}`, async () => {
      const caller = new AbortController();
      let factories = 0, reads = 0, returned = 0;
      const iterator: AsyncIterator<Uint8Array> = {
        get next() {
          if (phase === "next") caller.abort(reason);
          return async () => { reads++; return { done: false, value: Buffer.from("12 ") }; };
        },
        async return() { returned++; return { done: true, value: undefined }; },
      };
      const stdin: ByteSource = {
        get [Symbol.asyncIterator]() {
          if (phase === "factory") caller.abort(reason);
          return () => { factories++; return iterator; };
        },
      };
      await assert.rejects(execute({ stdin, signal: caller.signal }), error => Object.is(error, reason));
      assert.deepEqual({ factories, reads, returned }, phase === "factory" ? { factories: 0, reads: 0, returned: 0 } : { factories: 1, reads: 0, returned: 1 });
    });
  }
  for (const phase of ["capability", "write"] as const) for (const reason of [false, 0, "", null]) {
    test(`${name} direct stderr ${phase} getter cancellation blocks output admission ${JSON.stringify(reason)}`, async () => {
      const caller = new AbortController();
      let writes = 0;
      const capability = {
        consumerClosed: new AbortController().signal,
        get write() {
          if (phase === "write") caller.abort(reason);
          return async () => { writes++; };
        },
      };
      const stderr: ByteSink = {
        async write() { assert.fail("opaque output route"); },
        get ownedOutput() {
          if (phase === "capability") caller.abort(reason);
          return capability;
        },
      };
      await assert.rejects(execute({ args: ["--unknown"], stderr, signal: caller.signal }), error => Object.is(error, reason));
      assert.equal(writes, 0);
    });
  }
}

