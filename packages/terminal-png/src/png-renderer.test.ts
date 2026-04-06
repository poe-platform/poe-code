import { describe, expect, it } from "vitest";
import type { StyledRun } from "./ansi-parser.js";
import { renderPng } from "./png-renderer.js";
import { renderSvg } from "./svg-renderer.js";

function createRun(overrides: Partial<StyledRun> = {}): StyledRun {
  return {
    text: "hello",
    fg: null,
    bg: null,
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    dim: false,
    ...overrides
  };
}

describe("renderPng", () => {
  it("renders SVG output as a PNG buffer", () => {
    const svg = renderSvg([createRun()], { window: false });

    const png = renderPng(svg);

    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    expect(png.length).toBeGreaterThan(8);
  });
});
