import assert from "node:assert/strict";
import { test } from "node:test";
import { createYqQuerySession } from "./query-core.js";

for (const [source, input, expected] of [
  ['test("b")', "abc", [true]], ['test("B";"i")', "abc", [true]],
  ['match("b") | .offset', "abc", [1]], ['match("B";"i") | .string', "abc", ["b"]],
  ['sub("b";"X")', "abb", ["aXb"]], ['sub("B";"X";"i")', "abb", ["aXb"]],
  ['scan("B";"i")', "abb", ["b","b"]],
  ['split("B+";"i")', "abbc", [["a","c"]]],
  ['splits("B+";"i")', "abbc", ["a","c"]],
  ['implode', [128512, 97], ["😀a"]],
  ['index("bc")', "abcbc", [1]], ['rindex("bc")', "abcbc", [3]],
  ['test("[😀]")', "😀", [true]], ['test("[😀-🙏]")', "😁", [true]],
] as const) test(`builtin ${source}`, async () => {
  const session = createYqQuerySession({ signal: new AbortController().signal });
  try {
    session.compileOnce(source);
    const result = [];
    for await (const value of session.run(input as never)) result.push(value);
    assert.deepEqual(result, expected);
  } finally { await session.close(); }
});
