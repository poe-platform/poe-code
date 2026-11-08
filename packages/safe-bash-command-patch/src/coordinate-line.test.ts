import assert from "node:assert/strict";
import test from "node:test";
import { toByteSource, type CommandContext } from "safe-bash-contracts";
import { Budget } from "safe-bash-diff-engine/shared";
import { coordinateLine } from "./coordinate-line.js";
import { contents, filesystem, run } from "./helpers.test.js";

for (const failure of ["none", "read", "cancel"]) test(`coordinate scan bounds retained state and closes reused source: ${failure}`, async () => {
  const fs = await filesystem(), controller = new AbortController(), reason = new Error("coordinate source stopped");
  const context: CommandContext = { fs, cwd: "/work", env: {}, command: "patch", args: [], signal: controller.signal,
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} } };
  let closed = false;
  const input = { length: 1, async read() { assert.fail("whole coordinate read"); }, async body() {
    return { size: 1_000_000, terminated: false, bytes: { async *[Symbol.asyncIterator]() {
      const bytes = new Uint8Array(16384).fill(48);
      try {
        for (let index = 0; index < 16; index++) yield bytes;
        if (failure === "read") throw reason;
        if (failure === "cancel") controller.abort(reason);
        bytes.set(new TextEncoder().encode("1c1")); yield bytes.subarray(0, 3);
      } finally { bytes.fill(0); closed = true; }
    } } };
  } };
  const result = coordinateLine(input, 0, new Budget(context, {}));
  if (failure === "none") {
    const parsed = await result;
    assert.equal(parsed.shape, "0c0");
    assert.deepEqual(parsed.fields.map(field => field.value), [1, 1]);
    assert.ok(parsed.fields.every(field => field.prefix.length <= 1001));
  } else await assert.rejects(result, error => error === reason);
  assert.equal(closed, true);
});

for (const format of ["normal", "context"]) {
  for (const malformed of [false, true]) test(`${format} overflow preserves public diagnostics and grammar precedence: ${malformed}`, async () => {
    const fs = await filesystem({ target: "old\n" }), number = "0".repeat(16384) + "9007199254740992";
    const input = format === "normal" ? `${number}c1${malformed ? "x" : ""}\n< old\n---\n> new\n`
      : `*** target\n--- target\n***************\n*** ${number} ****${malformed ? "x" : ""}\n! old\n--- 1 ----\n! new\n`;
    const result = await run("patch", ["target"], { fs, input });
    const message = malformed ? format === "normal" ? "malformed normal patch command" : "malformed context range" : `invalid patch range: ${number}`;
    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr, `patch: ${message.length > 1000 ? message.slice(0, 1000) + "…" : message}\n`);
    assert.equal(await contents(fs, "target"), "old\n");
  });
}
