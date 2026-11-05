import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { run } from "./test-helpers.js";

for (const input of ["{}", "{}\n", "", " \t\n", "\x1e{}\n", "ignored\x1e{}\n", "\x1e{bad}\n"]) {
  test(`jq sequence framing matches native jq: ${JSON.stringify(input)}`, async () => {
    const args = ["-c", "--seq", "."];
    const native = spawnSync("jq", args, { input, encoding: "utf8" });
    assert.equal(native.error, undefined);
    assert.equal(native.signal, null);
    for (const source of [input, (async function* () {
      for (const byte of Buffer.from(input)) yield Uint8Array.of(byte);
    })()]) {
      const result = await run(args, source);
      assert.deepEqual(
        { stdout: result.stdout, stderr: result.stderr, status: result.exitCode },
        { stdout: native.stdout, stderr: native.stderr, status: native.status },
      );
    }
  });
}
