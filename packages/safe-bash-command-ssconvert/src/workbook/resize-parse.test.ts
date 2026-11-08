import { expect, it } from "vitest";
import { parseResize, suggestSheetSize } from "./resize.js";

it.each([
  ["128x256tail", { rows: 128, columns: 256 }], [" \n+256x\t+128rest", { rows: 256, columns: 128 }],
  ["-128x0", { rows: -128, columns: 0 }], ["128X128", undefined], ["128 x128", undefined],
  ["128x", undefined], ["128x0x3", { rows: 128, columns: 0 }], ["0x128x256", { rows: 0, columns: 128 }]
])("matches stable sscanf acceptance for %s", (text, expected) => expect(parseResize(text as string)).toEqual(expected));

it("suggests bounded power-of-two sizes with the reference default lower bound", () => {
  expect(suggestSheetSize({ rows: 1, columns: 1 })).toEqual({ rows: 65536, columns: 256 });
  expect(suggestSheetSize({ rows: 65537, columns: 257 })).toEqual({ rows: 131072, columns: 512 });
  expect(suggestSheetSize({ rows: 999999999, columns: 999999 })).toEqual({ rows: 16777216, columns: 16384 });
});
