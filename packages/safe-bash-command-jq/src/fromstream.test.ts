import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { run } from "./test-helpers.js";

const cases = [
  { args: ["-cn", "--stream", "fromstream(inputs)"], input: '{"a":1}\n' },
  { args: ["-cn", "--stream", "fromstream(inputs)"], input: '{"a":[1,{"b":[true,null,{},[]]}],"c":2}\n[[],{"x":3},4]\nnull\nfalse\n42\n"text"\n{}\n[]' },
  { args: ["-c", "fromstream(.[])"], input: '[[["a",0],1],[["a",1,"b"],2],[["a",1,"b"]],[["a",1]],[["a"]]]' },
  { args: ["-cn", 'fromstream(([["a"],1],[["a"]],[[],2],[[0],3],[[0]]))'], input: "" },
  { args: ["-cn", 'fromstream(([["a"],1]))'], input: "" },
  { args: ["-cn", 'fromstream(empty)'], input: "" },
  { args: ["-cn", 'first(fromstream(([[],1],error("unreachable"))))'], input: "" },
];

for (const entry of cases) test(`fromstream matches native jq: ${JSON.stringify(entry)}`, async () => {
  const native = spawnSync("jq", entry.args, { input: entry.input, encoding: "utf8" });
  assert.equal(native.error, undefined);
  assert.equal(native.status, 0, native.stderr);
  const result = await run(entry.args, entry.input);
  assert.equal(result.exitCode, native.status, result.stderr);
  assert.equal(result.stdout, native.stdout);
  assert.equal(result.stderr, native.stderr);
});

test("fromstream bounds reconstructed values even inside optional filters", async () => {
  const result = await run(["-cn", 'fromstream(([[100],1],[[100]]))?'], "", { limits: { maxCollectionSize: 10 } });
  assert.equal(result.exitCode, 5, result.stderr);
  assert.match(result.stderr, /maxCollectionSize/);
});
