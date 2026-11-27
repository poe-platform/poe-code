import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./test-helpers.js";

test("now produces a number with null input", async () => {
  const result = await run(["-n", "now | type"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, '"number"\n');
});

test("now returns current epoch seconds and composes with date filters", async (t) => {
  t.mock.method(Date, "now", () => 1704067200125);
  const result = await run(["-c", "{ts: now, date: (now | todate)}"], '"ignored"');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, '{"ts":1704067200.125,"date":"2024-01-01T00:00:00Z"}\n');
});

test("now rejects arguments", async () => {
  const result = await run(["-n", "now(1)"]);
  assert.equal(result.exitCode, 3);
  assert.match(result.stderr, /now\/1 is not defined/);
});
