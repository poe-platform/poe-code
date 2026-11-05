import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { run } from "./test-helpers.js";

for (const filter of [
  "[1,2]|tostream",
  '{"a":[1,{"b":[true,null,{},[]]}],"c":2}|tostream',
  '[{"a":[1,2]},[],{}]|tostream',
  '(null,false,true,42,"text",{},[])|tostream',
  '{"2":1,"1":2,"__proto__":3,"":4}|tostream',
  'fromstream(({"a":[1,{},[]]},null,[])|tostream)',
  'first([range(100)]|tostream)',
]) test(`tostream matches native jq: ${filter}`, async () => {
  const native = spawnSync("jq", ["-cn", filter], { encoding: "utf8" });
  assert.equal(native.error, undefined);
  assert.equal(native.status, 0, native.stderr);
  const result = await run(["-cn", filter]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, native.stdout);
  assert.equal(result.stderr, "");
});

test("tostream accounts for event values inside optional filters", async () => {
  const result = await run(["-c", "tostream?"], '{"a":{"b":{"c":1}}}', { limits: { maxCollectionSize: 2 } });
  assert.equal(result.exitCode, 5, result.stderr);
  assert.match(result.stderr, /maxCollectionSize/);
});
