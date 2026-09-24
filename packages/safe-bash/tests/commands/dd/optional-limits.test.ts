import assert from "node:assert/strict";
import test from "node:test";
import { run, bytes } from "./helpers.js";
import { createDdCommand } from "../../../src/commands/dd/index.js";

test("dd block quota is opt-in and independent of transfer quota", async () => {
  for (const options of [{}, { maxTransferBytes: 1 }, { maxBlockBytes: 2_097_152 }, { maxBlockBytes: 1024 }]) {
    const result = await run(["bs=2097152", "status=none"], bytes("x"), {}, options);
    assert.equal(result.exitCode, options.maxBlockBytes === 1024 ? 1 : 0, result.stderr);
    if (!result.exitCode) assert.deepEqual(result.stdout, bytes("x"));
  }
});

test("dd passes omitted buffer and operation quotas to its opener without a ceiling", async () => {
  const requests: number[] = [];
  const result = await run(["status=none"], new Uint8Array(), {}, {
    maxTransferBytes: 0,
    openFile: async (_context, request) => {
      requests.push(request.maxBufferBytes, request.maxReadOperations);
      return { async read() { return new Uint8Array(); }, async write(value) { return value.length; }, async close() {} };
    },
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(requests, [Infinity, Infinity, Infinity, Infinity]);
  assert.throws(() => createDdCommand({ maxBufferBytes: 0 }), RangeError);
});
