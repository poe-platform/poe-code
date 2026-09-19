import assert from "node:assert/strict";
import { test } from "vitest";
import { compilePythonSearch } from "./python-regex.js";
import { CsvkitBlocked } from "./errors.js";

// Original observations independently checked against the frozen CPython 3.14.2
// executable. Canonical replay is entirely in memory and never launches it.
const observations: readonly (readonly [string, string, boolean])[] = [
  ["(?:){2}", "", true],
  ["(?:a?){2}a", "a", true],
  ["(?:a?)*b", "aab", true],
  ["(?:a?)*b", "aaa", false],
  ["(?:a?)+b", "b", true],
  ["(?:a?){2,4}b", "b", true],
  ["(?:a?){2,4}b", "aaab", true],
  ["(?:a?){2,4}b", "aaaaab", true],
  ["^(?:a?){2,4}b$", "aaaaab", false],
  ["(?:a|)*b", "aab", true],
  ["(?:a|)*b", "aaa", false],
  ["\\B", "", true],
  ["\\b", "", false],
  ["a{0}b", "b", true],
  ["(?m)^b$", "a\nb\nc", true],
  ["[\ue000-😀]", "😀", true],
  ["[\ue000-😀]", "\ue000", true],
  ["[\ue000-😀]", "a", false],
  ["(?=a){2}a", "a", true],
  ["(?!a){2}b", "b", true],
  ["(?<=😀)x", "😀x", true],
  ["(?<!😀)x", "x", true],
  ["(?<=a|b)x", "bx", true],
  ["(?<=(?=a))a", "a", true],
  ["(?<=(?:){2})x", "x", true],
  ["(?<=a(?=b))b", "ab", true],
  ["(?<!a(?=b))b", "ab", false],
  ["(?=a)*b", "b", true],
  ["\\x41\\u03b1\\U0001F600", "Aα😀", true],
  ["(?<=(?=a)*)a", "a", true],
  ["(?<=a{2147483648})x", "a", false],
  ["(?aa)a", "a", true],
  ["(?uu)a", "a", true]
];

for (const [pattern, text, expected] of observations) {
  test(`Python regex original stress ${JSON.stringify([pattern, text])}`, () => {
    const search = compilePythonSearch(pattern, () => {}, 100_000, () => {});
    assert.equal(search(text), expected);
  });
}

test("Python reversed astral-to-BMP ranges are refused instead of silently misparsed", () => {
  // CPython rejects this with "bad character range 😀-\ue000 at position 1".
  // Until exact invalid-pattern diagnostics are implemented this must be a
  // visible blocker, never a successful compilation with different semantics.
  assert.throws(() => compilePythonSearch("[😀-\ue000]", () => {}, 100_000, () => {}), CsvkitBlocked);
});

test("Python regex empty-match repetition still observes caller cancellation", () => {
  const cancellation = new Error("cancelled by host");
  let calls = 0;
  const search = compilePythonSearch("(?:){1000}", () => {
    if (++calls === 50) throw cancellation;
  }, 100_000, () => {});
  assert.throws(() => search(""), error => error === cancellation);
});

test("Python regex impossible empty-match repetitions explicitly refuse bounded host work", () => {
  const search = compilePythonSearch("(?:){1000}x", () => {}, 100, () => {});
  assert.throws(() => search(""), error => error instanceof CsvkitBlocked && error.message.includes("work budget exceeded"));
});

test("Python regex quantifier overflow is refused before silently accepting invalid patterns", () => {
  // Frozen CPython raises OverflowError: the repetition number is too large.
  for (const pattern of ["a{0,4294967295}", "(?:){0,4294967295}"]) {
    assert.throws(() => compilePythonSearch(pattern, () => {}, 100_000, () => {}), CsvkitBlocked);
  }
});
