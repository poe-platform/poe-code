import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./test-helpers.js";

for (const [filter, expected] of [
  ['.scripts | keys | del(.[1:3], .[2:4])', '["build","typecheck"]\n'],
  ['.scripts | keys | del(.[1], .[0:2])', '["test","test:unit","typecheck"]\n'],
  ['{items: (.scripts | keys)} | del(.items[1:3], .items[2:4])', '{"items":["build","typecheck"]}\n'],
]) {
  test(`jq ${filter} preserves elements outside the original deletion paths`, async () => {
    const result = await run(["-c", filter!], JSON.stringify({
      scripts: { build: "", lint: "", test: "", "test:unit": "", typecheck: "" },
    }));
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected);
  });
}
