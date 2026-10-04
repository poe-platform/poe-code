import assert from "node:assert/strict";
import test from "node:test";
import { Pattern } from "./text/regex.js";

const budget = { maxBufferBytes: Infinity, step() {}, checkpoint() {} };
test("caller-stored matching preserves backreferences and nullable capture loops", async () => {
  for (const expression of ["(a)\\1", "^(.*)\\1$", "(a|b)+\\1", "(a*)*b\\1", "((a)?b)*\\2", "(😀+)\\1", "\\b(a+)\\1\\b", "(a?)\\1*", "(ab|a)\\1$"]) {
    for (const input of ["", "a", "aa", "ab", "aaaa", "abab", "aabaaa", "bb", "abb", "😀😀", "x😀😀y", " aa ", "\n\n"]) {
      const states: number[][] = [], seen = new Set<string>();
      const pattern = new Pattern(expression);
      assert.equal(await pattern.supportsStoredTest(budget), true);
      const result = await pattern.testStored({ length: input.length,
        async read(start, length) { assert.ok(length <= 4096); return input.slice(start, start + length); },
        async enqueue(state) { const key = JSON.stringify(state); if (!seen.has(key)) { seen.add(key); states.push([...state]); } },
        async dequeue() { return states.shift(); },
      }, budget);
      assert.equal(result, !!await pattern.find(input, budget), JSON.stringify({ expression, input }));
    }
  }
});
