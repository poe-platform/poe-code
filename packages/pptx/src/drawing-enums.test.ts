import { expect, it } from "vitest";
import {
  MSO_FILL,
  MSO_FILL_TYPE,
  MSO_LINE,
  MSO_LINE_DASH_STYLE,
  MSO_PATTERN,
  MSO_PATTERN_TYPE,
  patternTokens,
  dashTokens
} from "./drawing-enums.js";
it("retains numeric fill symbols and aliases", () => {
  expect(MSO_FILL).toBe(MSO_FILL_TYPE);
  expect(MSO_FILL).toEqual({
    SOLID: 1,
    PATTERNED: 2,
    GRADIENT: 3,
    TEXTURED: 4,
    BACKGROUND: 5,
    PICTURE: 6,
    GROUP: 101
  });
});
it("retains line symbols and XML mappings", () => {
  expect(MSO_LINE).toBe(MSO_LINE_DASH_STYLE);
  expect(MSO_LINE.DASH_DOT_DOT).toBe(6);
  expect(dashTokens[6]).toBe("lgDashDotDot");
  expect(dashTokens[3]).toBe("sysDot");
  expect(dashTokens[2]).toBe("sysDash");
  expect(dashTokens[-2]).toBeUndefined();
});
it("retains all pattern symbols and corrected percentage symbol", () => {
  expect(MSO_PATTERN).toBe(MSO_PATTERN_TYPE);
  expect(Object.keys(MSO_PATTERN)).toHaveLength(55);
  expect(new Set(Object.values(MSO_PATTERN)).size).toBe(55);
  expect(MSO_PATTERN.PERCENT_40).toBe(6);
  expect(patternTokens[6]).toBe("pct40");
  expect(MSO_PATTERN.CROSS).toBe(51);
  expect(patternTokens[51]).toBe("cross");
  expect(patternTokens[-2]).toBeUndefined();
  expect(Object.isFrozen(MSO_PATTERN)).toBe(true);
  expect(Object.isFrozen(patternTokens)).toBe(true);
});

it.each([
  ["MSO_FILL_TYPE", "BACKGROUND", 5, null],
  ["MSO_FILL_TYPE", "GRADIENT", 3, null],
  ["MSO_FILL_TYPE", "GROUP", 101, null],
  ["MSO_FILL_TYPE", "PATTERNED", 2, null],
  ["MSO_FILL_TYPE", "PICTURE", 6, null],
  ["MSO_FILL_TYPE", "SOLID", 1, null],
  ["MSO_FILL_TYPE", "TEXTURED", 4, null],
  ["MSO_LINE_DASH_STYLE", "DASH", 4, "dash"],
  ["MSO_LINE_DASH_STYLE", "DASH_DOT", 5, "dashDot"],
  ["MSO_LINE_DASH_STYLE", "DASH_DOT_DOT", 6, "lgDashDotDot"],
  ["MSO_LINE_DASH_STYLE", "DASH_STYLE_MIXED", -2, ""],
  ["MSO_LINE_DASH_STYLE", "LONG_DASH", 7, "lgDash"],
  ["MSO_LINE_DASH_STYLE", "LONG_DASH_DOT", 8, "lgDashDot"],
  ["MSO_LINE_DASH_STYLE", "ROUND_DOT", 3, "sysDot"],
  ["MSO_LINE_DASH_STYLE", "SOLID", 1, "solid"],
  ["MSO_LINE_DASH_STYLE", "SQUARE_DOT", 2, "sysDash"],
  ["MSO_PATTERN_TYPE", "CROSS", 51, "cross"],
  ["MSO_PATTERN_TYPE", "DARK_DOWNWARD_DIAGONAL", 15, "dkDnDiag"],
  ["MSO_PATTERN_TYPE", "DARK_HORIZONTAL", 13, "dkHorz"],
  ["MSO_PATTERN_TYPE", "DARK_UPWARD_DIAGONAL", 16, "dkUpDiag"],
  ["MSO_PATTERN_TYPE", "DARK_VERTICAL", 14, "dkVert"],
  ["MSO_PATTERN_TYPE", "DASHED_DOWNWARD_DIAGONAL", 28, "dashDnDiag"],
  ["MSO_PATTERN_TYPE", "DASHED_HORIZONTAL", 32, "dashHorz"],
  ["MSO_PATTERN_TYPE", "DASHED_UPWARD_DIAGONAL", 27, "dashUpDiag"],
  ["MSO_PATTERN_TYPE", "DASHED_VERTICAL", 31, "dashVert"],
  ["MSO_PATTERN_TYPE", "DIAGONAL_BRICK", 40, "diagBrick"],
  ["MSO_PATTERN_TYPE", "DIAGONAL_CROSS", 54, "diagCross"],
  ["MSO_PATTERN_TYPE", "DIVOT", 46, "divot"],
  ["MSO_PATTERN_TYPE", "DOTTED_DIAMOND", 24, "dotDmnd"],
  ["MSO_PATTERN_TYPE", "DOTTED_GRID", 45, "dotGrid"],
  ["MSO_PATTERN_TYPE", "DOWNWARD_DIAGONAL", 52, "dnDiag"],
  ["MSO_PATTERN_TYPE", "HORIZONTAL", 49, "horz"],
  ["MSO_PATTERN_TYPE", "HORIZONTAL_BRICK", 35, "horzBrick"],
  ["MSO_PATTERN_TYPE", "LARGE_CHECKER_BOARD", 36, "lgCheck"],
  ["MSO_PATTERN_TYPE", "LARGE_CONFETTI", 33, "lgConfetti"],
  ["MSO_PATTERN_TYPE", "LARGE_GRID", 34, "lgGrid"],
  ["MSO_PATTERN_TYPE", "LIGHT_DOWNWARD_DIAGONAL", 21, "ltDnDiag"],
  ["MSO_PATTERN_TYPE", "LIGHT_HORIZONTAL", 19, "ltHorz"],
  ["MSO_PATTERN_TYPE", "LIGHT_UPWARD_DIAGONAL", 22, "ltUpDiag"],
  ["MSO_PATTERN_TYPE", "LIGHT_VERTICAL", 20, "ltVert"],
  ["MSO_PATTERN_TYPE", "MIXED", -2, ""],
  ["MSO_PATTERN_TYPE", "NARROW_HORIZONTAL", 30, "narHorz"],
  ["MSO_PATTERN_TYPE", "NARROW_VERTICAL", 29, "narVert"],
  ["MSO_PATTERN_TYPE", "OUTLINED_DIAMOND", 41, "openDmnd"],
  ["MSO_PATTERN_TYPE", "PERCENT_10", 2, "pct10"],
  ["MSO_PATTERN_TYPE", "PERCENT_20", 3, "pct20"],
  ["MSO_PATTERN_TYPE", "PERCENT_25", 4, "pct25"],
  ["MSO_PATTERN_TYPE", "PERCENT_30", 5, "pct30"],
  ["MSO_PATTERN_TYPE", "PERCENT_5", 1, "pct5"],
  ["MSO_PATTERN_TYPE", "PERCENT_50", 7, "pct50"],
  ["MSO_PATTERN_TYPE", "PERCENT_60", 8, "pct60"],
  ["MSO_PATTERN_TYPE", "PERCENT_70", 9, "pct70"],
  ["MSO_PATTERN_TYPE", "PERCENT_75", 10, "pct75"],
  ["MSO_PATTERN_TYPE", "PERCENT_80", 11, "pct80"],
  ["MSO_PATTERN_TYPE", "PERCENT_90", 12, "pct90"],
  ["MSO_PATTERN_TYPE", "PLAID", 42, "plaid"],
  ["MSO_PATTERN_TYPE", "SHINGLE", 47, "shingle"],
  ["MSO_PATTERN_TYPE", "SMALL_CHECKER_BOARD", 17, "smCheck"],
  ["MSO_PATTERN_TYPE", "SMALL_CONFETTI", 37, "smConfetti"],
  ["MSO_PATTERN_TYPE", "SMALL_GRID", 23, "smGrid"],
  ["MSO_PATTERN_TYPE", "SOLID_DIAMOND", 39, "solidDmnd"],
  ["MSO_PATTERN_TYPE", "SPHERE", 43, "sphere"],
  ["MSO_PATTERN_TYPE", "TRELLIS", 18, "trellis"],
  ["MSO_PATTERN_TYPE", "UPWARD_DIAGONAL", 53, "upDiag"],
  ["MSO_PATTERN_TYPE", "VERTICAL", 50, "vert"],
  ["MSO_PATTERN_TYPE", "WAVE", 48, "wave"],
  ["MSO_PATTERN_TYPE", "WEAVE", 44, "weave"],
  ["MSO_PATTERN_TYPE", "WIDE_DOWNWARD_DIAGONAL", 25, "wdDnDiag"],
  ["MSO_PATTERN_TYPE", "WIDE_UPWARD_DIAGONAL", 26, "wdUpDiag"],
  ["MSO_PATTERN_TYPE", "ZIG_ZAG", 38, "zigZag"]
] as const)("retains drawing symbol %s.%s = %s", (group, name, value, token) => {
  const symbols =
    group === "MSO_FILL_TYPE" ? MSO_FILL : group === "MSO_PATTERN_TYPE" ? MSO_PATTERN : MSO_LINE;
  expect((symbols as Readonly<Record<string, number>>)[name]).toBe(value);
  if (token) expect((group === "MSO_PATTERN_TYPE" ? patternTokens : dashTokens)[value]).toBe(token);
});
