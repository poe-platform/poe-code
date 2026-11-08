import {expect, it} from "vitest";
import {nextPrintTabStop, mirrorPrintTabRuns} from "./tab-layout.js";

it.each([[0, 18], [15.75, 18], [16.5, 36], [18, 36], [34.5, 54]] as const)(
  "leaves at least one space at the default tab stop after %s", (width, expected) => {
    expect(nextPrintTabStop(width, 18)).toBe(expected);
  });

it("matches native repeated RTL Hebrew tab-run glyph origins", () => {
  const glyphs = [0, 4.5, 18, 22.5, 27.75, 31.5, 54, 57.75].map(x => ({x}));
  mirrorPrintTabRuns(glyphs, [
    {start: 0, end: 9.75, first: 0, last: 2},
    {start: 18, end: 34.5, first: 2, last: 6},
    {start: 54, end: 60.75, first: 6, last: 8}
  ], 60.75, () => {});
  expect(glyphs.map(g => g.x)).toEqual([51, 55.5, 26.25, 30.75, 36, 39.75, 0, 3.75]);
});

it("checks cancellation before moving tab-run glyphs", () => {
  const glyphs = [{x: 0}];
  const error = new Error("cancelled");
  expect(() => mirrorPrintTabRuns(glyphs, [{start: 0, end: 3, first: 0, last: 1}], 10,
    () => {throw error;})).toThrow(error);
  expect(glyphs).toEqual([{x: 0}]);
});
