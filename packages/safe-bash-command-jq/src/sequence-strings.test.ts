import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./test-helpers.js";

test("sequence stream errors expose the interrupted string diagnostic and recover", async () => {
  const input = '\x1e"partial\x1e{"ok":true}\n';
  for (const source of [input, (async function* () {
    for (const byte of Buffer.from(input)) yield Uint8Array.of(byte);
  })()]) {
    const result = await run(["--seq", "--stream-errors", "-c", "."], source);
    assert.equal(result.stdout, '\x1e["Invalid numeric literal at line 1, column 10",[]]\n\x1e[["ok"],true]\n\x1e[["ok"]]\n');
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  }
});
