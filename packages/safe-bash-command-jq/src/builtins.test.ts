import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./test-helpers.js";

test("builtins lists supported functions and their arities through the public command", async () => {
  const result = await run(["-cn", "builtins"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  const names: string[] = JSON.parse(result.stdout);
  assert.equal(new Set(names).size, names.length);
  for (const name of ["builtins/0", "length/0", "range/1", "range/2", "range/3", "match/1", "match/2", "env/0"]) {
    assert.ok(names.includes(name), name);
  }
  for (const name of ["range/0", "length/1", "builtins/1", "input/0", "now/0"]) {
    assert.ok(!names.includes(name), name);
  }
});

test("builtins ignores input and excludes user definitions", async () => {
  const result = await run(["-c", 'def custom: 1; [builtins[] | select(startswith("range/") or startswith("custom/"))] | sort'], 'null\n{"a":1}');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, '["range/1","range/2","range/3"]\n'.repeat(2));
});

test("builtins rejects arguments before reading input", async () => {
  const stdin = { [Symbol.asyncIterator](): never { throw new Error("unexpected input read"); } };
  const result = await run(["builtins(1)"], stdin);
  assert.equal(result.exitCode, 3);
  assert.match(result.stderr, /builtins\/1 is not defined/);
});

test("builtins respects collection and value limits even under optional evaluation", async () => {
  for (const limits of [{ maxCollectionSize: 2 }, { maxValueBytes: 32 }]) {
    const result = await run(["-cn", "builtins?"], "", { limits });
    assert.equal(result.exitCode, 5, result.stderr);
    assert.match(result.stderr, /limit exceeded/);
  }
});
