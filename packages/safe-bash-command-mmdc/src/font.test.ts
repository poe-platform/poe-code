import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getEmbeddedFont, getGlyphOutline } from "./font.js";
import { measureTextBlock, normalizeLabelText } from "./text.js";

describe("embedded TrueType font and deterministic text measurement", () => {
  it("parses embedded TrueType sfnt cmap, hmtx, loca, and glyf tables", () => {
    const font = getEmbeddedFont();
    assert.equal(font.unitsPerEm, 1000);
    assert.ok(font.numGlyphs >= 300);

    const glyphA = getGlyphOutline("A".codePointAt(0)!, "ui", 500);
    assert.ok(glyphA.advanceWidth > 450 && glyphA.advanceWidth < 800);
    assert.ok(glyphA.contours.length >= 2, "Capital A should have outer and inner contours");

    const glyphI = getGlyphOutline("i".codePointAt(0)!, "ui", 500);
    const glyphM = getGlyphOutline("m".codePointAt(0)!, "ui", 500);
    assert.ok(
      glyphI.advanceWidth < glyphM.advanceWidth,
      "Proportional UI font must give 'i' a narrower advance than 'm'"
    );

    const monoI = getGlyphOutline("i".codePointAt(0)!, "mono", 400);
    const monoM = getGlyphOutline("m".codePointAt(0)!, "mono", 400);
    assert.equal(monoI.advanceWidth, monoM.advanceWidth, "Monospace font must have equal advances");
  });

  it("extracts outlines for accented Latin, Greek, math symbols, and CJK Unicode", () => {
    for (const ch of ["é", "ß", "Δ", "→", "日", "語"]) {
      const outline = getGlyphOutline(ch.codePointAt(0)!, "ui", 500);
      assert.ok(outline.advanceWidth >= 400, `Expected positive advance for ${ch}`);
      assert.ok(outline.contours.length >= 1, `Expected non-empty contours for ${ch}`);
    }
  });

  it("normalizes <br/> breaks and measures multiline Unicode labels deterministically", () => {
    assert.equal(normalizeLabelText("Line 1<br/>Line 2\\nLine 3"), "Line 1\nLine 2\nLine 3");
    const m1 = measureTextBlock("Short\nMuch longer second line", {
      fontSize: 13,
      lineHeight: 20,
      fontFamily: "ui",
      fontWeight: 500
    });
    assert.equal(m1.lines.length, 2);
    assert.ok(m1.lines[1]!.width > m1.lines[0]!.width);
    assert.equal(m1.height, 40);
    assert.equal(m1.width, m1.lines[1]!.width);
  });
});
