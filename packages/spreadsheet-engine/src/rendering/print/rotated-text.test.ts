import {expect, it} from "vitest";
import {rotatedPrintLayout} from "./rotated-text.js";

// Independently decoded Gnumeric 1.12.61 PDF origins; DejaVu Sans 10, 72x60pt cell.
it.each([
  [
    -90,
    false,
    28.5,
    24
  ],
  [
    -90,
    true,
    60.75,
    24
  ],
  [
    -45,
    false,
    26.25,
    27.75
  ],
  [
    -45,
    true,
    48,
    27.75
  ],
  [
    -30,
    false,
    27,
    29.25
  ],
  [
    -30,
    true,
    40.5,
    29.25
  ],
  [
    30,
    false,
    31.5,
    36
  ],
  [
    30,
    true,
    19.5,
    36
  ],
  [
    45,
    false,
    33,
    36.75
  ],
  [
    45,
    true,
    14.25,
    36.75
  ],
  [
    90,
    false,
    38.25,
    36.75
  ],
  [
    90,
    true,
    11.25,
    36.75
  ]
] as const)("matches native rotation %s with borders %s", (angle, bordered, x, y) => {
  const {origins: [origin]} = rotatedPrintLayout({angle, bordered, widths: [12.75], ascent: 1901 / 2048 * 7.5,
    lineHeight: 2384 / 2048 * 7.5, width: 72, height: 60, indent: 0, alignment: "center", vertical: "center"}, () => {});
  expect(origin!.x).toBeCloseTo(x, 5);
  expect(origin!.y).toBeCloseTo(y, 5);
});

it.each([
  [-45, false, [[12.75, 4.5], [-0.75, 7.5]]],
  [-45, true, [[15.75, 11.25], [2.25, 14.25]]],
  [45, false, [[7.5, 54], [24, 53.25]]]
] as const)("retains native horizontal placement before vertical justification at %s with borders %s", (angle, bordered, expected) => {
  const {origins} = rotatedPrintLayout({angle, bordered, ...(bordered ? {layoutWidth: 126 * Math.SQRT1_2} : {}), widths: [69.75, 65.25], ascent: 1901 / 2048 * 7.5,
    lineHeight: 2384 / 2048 * 7.5, width: 72, height: 60, indent: 0, alignment: "center", vertical: "justify"}, () => {});
  expect(origins.map(({x, y}) => [x, y])).toEqual(expected);
});
