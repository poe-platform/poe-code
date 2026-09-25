import assert from "node:assert/strict";
import { test } from "node:test";
import { settings } from "../../../src/commands/split/options.js";
import { chunks, files, run } from "./helpers.js";

test("split omits the buffer quota even when another quota is supplied", async () => {
  for (const options of [{}, { limits: { maxFiles: 1 } }]) {
    assert.equal(settings(options).maxBufferBytes, Infinity);
    const result = await run(["-C", "16777216"], "a", options);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await files(result.fs), { xaa: "61" });
  }
});

test("split rejects windows above an explicit buffer quota before reading", async () => {
  const limits = settings({});
  assert.equal(limits.maxChunkBytes, 64 * 1024);
  let read = false;
  const input = (async function* () { read = true; yield Buffer.from("a"); })();
  const result = await run(["-C", "9"], input, { limits: { maxBufferBytes: 8 } });
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes("buffer limit"));
  assert.equal(read, false);
  assert.deepEqual(await files(result.fs), {});
});

test("large admitted line-byte windows allocate only for available input", async () => {
  const Original = globalThis.Uint8Array;
  for (const input of ["", "a\nb\n"]) {
    const allocations: number[] = [];
    globalThis.Uint8Array = new Proxy(Original, {
      construct(target, args) {
        if (typeof args[0] === "number") allocations.push(args[0]);
        return Reflect.construct(target, args);
      },
    });
    try {
      const result = await run(["-C", "16777216"], input, { limits: { maxBufferBytes: 32 * 1024 * 1024 } });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(await files(result.fs), input ? { xaa: Buffer.from(input).toString("hex") } : {});
      assert.ok(allocations.every(size => size <= 64 * 1024), `allocations: ${allocations}`);
    } finally {
      globalThis.Uint8Array = Original;
    }
  }
});

test("growing line-byte windows preserve retained records and reused input", async () => {
  const input = Buffer.from("a".repeat(70000) + "\n" + "b".repeat(40000) + "\n" + "c".repeat(110000));
  const result = await run(["-C100000"], chunks(input, 997, true));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await files(result.fs), {
    xaa: input.subarray(0, 70001).toString("hex"),
    xab: input.subarray(70001, 110002).toString("hex"),
    xac: input.subarray(110002, 210002).toString("hex"),
    xad: input.subarray(210002).toString("hex"),
  });
});
