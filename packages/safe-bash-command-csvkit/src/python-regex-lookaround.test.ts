import { test } from "vitest";
import assert from "node:assert/strict";
import { compilePythonSearch } from "./python-regex.js";
import { CsvkitBlocked } from "./errors.js";

const search = (pattern: string) => compilePythonSearch(pattern, () => {}, 100_000, () => {});

for (const [pattern, accepted, rejected] of [
  ["foo(?=bar)", "foobar", "foobaz"],
  ["foo(?!bar)", "foobaz", "foobar"],
  ["(?<=foo)bar", "foobar", "xbar"],
  ["(?<!foo)bar", "xbar", "foobar"],
  ["(?<=ab|cd)e", "cde", "ace"],
  ["(?<=a{2})b", "aab", "ab"],
  ["(?=(?:a|ab))ab", "ab", "ac"],
  ["(?<=😀)b", "😀b", "xb"],
  ["(?<!x)^a", "a", "xa"],
  ["(?=a*)b", "b", "c"],
  [String.raw`\x61\u0062\U0001f600`, "ab😀", "abc"],
] as const) test(`Python bounded search ${pattern}`, () => {
  const match = search(pattern);
  assert.equal(match(accepted), true);
  assert.equal(match(rejected), false);
});

test("variable-width lookbehind remains an explicit diagnostic blocker", () => {
  for (const pattern of ["(?<=a*)b", "(?<=a|bc)d", "(?<=a{1,2})b"]) {
    assert.throws(() => search(pattern), CsvkitBlocked);
  }
});

test("parser nesting has no implicit resource ceiling", () => {
  assert.equal(search("(".repeat(100) + "a" + ")".repeat(100))("a"), true);
});

test("assertion transitions preserve the cancellation reason and work ceiling", () => {
  const reason = new Error("cancelled");
  let cancelled = false;
  const match = compilePythonSearch("(?=a)a", () => { if (cancelled) throw reason; }, 100, () => {});
  cancelled = true;
  assert.throws(() => match("a"), error => error === reason);
  assert.throws(() => compilePythonSearch("(?=a)a", () => {}, 1, () => {})("a"), CsvkitBlocked);
});

test("Python warning-producing sets remain blockers until stderr is qualified", () => {
  for (const pattern of ["[[]", "[a&&b]", "[a||b]", "[a~~b]"]) {
    assert.throws(() => search(pattern), CsvkitBlocked);
  }
  assert.equal(search("[^[]")("a"), true);
});
