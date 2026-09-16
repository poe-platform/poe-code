import assert from "node:assert/strict";
import { describe, test } from "node:test";

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

describe("compiled byte-pipe readiness", { skip: selected === undefined ? "Requires a current public build and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  test("detached readiness observes bytes and drained EOF without consuming", async () => {
    const { createBytePipe } = await import("poe-code/safe-bash");
    const pipe = createBytePipe({ highWaterMark: 8 });
    const poll = pipe.readiness;
    const input = pipe.readable[Symbol.asyncIterator]();
    try {
      assert.equal(poll(), "blocked");
      await pipe.writable.write(Uint8Array.of(0, 255));
      assert.equal(poll(), "ready");
      assert.equal(poll(), "ready");
      await pipe.close();
      assert.equal(poll(), "ready");
      const first = await input.next();
      assert.equal(first.done, false);
      assert.deepEqual(first.value, Uint8Array.of(0, 255));
      assert.equal(poll(), "eof");
      assert.equal((await input.next()).done, true);
    } finally { await input.return?.(); await pipe.abort(); }
  });

  test("empty writes do not fabricate readiness", async () => {
    const { createBytePipe } = await import("poe-code/safe-bash");
    const pipe = createBytePipe();
    const input = pipe.readable[Symbol.asyncIterator]();
    try {
      await pipe.writable.write(new Uint8Array());
      assert.equal(pipe.readiness(), "blocked");
      await pipe.close();
      assert.equal(pipe.readiness(), "eof");
      assert.equal((await input.next()).done, true);
    } finally { await input.return?.(); await pipe.abort(); }
  });

  for (const reason of [false, 0, ""]) {
    test(`readiness preserves falsey abort reason ${JSON.stringify(reason)}`, async () => {
      const { createBytePipe } = await import("poe-code/safe-bash");
      const pipe = createBytePipe();
      const input = pipe.readable[Symbol.asyncIterator]();
      try {
        await pipe.abort(reason);
        assert.throws(() => pipe.readiness(), actual => actual === reason);
        await assert.rejects(input.next(), actual => actual === reason);
      } finally { await input.return?.(); }
    });
  }
});
