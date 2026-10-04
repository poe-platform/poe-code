import assert from "node:assert/strict";
import { it } from "node:test";
import { iterateQpdfPageRange, parseQpdfPageRange } from "./index.js";

for (const [spec, expected] of [
  ["", []], ["1-z", [1, 2, 3, 4, 5, 6]], ["z-1:even", [5, 3, 1]],
  ["1-z,x2-4", [1, 5, 6]], ["1-3,x2,2", [1, 3, 2]],
  ["1-z,x2-5:even", [1, 2, 4, 6]], ["1-z,2:odd", [1, 3, 5, 2]],
  ["1-z,2:odd,x1-3", [4, 6]], ["1:even,2-4", [2, 4]],
  ["r1-r3", [6, 5, 4]], ["1-z,x3:even", [1, 2, 4, 5, 6]], ["1,1,2", [1, 1, 2]],
] as const) it(`iterates range ${spec} with compatible ordering and exclusions`, () => {
  assert.deepEqual([...iterateQpdfPageRange(spec, 6)], [...expected]);
  assert.deepEqual(parseQpdfPageRange(spec, 6), [...expected]);
});

it("produces a prefix of a huge selection without expanding its pages", () => {
  const range = iterateQpdfPageRange("1-z,x2-100000000:even", 100000000);
  assert.deepEqual([range.next().value, range.next().value, range.next().value], [1, 2, 4]);
  range.return(undefined);
});

for (const spec of ["0", "r0", "7", "1-", "1, x2", "1, ,2"]) it(`preserves invalid range diagnostics for ${spec}`, () => {
  let expected: unknown; try { parseQpdfPageRange(spec, 6); } catch (error) { expected = error; }
  assert.ok(expected instanceof Error);
  assert.throws(() => [...iterateQpdfPageRange(spec, 6)], error => error instanceof Error && error.message === expected.message);
});
