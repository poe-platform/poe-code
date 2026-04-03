import { describe, expect, it } from "vitest";
import type { StyledRun } from "./ansi-parser.js";
import { renderSvg } from "./svg-renderer.js";

function createRun(overrides: Partial<StyledRun> = {}): StyledRun {
  return {
    text: "hello",
    fg: null,
    bg: null,
    bold: false,
    italic: false,
    underline: false,
    dim: false,
    ...overrides
  };
}

describe("renderSvg", () => {
  it("renders plain text inside a tspan", () => {
    const svg = renderSvg([createRun()]);

    expect(svg).toContain("<tspan");
    expect(svg).toContain(">hello</tspan>");
  });

  it("adds font-weight for bold runs", () => {
    const svg = renderSvg([createRun({ bold: true })], { window: false });

    expect(svg).toContain('font-weight="bold"');
  });

  it("applies foreground color as fill", () => {
    const svg = renderSvg([createRun({ fg: { type: "ansi4", index: 1 } })], { window: false });

    expect(svg).toContain('fill="#D74E6F"');
  });

  it("uses freeze ansi colors for ansi8 low palette indexes", () => {
    const svg = renderSvg([createRun({ fg: { type: "ansi8", index: 1 } })], { window: false });

    expect(svg).toContain('fill="#D74E6F"');
  });

  it("skips the title bar when window is false", () => {
    const svg = renderSvg([createRun()], { window: false });

    expect(svg).not.toContain("#FF5A54");
    expect(svg).not.toContain("<circle");
  });

  it("includes macOS traffic lights when window is true", () => {
    const svg = renderSvg([createRun()], { window: true });

    expect(svg).toContain('<circle cx="13.5" cy="12" r="5.5" fill="#FF5A54" />');
    expect(svg).toContain('<circle cx="32.5" cy="12" r="5.5" fill="#E6BF29" />');
    expect(svg).toContain('<circle cx="51.5" cy="12" r="5.5" fill="#52C12B" />');
  });

  it("reflects custom padding in the dimensions and viewBox", () => {
    const svg = renderSvg([createRun({ text: "hi" })], { window: false, padding: 10 });

    expect(svg).toContain('width="36.67"');
    expect(svg).toContain('height="36.80"');
    expect(svg).toContain('viewBox="0 0 36.67 36.80"');
  });

  it("resets x and advances dy for newline runs", () => {
    const svg = renderSvg(
      [createRun({ text: "a" }), createRun({ text: "\n" }), createRun({ text: "b" })],
      { window: false }
    );

    expect(svg).toContain('<tspan fill="#C5C8C6" font-weight="normal" font-style="normal" text-decoration="none" opacity="1" x="20.00" dy="1.2em">&#8203;</tspan>');
  });

  it("escapes xml text content", () => {
    const svg = renderSvg([createRun({ text: `<a & "b">` })], { window: false });

    expect(svg).toContain("&lt;a &amp; \"b\"&gt;");
  });
});
