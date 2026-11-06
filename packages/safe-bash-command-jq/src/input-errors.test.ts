import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./test-helpers.js";

for (const filter of ["input", "[inputs]"]) {
  test(`catch receives the native parse error value from ${filter}`, async () => {
    const result = await run(["-cn", `try ${filter} catch .`], '{"name":]\n');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, JSON.stringify("Unmatched ']' at line 1, column 9") + "\n");
  });
}

test("uncaught JSON input errors retain the CLI diagnostic", async () => {
  const result = await run(["-c", "."], '{"name":]\n');
  assert.equal(result.exitCode, 5);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "jq: parse error: Unmatched ']' at line 1, column 9\n");
});
