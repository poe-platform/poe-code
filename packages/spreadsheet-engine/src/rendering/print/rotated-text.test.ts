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

// Native RTL Fill uses the repeated, unrotated width for horizontal placement.
// PDF page origins subtract the 72pt margin and the painter's 2.5pt x inset.
it.each([
  [10, 22.5, 67.5, 6.75, 58.5],
  [10, 28.5, 57, 17.25, 58.5],
  [14, 32.25, 64.5, 12, 57.75],
  [14, 41.25, 41.25, 35.25, 57.75]
] as const)("positions native rotated RTL Fill at font size %s and width %s", (size, naturalWidth, repeatedWidth, x, y) => {
  const options = {angle: 45, bordered: false, widths: [naturalWidth], ascent: 1901 / 2048 * size * 0.75,
    lineHeight: 2384 / 2048 * size * 0.75, width: 72, height: 60, indent: 0,
    alignment: "right" as const, vertical: "bottom" as const, horizontalWidth: repeatedWidth};
  expect(rotatedPrintLayout(options, () => {}).origins).toEqual([{x, y}]);
});
