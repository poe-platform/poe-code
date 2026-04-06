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
    strikethrough: false,
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

  it("adds line-through decoration for strikethrough runs", () => {
    const svg = renderSvg([createRun({ strikethrough: true })], { window: false });

    expect(svg).toContain('text-decoration="line-through"');
  });

  it("applies foreground color as fill", () => {
    const svg = renderSvg([createRun({ fg: { type: "ansi4", index: 1 } })], { window: false });

    expect(svg).toContain('fill="#D74E6F"');
  });

  it("maps ansi8 low palette indexes to the standard 8-color palette", () => {
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

    expect(svg).toContain('width="36.83"');
    expect(svg).toContain('height="48.40"');
    expect(svg).toContain('viewBox="0 0 36.83 48.40"');
  });

  it("renders separate text nodes for each line", () => {
    const svg = renderSvg(
      [createRun({ text: "a" }), createRun({ text: "\n" }), createRun({ text: "b" })],
      { window: false }
    );

    expect(svg).toContain('<text x="20.00" y="36.80" xml:space="preserve">');
    expect(svg).toContain('<text x="20.00" y="53.60" xml:space="preserve">');
  });

  it("escapes xml text content", () => {
    const svg = renderSvg([createRun({ text: `<a & "b">` })], { window: false });

    expect(svg).toContain("&lt;a &amp; \"b\"&gt;");
  });

  it("uses #c4c4c4 as the default foreground color", () => {
    const svg = renderSvg([createRun()], { window: false });

    expect(svg).toContain('fill="#c4c4c4"');
  });

  it("measures CJK characters as 2 cells wide", () => {
    const svg = renderSvg([createRun({ text: "测" })], { window: false });

    // 2 cells * 8.412666... + 20 (left pad) + 40 (right pad) = 76.83
    expect(svg).toContain('width="76.83"');
  });

  it("measures emoji as 2 cells wide", () => {
    const svg = renderSvg([createRun({ text: "🎉" })], { window: false });

    expect(svg).toContain('width="76.83"');
  });

  it("measures fullwidth latin characters as 2 cells wide", () => {
    // Fullwidth A (U+FF21) is in the fullwidth block
    const svg = renderSvg([createRun({ text: "\uFF21" })], { window: false });

    expect(svg).toContain('width="76.83"');
  });
});
