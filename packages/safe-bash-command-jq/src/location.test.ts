import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./test-helpers.js";

for (const [filter, expected] of [
  ['$__loc__', '{"file":"<top-level>","line":1}\n'],
  ['[\n$__loc__,\n# comment\n$__loc__\n]', '[{"file":"<top-level>","line":2},{"file":"<top-level>","line":4}]\n'],
  ['def location:\n$__loc__;\nlocation', '{"file":"<top-level>","line":2}\n'],
  ['"location: \\($__loc__.line)"', '"location: 1"\n'],
  ['{$__loc__}', '{"__loc__":{"file":"<top-level>","line":1}}\n'],
] as const) {
  test(`jq resolves source locations: ${filter}`, async () => {
    const result = await run(["-nc", filter]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected);
  });
}
