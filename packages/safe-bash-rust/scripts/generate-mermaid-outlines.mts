// Run with node --import tsx. Store the same contours the JS renderer selected
// after font fallback, compound glyph transforms, and letter spacing.
import { readFileSync, writeFileSync } from "node:fs";
import { getEmbeddedFont, getGlyphOutline } from "../../safe-bash-command-mmdc/src/font.js";

const directory = new URL("../src/commands/mermaid/", import.meta.url);
const advances = readFileSync(new URL("advances.bin", directory));
const codepoints = Array.from({ length: advances.length / 6 }, (_, i) => advances.readUInt16LE(i * 6));
// The four synthetic ideograph shapes are selected by codepoint modulo four.
codepoints.push(0x4e00, 0x4e01, 0x4e02, 0x4e03);
if (getEmbeddedFont().unitsPerEm !== 1000) throw new Error("Unexpected Mermaid font units");

function encodeGlyph(glyph: ReturnType<typeof getGlyphOutline>): Buffer {
  const record = Buffer.alloc(10 + glyph.contours.reduce((n, c) => n + 2 + 5 * c.length, 0));
  let pos = 0;
  for (const v of [glyph.xMin, glyph.yMin, glyph.xMax, glyph.yMax, glyph.contours.length]) {
    pos = record.writeInt16LE(v, pos);
  }
  for (const contour of glyph.contours) {
    pos = record.writeUInt16LE(contour.length, pos);
    for (const p of contour) {
      if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) throw new Error("Non-integral glyph point");
      pos = record.writeInt16LE(p.x, pos);
      pos = record.writeInt16LE(p.y, pos);
      pos = record.writeUInt8(Number(p.onCurve), pos);
    }
  }
  return record;
}

for (const family of ["ui", "mono"] as const) {
  const stride = family === "mono" ? 6 : 8;
  const offsets = Buffer.alloc(codepoints.length * stride);
  const records = [offsets];
  let end = offsets.length;
  for (const [i, cp] of codepoints.entries()) {
    const weights = family === "mono" ? [400] as const : [400, 600] as const;
    for (const [face, weight] of weights.entries()) {
      const glyph = getGlyphOutline(cp, family, weight);
      offsets.writeUInt32LE(end, i * stride + face * 4);
      if (family === "mono") offsets.writeUInt16LE(glyph.advanceWidth, i * stride + 4);
      const record = encodeGlyph(glyph);
      records.push(record);
      end += record.length;
    }
  }
  writeFileSync(new URL(family === "mono" ? "mono.bin" : "outlines.bin", directory), Buffer.concat(records));
}
