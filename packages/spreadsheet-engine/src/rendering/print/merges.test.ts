import {expect, it} from "vitest";
import {createPrintMerges} from "./merges.js";
it("indexes huge rectangles without expanding cells or rows", () => {
  let work = 0;
  const ranges = [{startRow: 0, startColumn: 0, endRow: 1048575, endColumn: 16383},
    {startRow: 2000000, startColumn: 0, endRow: 2000002, endColumn: 3}];
  const index = createPrintMerges(ranges, (amount = 1) => {work += amount; if (work > 100) throw new Error("excess work");});
  expect(index(1000000)).toEqual([ranges[0]]);
  expect(index(1500000)).toEqual([]);
  expect(index(2000001)).toEqual([ranges[1]]);
});
it("propagates cancellation while querying retained merge intervals", () => {
  let stop = false;
  const reason = new Error("stop");
  const index = createPrintMerges([{startRow: 0, startColumn: 0, endRow: 5, endColumn: 3}], () => {if (stop) throw reason;});
  stop = true;
  expect(() => index(2)).toThrow(reason);
});
