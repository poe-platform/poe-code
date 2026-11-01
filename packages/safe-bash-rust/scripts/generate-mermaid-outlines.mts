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

const offsets = Buffer.alloc(codepoints.length * 8);
const records = [offsets];
let end = offsets.length;
for (const [i, cp] of codepoints.entries()) {
  for (const [face, weight] of ([400, 600] as const).entries()) {
    const glyph = getGlyphOutline(cp, "ui", weight);
    offsets.writeUInt32LE(end, i * 8 + face * 4);
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
    records.push(record);
    end += record.length;
  }
}
writeFileSync(new URL("outlines.bin", directory), Buffer.concat(records));
