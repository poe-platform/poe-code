import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./test-helpers.js";

const cases = [
  { input: '{"name":"build","cmd":]', detail: "Unmatched ']' in the middle of an object", path: ["cmd"], leaves: [[["name"], "build"]] },
  { input: '{"a":[1,2,}', detail: "Expected another key:value pair", path: ["a", 2], leaves: [[["a", 0], 1], [["a", 1], 2]] },
  { input: '{]', detail: "Unmatched ']' in the middle of an object", path: [null], leaves: [] },
  { input: ']', detail: "Unmatched ']' at the top-level", path: [], leaves: [] },
  { input: '[}', detail: "Unmatched '}' in the middle of an array", path: [0], leaves: [] },
  { input: '{"a":1,}', detail: "Expected another key:value pair", path: [null], leaves: [[["a"], 1]] },
];

for (const { input, detail, path, leaves } of cases) {
  const message = `${detail} at line 1, column ${input.length}`;
  for (const mode of ["--stream-errors", "--stream"]) {
    test(`${mode} reports container context for ${input}`, async () => {
      const result = await run(["-c", mode, "."], `${input}\n{"name":"next"}\n`);
      const recover = mode === "--stream-errors";
      const values = recover ? [...leaves, [message, path], [["name"], "next"], [["name"]]] : leaves;
      assert.equal(result.stdout, values.map(value => JSON.stringify(value) + "\n").join(""));
      assert.equal(result.stderr, recover ? "" : `jq: parse error: ${message}\n`);
      assert.equal(result.exitCode, recover ? 0 : 5);
    });
  }
}

for (const input of ['{"name":"build","cmd":]', '{"a":[1,2,}']) {
  test(`ordinary parsing keeps its delimiter diagnostic for ${input}`, async () => {
    const result = await run(["-c", "."], input);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `jq: parse error: Unmatched '${input.at(-1)}' at line 1, column ${input.length}\n`);
    assert.equal(result.exitCode, 5);
  });
}
