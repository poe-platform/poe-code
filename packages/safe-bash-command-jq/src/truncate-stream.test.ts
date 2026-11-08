import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { run } from "./test-helpers.js";

const nested = '{"a":[1,{"b":[true,null,{},[]]}],"c":2}\n[[],{"x":3},4]\nnull\n{}\n[]';
const cases = [
  { args: ["-cn", "--stream", "0|truncate_stream(inputs)"], input: '{"a":1}\n' },
  ...[0, 1, 2, 3, 10].map(depth => ({
    args: ["-cn", "--stream", `${depth}|truncate_stream(inputs)`], input: nested,
  })),
  { args: ["-cn", '1|truncate_stream(([["a"],1],[["a","b"],2],[["a","b"]],[["a"]]))'], input: "" },
  { args: ["-cn", '2|truncate_stream(([[0,1,2],.]))'], input: "" },
  { args: ["-cn", "0|truncate_stream(empty)"], input: "" },
  { args: ["-cn", 'first(0|truncate_stream(([["a"],1],error("unreachable"))))'], input: "" },
  { args: ["-cn", "--stream", "fromstream(1|truncate_stream(inputs))"], input: nested },
];

for (const entry of cases) test(`truncate_stream matches native jq: ${JSON.stringify(entry)}`, async () => {
  const native = spawnSync("jq", entry.args, { input: entry.input, encoding: "utf8" });
  assert.equal(native.error, undefined);
  assert.equal(native.status, 0, native.stderr);
  const result = await run(entry.args, entry.input);
  assert.equal(result.exitCode, native.status, result.stderr);
  assert.equal(result.stdout, native.stdout);
  assert.equal(result.stderr, native.stderr);
});
