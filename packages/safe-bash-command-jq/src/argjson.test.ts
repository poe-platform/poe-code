import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./test-helpers.js";

for (const fileArgs of [[], ["--rawfile", "file", "/unused"], ["--slurpfile", "file", "/unused"]]) {
  test(`jq invalid --argjson prints the command-line diagnostic (${fileArgs[0] ?? "normal"})`, async () => {
    const result = await run(["-cn", "--argjson", "n", "notjson", "$n", ...fileArgs], {
      [Symbol.asyncIterator]() { throw new Error("must not read stdin"); },
    });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    const lines = result.stderr.split("\n");
    assert.equal(lines[0], "jq: invalid JSON text passed to --argjson");
    assert.equal(lines[1], "Use jq --help for help with command-line options,");
    assert.ok(lines[2]?.startsWith("or see the jq manpage, or online docs  at https://"), result.stderr);
    assert.deepEqual(lines.slice(3), [""]);
  });
}
