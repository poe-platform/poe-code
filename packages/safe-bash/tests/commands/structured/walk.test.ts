import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { run } from "./helpers.js";
import { agentCommands, createMemoryFileSystem, Shell } from "../../../src/index.js";

test("walk reproducer through the public shell", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try {
    const result = await shell.exec('jq -c \'walk(if type == "number" then .+1 else . end)\'', { stdin: '{"a":[1,2]}\n' });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '{"a":[2,3]}\n');
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

const cases = [
  ['{"a":[1,2]}\n', 'walk(if type == "number" then .+1 else . end)'],
  ['[3,[2,1],{"a":[4,1]}]', 'walk(if type == "array" then sort else . end)'],
  ['{"a":1,"b":[2,3]}', 'walk(if type == "number" then (.,.+10) else . end)'],
  ['{"a":1,"b":[2,3]}', 'walk(if type == "number" then empty else . end)'],
  ['null', 'walk(type)'],
  ['1', 'walk((.,.+1))'],
  ['{"__proto__":1,"constructor":2}', 'walk(.)'],
  ['[1]', 'walk(error("bad"))'],
  ['[1]', 'walk'],
  ['[1]', 'walk(.;.)'],
  ['[1]', 'walk(if type == "number" then (1,error("later")) else . end)'],
  ['{"a":1}', 'walk(if type == "number" then (1,error("later")) else . end)'],
  ['{"a":[1]}', 'walk(if type == "array" then {count:length} else . end)'],
];

for (const [input, filter] of cases) test(`walk native parity: ${filter} on ${input}`, async () => {
  const native = spawnSync("/usr/bin/jq", ["-c", filter!], { input, encoding: "utf8" });
  assert.equal(native.error, undefined);
  assert.equal(native.signal, null);
  const actual = await run(["-c", filter!], input!);
  assert.equal(actual.exitCode, native.status);
  assert.equal(actual.stdout, native.stdout);
  assert.equal(actual.stderr, native.stderr);
});

test("walk respects work and collection budgets", async () => {
  const work = await run(["-c", "walk(.)"], '[1,2,3]', { limits: { maxSteps: 10 } });
  assert.equal(work.exitCode, 5);
  assert.ok(work.stderr.includes("maxSteps limit exceeded"));
  const collection = await run(["-c", "walk(if type == \"number\" then (.,.) else . end)"], '[1]', { limits: { maxCollectionSize: 1 } });
  assert.equal(collection.exitCode, 5);
  assert.ok(collection.stderr.includes("maxCollectionSize limit exceeded"));
});
