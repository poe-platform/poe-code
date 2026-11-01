// Regenerate with node --import tsx packages/safe-bash-rust/scripts/generate-font-outlines.mjs.
// The runtime reads these contours without loading JavaScript or parsing CFF.
import { writeFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { getStandardFontOutlines } from "../../pdf-ast/src/fonts/standard-outlines.ts";
import { STANDARD_14_FONTS } from "../../pdf-ast/src/fonts/standard14.ts";

const directory = new URL("../src/commands/pdf_fonts/", import.meta.url);
const winAnsi = new TextDecoder("windows-1252");
for (const name of Object.keys(STANDARD_14_FONTS)) {
  const face = getStandardFontOutlines(name);
  const offsets = Buffer.alloc(257 * 4);
  const contours = [];
  let offset = offsets.length;
  for (let byte = 0; byte < 256; byte++) {
    offsets.writeUInt32LE(offset, byte * 4);
    const char = face.defaultUnicode.get(byte) ?? winAnsi.decode(Uint8Array.of(byte));
    for (const seg of face.getGlyphOutline(char.codePointAt(0))) {
      const kind = ["move", "line", "cubic", "close"].indexOf(seg.kind);
      if (kind < 0) throw new Error(seg.kind);
      const coords = kind === 3 ? [] : kind === 2 ? [seg.x1, seg.y1, seg.x2, seg.y2, seg.x, seg.y] : [seg.x, seg.y];
      const record = Buffer.alloc(1 + 4 * coords.length);
      record[0] = kind;
      coords.forEach((value, i) => record.writeFloatLE(value, 1 + 4 * i));
      contours.push(record);
      offset += record.length;
    }
  }
  offsets.writeUInt32LE(offset, 256 * 4);
  writeFileSync(new URL(name + ".deflate", directory), deflateRawSync(Buffer.concat([offsets, ...contours]), { level: 9 }));
}
