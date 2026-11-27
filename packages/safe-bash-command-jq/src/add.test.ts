import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./test-helpers.js";

test("add sums object values through the public command", async () => {
  const result = await run(["-c", "add"], '{"a":1,"b":2}\n');
  assert.equal(result.stdout, "3\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("add preserves object insertion order including numeric keys", async () => {
  const result = await run(["-c", "add"], '{"2":"first","1":"second"}\n');
  assert.equal(result.stdout, '"firstsecond"\n');
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});
