import { describe, expect, it } from "vitest";
import { cosArray, cosDict, cosName, cosNumber, cosRef } from "../ast.js";
import { parseCosDocument } from "../cos/parser.js";
import { serializeCosDocument } from "../cos/writer.js";
import { generateToUnicodeCMap, parseToUnicodeCMap } from "./cmap.js";
import {
  buildFontEncodingDifferencesMap,
  decodeWinAnsiByte,
  encodeWinAnsiBytes,
  measureStandard14TextWidth,
  normalizeStandard14FontName,
} from "./standard14.js";
import { embedTrueTypeFontInCos, parseTrueTypeFont } from "./truetype.js";

function buildSyntheticTrueTypeBytes(): Uint8Array {
  const buf = new ArrayBuffer(256);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  // sfnt version 0x00010000, 5 tables: cmap, head, hhea, hmtx, maxp
  view.setUint32(0, 0x00010000, false);
  view.setUint16(4, 5, false);
  const writeRec = (idx: number, tag: string, off: number, len: number) => {
    const p = 12 + idx * 16;
    for (let i = 0; i < 4; i++) bytes[p + i] = tag.charCodeAt(i);
    view.setUint32(p + 8, off, false);
    view.setUint32(p + 12, len, false);
  };
  writeRec(0, "head", 92, 54);
  writeRec(1, "hhea", 148, 36);
  writeRec(2, "maxp", 184, 6);
  writeRec(3, "hmtx", 192, 8);
  writeRec(4, "cmap", 200, 44);

  // head (offset 92)
  view.setUint16(92 + 18, 1000, false); // unitsPerEm = 1000
  view.setInt16(92 + 36, 0, false);
  view.setInt16(92 + 38, -200, false);
  view.setInt16(92 + 40, 800, false);
  view.setInt16(92 + 42, 800, false);

  // hhea (offset 148)
  view.setInt16(148 + 4, 800, false); // ascender
  view.setInt16(148 + 6, -200, false); // descender
  view.setUint16(148 + 34, 2, false); // numOfLongHorMetrics = 2

  // maxp (offset 184)
  view.setUint16(184 + 4, 2, false); // numGlyphs = 2

  // hmtx (offset 192): gid 0 = 500, gid 1 = 650
  view.setUint16(192, 500, false);
  view.setUint16(196, 650, false);

  // cmap (offset 200): 1 subtable format 12 at +12 (offset 212)
  view.setUint16(200, 0, false);
  view.setUint16(202, 1, false);
  view.setUint16(204, 3, false); // platformID = 3
  view.setUint16(206, 10, false); // encodingID = 10
  view.setUint32(208, 12, false); // subtable rel offset
  view.setUint16(212, 12, false); // format 12
  view.setUint32(216, 28, false); // length
  view.setUint32(224, 1, false); // numGroups = 1
  view.setUint32(228, 65, false); // startCharCode 'A'
  view.setUint32(232, 65, false); // endCharCode 'A'
  view.setUint32(236, 1, false); // startGlyphID = 1

  return bytes;
}

describe("Layer 2 Fonts: Standard 14, ToUnicode CMap, and First-Party TrueType Engine", () => {
  it("resolves Standard 14 metrics, WinAnsi encoding, and /Differences arrays", () => {
    expect(normalizeStandard14FontName("ABCDEF+Helvetica-Bold")).toBe("Helvetica-Bold");
    expect(measureStandard14TextWidth("Hello", "Courier", 10)).toBeCloseTo(30, 3);
    expect(decodeWinAnsiByte(0x80)).toBe("€");
    expect([...encodeWinAnsiBytes("€A")]).toEqual([0x80, 0x41]);

    const encDict = cosDict({
      Type: cosName("Encoding"),
      Differences: cosArray([cosNumber(65), cosName("Euro"), cosName("bullet")]),
    });
    const diffs = buildFontEncodingDifferencesMap(encDict);
    expect(diffs.get(65)).toBe("€");
    expect(diffs.get(66)).toBe("•");
  });

  it("round-trips /ToUnicode CMaps (beginbfchar & beginbfrange)", () => {
    const cidMap = new Map<number, string>([
      [1, "H"],
      [2, "e"],
      [3, "l"],
      [4, "o"],
    ]);
    const cmapStream = generateToUnicodeCMap(cidMap);
    const parsed = parseToUnicodeCMap(cmapStream);
    expect(parsed.isTwoByte).toBe(true);
    const decoded = parsed.decodeBytes(Uint8Array.from([0x00, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x03, 0x00, 0x04]));
    expect(decoded.map(d => d.unicode).join("")).toBe("Hello");
  });

  it("parses TrueType (sfnt) tables and embeds Type0/CIDFontType2 into a COS document", () => {
    const ttfBytes = buildSyntheticTrueTypeBytes();
    const font = parseTrueTypeFont(ttfBytes);
    expect(font.unitsPerEm).toBe(1000);
    expect(font.getGlyphId(65)).toBe(1);
    expect(font.getAdvanceWidth1000(65)).toBe(650);
    expect(font.measureTextWidth("A", 20)).toBeCloseTo(13, 3);

    const baseBytes = serializeCosDocument({
      objects: [
        { objectNumber: 1, generationNumber: 0, value: cosDict({ Type: cosName("Catalog"), Pages: cosRef(2) }) },
        { objectNumber: 2, generationNumber: 0, value: cosDict({ Type: cosName("Pages"), Count: cosNumber(0), Kids: cosArray([]) }) },
      ],
      rootRef: cosRef(1),
    });
    const cosDoc = parseCosDocument(baseBytes);
    const { usedGlyphs } = font.encodeTextToCidHex("A");
    const fontRef = embedTrueTypeFontInCos(cosDoc, font, usedGlyphs);
    const embeddedDict = cosDoc.resolveDict(fontRef);
    expect(embeddedDict).toBeDefined();
  });
});
