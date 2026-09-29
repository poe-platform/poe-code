import { describe, expect, it } from "vitest";
import { SaxesParser } from "saxes";
import { cosArray, cosDict, cosNumber, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";
import { renderDisplayListToSvg } from "./raster.js";

function dashedPage(pattern: number[], phase: number, useState: boolean, content = "10 50 m 90 50 l S", alpha = 1) {
  const doc = PdfDocument.create(), page = doc.addPage([100, 100]);
  dictSet(page.pageDict, "Resources", cosDict({ ExtGState: cosDict({ Dots: cosDict({
    D: cosArray([cosArray(pattern.map(value => cosNumber(value))), cosNumber(phase)]),
    CA: cosNumber(alpha),
  }) }) }));
  page.setRawContentStream(`0 0 1 RG 10 w 1 J ${useState ? "/Dots gs" : `[${pattern.join(" ")}] ${phase} d`} ${content}`);
  return page;
}

describe("zero-length dashes", () => {
  it.each([
    [[0, 20], 0], [[0, 20], 5], [[5, 0, 5, 10], 0], [[0, 0], 0],
  ] as const)("keeps ExtGState D equivalent to d: %j phase %i", (pattern, phase) => {
    const state = dashedPage([...pattern], phase, true), operator = dashedPage([...pattern], phase, false);
    expect(state.evaluateDisplayList().paths[0]!.dashArray).toEqual(operator.evaluateDisplayList().paths[0]!.dashArray);
    const statePixels = state.renderToBitmap({ scale: 2 }).data, operatorPixels = operator.renderToBitmap({ scale: 2 }).data;
    expect(Buffer.compare(statePixels, operatorPixels)).toBe(0);
  });

  it("preserves dots through save/restore and a later transform", () => {
    const page = dashedPage([0, 20], 0, true, "q 2 0 0 1 0 0 cm 5 30 m 45 30 l S Q 10 60 m 90 60 l S");
    const bitmap = page.renderToBitmap({ scale: 2 });
    const redAt = (x: number, y: number) => bitmap.data[((199 - y * 2) * 200 + x * 2) * 4];
    expect(redAt(30, 30)).toBe(255);
    expect(redAt(50, 30)).toBe(0);
    expect(redAt(20, 60)).toBe(255);
    expect(redAt(30, 60)).toBe(0);
  });

  it.each([[false, 1], [true, 1], [false, 6], [true, 6]] as const)("exports four closed dot contours without a terminal dot (ExtGState=%s, scale=%i)", (useState, scale) => {
    const svg = renderDisplayListToSvg(dashedPage([0, 20], 0, useState).evaluateDisplayList(), { scale });
    const dots: Record<string, string>[] = [];
    const parser = new SaxesParser();
    parser.on("opentag", node => {
      const attributes = node.attributes as Record<string, string>;
      if (node.name === "path" && attributes.fill === "rgb(0,0,255)") dots.push(attributes);
    });
    parser.write(svg).close();
    // PDF.js and Poppler draw dots at x=10,30,50,70, stopping before x=90.
    expect(dots).toHaveLength(1);
    expect(dots[0]!.d!.split("Z")).toHaveLength(5);
    expect(svg).not.toContain("stroke-dasharray");
  });

  it("does not create a final bitmap dot from transformed floating-point residue", () => {
    const bitmap = dashedPage([0, 20], 0, false).renderToBitmap({ scale: 6 });
    expect(bitmap.data[(300 * 600 + 540) * 4]).toBe(255);
  });

  it.each([
    ["10 50 m 90 50 l S", 26, 54],
    ["10 20 m 70 80 l S", 28, 38],
  ] as const)("matches PDF.js square-capped zero dashes in user coordinates: %s", (content, x, y) => {
    const page = dashedPage([0, 20], 0, true, `2 J ${content}`);
    const bitmap = page.renderToBitmap({ scale: 2 });
    expect(bitmap.data[((199 - y * 2) * 200 + x * 2) * 4]).toBe(0);
    expect(bitmap.data[((199 - 50 * 2) * 200 + 20 * 2) * 4]).toBe(255);
  });

  it("composites overlapping SVG dots with one stroke opacity", () => {
    const page = dashedPage([0, 8], 0, true, "10 50 m 90 50 l S", 0.5);
    const svg = renderDisplayListToSvg(page.evaluateDisplayList());
    const parser = new SaxesParser(), paintedPaths: Record<string, string>[] = [];
    parser.on("opentag", node => { if (node.name === "path") paintedPaths.push(node.attributes as Record<string, string>); });
    parser.write(svg).close();
    expect(paintedPaths).toHaveLength(1);
    expect(paintedPaths[0]!["fill-opacity"]).toBe("0.5");
    expect(paintedPaths[0]!.d!.split("Z")).toHaveLength(11);
  });

  it("keeps a fill separate from the dotted stroke", () => {
    const page = dashedPage([0, 20], 0, false, "1 0 0 rg 20 20 60 60 re B");
    const svg = renderDisplayListToSvg(page.evaluateDisplayList());
    expect(svg).toContain('fill="rgb(255,0,0)"');
    expect(svg).toContain('fill="rgb(0,0,255)"');
    expect(svg).not.toContain("stroke-dasharray");
  });
});
