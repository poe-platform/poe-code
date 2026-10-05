import { describe, expect, it } from "vitest";
import { parsePdftkRangeToken } from "./index.js";

const handles = new Map([
  ["A", { pageCount: 2 }],
  ["B", { pageCount: 4 }],
  ["BE", { pageCount: 3 }],
]);

describe("single-letter page rotations", () => {
  for (const [suffix, kind, degrees] of [
    ["N", "absolute", 0], ["E", "absolute", 90],
    ["S", "absolute", 180], ["W", "absolute", 270],
    ["R", "relative", 90], ["L", "relative", -90],
    ["D", "relative", 180],
  ] as const) {
    for (const letter of [suffix, suffix.toLowerCase()]) {
      for (const qualifier of ["", "even", "odd"]) {
        it(`selects all matching B pages for B${qualifier}${letter}`, () => {
          const selected = parsePdftkRangeToken(`B${qualifier}${letter}`, new Map([...handles].slice(0, 2)), "A");
          const pages = qualifier === "even" ? [2, 4] : qualifier === "odd" ? [1, 3] : [1, 2, 3, 4];
          expect(selected).toEqual(pages.map(pageNumber => ({
            handle: "B", pageNumber, rotation: { kind, degrees },
          })));
        });
      }
    }
  }

  it("prefers a complete longer handle over a rotation suffix", () => {
    expect(parsePdftkRangeToken("BE", handles, "A")).toEqual(
      [1, 2, 3].map(pageNumber => ({ handle: "BE", pageNumber, rotation: undefined }))
    );
    expect(parsePdftkRangeToken("BEE", handles, "A")).toEqual(
      [1, 2, 3].map(pageNumber => ({ handle: "BE", pageNumber, rotation: { kind: "absolute", degrees: 90 } }))
    );
  });

  it("accepts rotation before the page qualifier", () => {
    expect(parsePdftkRangeToken("BEeven", new Map([...handles].slice(0, 2)), "A")).toEqual(
      [2, 4].map(pageNumber => ({ handle: "B", pageNumber, rotation: { kind: "absolute", degrees: 90 } }))
    );
  });
});
