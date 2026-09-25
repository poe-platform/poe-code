import {
  cosArray,
  cosDict,
  cosName,
  cosNumber,
  cosStream,
  cosString,
  type PdfCosRef,
  type PdfPathSegment,
} from "../ast.js";
import type { ParsedCosDocument } from "../cos/parser.js";
import { PdfError } from "../errors.js";
import { generateToUnicodeCMap } from "./cmap.js";

export interface ParsedTrueTypeFont {
  readonly bytes: Uint8Array;
  readonly postScriptName: string;
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  readonly capHeight: number;
  readonly italicAngle: number;
  readonly flags: number;
  readonly bbox: readonly [number, number, number, number];
  readonly numGlyphs: number;
  getGlyphId(codePoint: number): number;
  getAdvanceWidthUnits(glyphId: number): number;
  getAdvanceWidth1000(codePoint: number): number;
  measureTextWidth(text: string, fontSize: number): number;
  encodeTextToCidHex(text: string): { hexBytes: Uint8Array; usedGlyphs: Map<number, string> };
  getGlyphOutline(codePoint: number): PdfPathSegment[];
  getGlyphOutlineByGid(glyphId: number): PdfPathSegment[];
}

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, false);
}

function readI16(view: DataView, offset: number): number {
  return view.getInt16(offset, false);
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, false);
}

export function parseTrueTypeFont(bytes: Uint8Array): ParsedTrueTypeFont {
  if (bytes.byteLength < 12) {
    throw new PdfError("E_PARSE", "TrueType font is too short");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sfntVersion = readU32(view, 0);
  if (sfntVersion !== 0x00010000 && sfntVersion !== 0x4f54544f && sfntVersion !== 0x74727565) {
    throw new PdfError("E_PARSE", `Unsupported sfnt header signature: 0x${sfntVersion.toString(16)}`);
  }
  const numTables = readU16(view, 4);
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < numTables; i++) {
    const recOffset = 12 + i * 16;
    if (recOffset + 16 > bytes.byteLength) break;
    const tag = String.fromCharCode(
      bytes[recOffset]!,
      bytes[recOffset + 1]!,
      bytes[recOffset + 2]!,
      bytes[recOffset + 3]!
    );
    const offset = readU32(view, recOffset + 8);
    const length = readU32(view, recOffset + 12);
    tables.set(tag, { offset, length });
  }

  const head = tables.get("head");
  const hhea = tables.get("hhea");
  const maxp = tables.get("maxp");
  const hmtx = tables.get("hmtx");
  const cmap = tables.get("cmap");
  if (!head || !hhea || !maxp || !hmtx || !cmap) {
    throw new PdfError("E_PARSE", "TrueType font missing required tables (head/hhea/maxp/hmtx/cmap)");
  }

  const unitsPerEm = Math.max(1, readU16(view, head.offset + 18));
  const xMin = readI16(view, head.offset + 36);
  const yMin = readI16(view, head.offset + 38);
  const xMax = readI16(view, head.offset + 40);
  const yMax = readI16(view, head.offset + 42);
  const indexToLocFormat = readI16(view, head.offset + 50);

  const ascenderRaw = readI16(view, hhea.offset + 4);
  const descenderRaw = readI16(view, hhea.offset + 6);
  const numOfLongHorMetrics = Math.max(1, readU16(view, hhea.offset + 34));
  const numGlyphs = Math.max(1, readU16(view, maxp.offset + 4));

  const os2 = tables.get("OS/2");
  let capHeightRaw = Math.round(ascenderRaw * 0.7);
  if (os2 && os2.length >= 90) {
    const version = readU16(view, os2.offset);
    if (version >= 2) {
      const ch = readI16(view, os2.offset + 88);
      if (ch > 0) capHeightRaw = ch;
    }
  }

  const advanceWidths = new Uint16Array(numGlyphs);
  let lastWidth = 500;
  for (let gid = 0; gid < numGlyphs; gid++) {
    if (gid < numOfLongHorMetrics) {
      const off = hmtx.offset + gid * 4;
      if (off + 2 <= bytes.byteLength) {
        lastWidth = readU16(view, off);
      }
    }
    advanceWidths[gid] = lastWidth;
  }

  const codePointToGlyph = new Map<number, number>();
  const cmapNumTables = readU16(view, cmap.offset + 2);
  let format4Offset = 0;
  let format12Offset = 0;
  for (let i = 0; i < cmapNumTables; i++) {
    const rec = cmap.offset + 4 + i * 8;
    if (rec + 8 > bytes.byteLength) break;
    const platformID = readU16(view, rec);
    const subOffset = cmap.offset + readU32(view, rec + 4);
    if (subOffset + 4 > bytes.byteLength) continue;
    const fmt = readU16(view, subOffset);
    if (fmt === 12 && (platformID === 3 || platformID === 0)) {
      format12Offset = subOffset;
    } else if (fmt === 4 && (platformID === 3 || platformID === 0)) {
      format4Offset = subOffset;
    }
  }

  if (format12Offset > 0) {
    const numGroups = readU32(view, format12Offset + 12);
    for (let g = 0; g < numGroups; g++) {
      const grp = format12Offset + 16 + g * 12;
      if (grp + 12 > bytes.byteLength) break;
      const startChar = readU32(view, grp);
      const endChar = readU32(view, grp + 4);
      const startGlyph = readU32(view, grp + 8);
      for (let cp = startChar; cp <= endChar && cp - startChar <= 65535; cp++) {
        codePointToGlyph.set(cp, startGlyph + (cp - startChar));
      }
    }
  } else if (format4Offset > 0) {
    const segCount = readU16(view, format4Offset + 6) >> 1;
    const endCodeStart = format4Offset + 14;
    const startCodeStart = endCodeStart + segCount * 2 + 2;
    const idDeltaStart = startCodeStart + segCount * 2;
    const idRangeOffsetStart = idDeltaStart + segCount * 2;
    for (let s = 0; s < segCount; s++) {
      const endCode = readU16(view, endCodeStart + s * 2);
      const startCode = readU16(view, startCodeStart + s * 2);
      if (startCode === 0xffff && endCode === 0xffff) break;
      const idDelta = readI16(view, idDeltaStart + s * 2);
      const idRangeOffsetPos = idRangeOffsetStart + s * 2;
      const idRangeOffset = readU16(view, idRangeOffsetPos);
      for (let cp = startCode; cp <= endCode; cp++) {
        let gid = 0;
        if (idRangeOffset === 0) {
          gid = (cp + idDelta) & 0xffff;
        } else {
          const glyphIndexOffset = idRangeOffsetPos + idRangeOffset + (cp - startCode) * 2;
          if (glyphIndexOffset + 2 <= bytes.byteLength) {
            gid = readU16(view, glyphIndexOffset);
            if (gid !== 0) gid = (gid + idDelta) & 0xffff;
          }
        }
        if (gid > 0 && gid < numGlyphs) {
          codePointToGlyph.set(cp, gid);
        }
      }
    }
  }

  let postScriptName = "EmbeddedTrueType";
  const nameTbl = tables.get("name");
  if (nameTbl && nameTbl.offset + 6 <= bytes.byteLength) {
    const count = readU16(view, nameTbl.offset + 2);
    const strOffset = nameTbl.offset + readU16(view, nameTbl.offset + 4);
    for (let i = 0; i < count; i++) {
      const rec = nameTbl.offset + 6 + i * 12;
      if (rec + 12 > bytes.byteLength) break;
      const platformID = readU16(view, rec);
      const nameID = readU16(view, rec + 6);
      const len = readU16(view, rec + 8);
      const off = strOffset + readU16(view, rec + 10);
      if (nameID === 6 && off + len <= bytes.byteLength) {
        let decoded = "";
        if (platformID === 3 || platformID === 0) {
          for (let j = 0; j + 1 < len; j += 2) {
            decoded += String.fromCharCode(readU16(view, off + j));
          }
        } else {
          for (let j = 0; j < len; j++) {
            decoded += String.fromCharCode(bytes[off + j]!);
          }
        }
        let cleaned = "";
        for (let k = 0; k < decoded.length; k++) {
          const code = decoded.charCodeAt(k);
          if (code >= 0x21 && code <= 0x7e) cleaned += decoded[k]!;
        }
        if (cleaned) {
          postScriptName = cleaned;
          break;
        }
      }
    }
  }

  const scale1000 = (v: number): number => Math.round((v * 1000) / unitsPerEm);
  const loca = tables.get("loca");
  const glyf = tables.get("glyf");

  const getGlyphOutlineByGid = (gid: number, depth = 0): PdfPathSegment[] => {
    if (!loca || !glyf || gid <= 0 || gid >= numGlyphs || depth > 6) return [];
    let gOff = 0;
    let gNext = 0;
    if (indexToLocFormat === 0) {
      gOff = readU16(view, loca.offset + gid * 2) * 2;
      gNext = readU16(view, loca.offset + (gid + 1) * 2) * 2;
    } else {
      gOff = readU32(view, loca.offset + gid * 4);
      gNext = readU32(view, loca.offset + (gid + 1) * 4);
    }
    if (gOff >= gNext || glyf.offset + gNext > bytes.byteLength) return [];
    const glyphStart = glyf.offset + gOff;
    const numberOfContours = readI16(view, glyphStart);
    if (numberOfContours < 0) {
      const compSegments: PdfPathSegment[] = [];
      let cPos = glyphStart + 10;
      let compFlags = 0x0020;
      while ((compFlags & 0x0020) !== 0 && cPos + 4 <= glyf.offset + gNext) {
        compFlags = readU16(view, cPos);
        const subGid = readU16(view, cPos + 2);
        cPos += 4;
        let dx = 0;
        let dy = 0;
        if (compFlags & 0x0001) {
          if (compFlags & 0x0002) {
            dx = readI16(view, cPos);
            dy = readI16(view, cPos + 2);
          }
          cPos += 4;
        } else {
          if (compFlags & 0x0002) {
            dx = (bytes[cPos]! << 24) >> 24;
            dy = (bytes[cPos + 1]! << 24) >> 24;
          }
          cPos += 2;
        }
        let m00 = 1, m01 = 0, m10 = 0, m11 = 1;
        if (compFlags & 0x0008) {
          m00 = m11 = readI16(view, cPos) / 16384;
          cPos += 2;
        } else if (compFlags & 0x0040) {
          m00 = readI16(view, cPos) / 16384;
          m11 = readI16(view, cPos + 2) / 16384;
          cPos += 4;
        } else if (compFlags & 0x0080) {
          m00 = readI16(view, cPos) / 16384;
          m01 = readI16(view, cPos + 2) / 16384;
          m10 = readI16(view, cPos + 4) / 16384;
          m11 = readI16(view, cPos + 6) / 16384;
          cPos += 8;
        }
        const tx = dx / unitsPerEm;
        const ty = dy / unitsPerEm;
        for (const seg of getGlyphOutlineByGid(subGid, depth + 1)) {
          if (seg.kind === "move" || seg.kind === "line") {
            compSegments.push({
              kind: seg.kind,
              x: seg.x * m00 + seg.y * m10 + tx,
              y: seg.x * m01 + seg.y * m11 + ty,
            });
          } else if (seg.kind === "cubic") {
            compSegments.push({
              kind: "cubic",
              x1: seg.x1 * m00 + seg.y1 * m10 + tx,
              y1: seg.x1 * m01 + seg.y1 * m11 + ty,
              x2: seg.x2 * m00 + seg.y2 * m10 + tx,
              y2: seg.x2 * m01 + seg.y2 * m11 + ty,
              x: seg.x * m00 + seg.y * m10 + tx,
              y: seg.x * m01 + seg.y * m11 + ty,
            });
          } else {
            compSegments.push(seg);
          }
        }
      }
      return compSegments;
    }
    if (numberOfContours <= 0) return [];

    const endPts: number[] = [];
    for (let i = 0; i < numberOfContours; i++) {
      endPts.push(readU16(view, glyphStart + 10 + i * 2));
    }
    const numPoints = (endPts[endPts.length - 1] ?? -1) + 1;
    if (numPoints <= 0) return [];
    const instrLen = readU16(view, glyphStart + 10 + numberOfContours * 2);
    let pos = glyphStart + 12 + numberOfContours * 2 + instrLen;

    const flags = new Uint8Array(numPoints);
    for (let i = 0; i < numPoints; i++) {
      const f = bytes[pos++] ?? 0;
      flags[i] = f;
      if (f & 0x08) {
        const repeat = bytes[pos++] ?? 0;
        for (let r = 0; r < repeat && i + 1 < numPoints; r++) {
          flags[++i] = f;
        }
      }
    }
    const xs = new Int32Array(numPoints);
    let curX = 0;
    for (let i = 0; i < numPoints; i++) {
      const f = flags[i]!;
      if (f & 0x02) {
        const dx = bytes[pos++] ?? 0;
        curX += f & 0x10 ? dx : -dx;
      } else if (!(f & 0x10)) {
        curX += readI16(view, pos);
        pos += 2;
      }
      xs[i] = curX;
    }
    const ys = new Int32Array(numPoints);
    let curY = 0;
    for (let i = 0; i < numPoints; i++) {
      const f = flags[i]!;
      if (f & 0x04) {
        const dy = bytes[pos++] ?? 0;
        curY += f & 0x20 ? dy : -dy;
      } else if (!(f & 0x20)) {
        curY += readI16(view, pos);
        pos += 2;
      }
      ys[i] = curY;
    }

    const segments: PdfPathSegment[] = [];
    let startPt = 0;
    for (const endPt of endPts) {
      if (endPt >= startPt) {
        const contourPts: Array<{ x: number; y: number; onCurve: boolean }> = [];
        for (let p = startPt; p <= endPt; p++) {
          contourPts.push({
            x: xs[p]! / unitsPerEm,
            y: ys[p]! / unitsPerEm,
            onCurve: (flags[p]! & 0x01) !== 0,
          });
        }
        const n = contourPts.length;
        if (n > 0) {
          const first = contourPts[0]!;
          const last = contourPts[n - 1]!;
          const startX = first.onCurve
            ? first.x
            : last.onCurve
              ? last.x
              : (first.x + last.x) * 0.5;
          const startY = first.onCurve
            ? first.y
            : last.onCurve
              ? last.y
              : (first.y + last.y) * 0.5;
          segments.push({ kind: "move", x: startX, y: startY });
          let curOnX = startX;
          let curOnY = startY;
          let idx = first.onCurve ? 1 : 0;
          while (idx < n) {
            const pt = contourPts[idx]!;
            if (pt.onCurve) {
              segments.push({ kind: "line", x: pt.x, y: pt.y });
              curOnX = pt.x;
              curOnY = pt.y;
              idx++;
            } else {
              const nextPt = contourPts[(idx + 1) % n]!;
              const endX = nextPt.onCurve ? nextPt.x : (pt.x + nextPt.x) * 0.5;
              const endY = nextPt.onCurve ? nextPt.y : (pt.y + nextPt.y) * 0.5;
              segments.push({
                kind: "cubic",
                x1: curOnX + (2 / 3) * (pt.x - curOnX),
                y1: curOnY + (2 / 3) * (pt.y - curOnY),
                x2: endX + (2 / 3) * (pt.x - endX),
                y2: endY + (2 / 3) * (pt.y - endY),
                x: endX,
                y: endY,
              });
              curOnX = endX;
              curOnY = endY;
              idx += nextPt.onCurve ? 2 : 1;
            }
          }
        }
        segments.push({ kind: "close" });
      }
      startPt = endPt + 1;
    }
    return segments;
  };

  const getGlyphOutline = (codePoint: number): PdfPathSegment[] => {
    const gid = codePointToGlyph.get(codePoint) ?? 0;
    return getGlyphOutlineByGid(gid);
  };

  return {
    bytes,
    postScriptName,
    unitsPerEm,
    ascender: scale1000(ascenderRaw),
    descender: scale1000(descenderRaw),
    capHeight: scale1000(capHeightRaw),
    italicAngle: 0,
    flags: 32,
    bbox: [scale1000(xMin), scale1000(yMin), scale1000(xMax), scale1000(yMax)],
    numGlyphs,
    getGlyphId(codePoint: number): number {
      return codePointToGlyph.get(codePoint) ?? 0;
    },
    getAdvanceWidthUnits(glyphId: number): number {
      return advanceWidths[glyphId] ?? advanceWidths[0] ?? 500;
    },
    getAdvanceWidth1000(codePoint: number): number {
      const gid = codePointToGlyph.get(codePoint) ?? 0;
      const units = advanceWidths[gid] ?? advanceWidths[0] ?? 500;
      return scale1000(units);
    },
    measureTextWidth(text: string, fontSize: number): number {
      let sum = 0;
      for (const ch of text) {
        const cp = ch.codePointAt(0) ?? 0;
        sum += this.getAdvanceWidth1000(cp);
      }
      return (sum * fontSize) / 1000;
    },
    encodeTextToCidHex(text: string): { hexBytes: Uint8Array; usedGlyphs: Map<number, string> } {
      const out: number[] = [];
      const usedGlyphs = new Map<number, string>();
      for (const ch of text) {
        const cp = ch.codePointAt(0) ?? 0;
        const gid = codePointToGlyph.get(cp) ?? 0;
        usedGlyphs.set(gid, ch);
        out.push((gid >> 8) & 0xff, gid & 0xff);
      }
      return { hexBytes: Uint8Array.from(out), usedGlyphs };
    },
    getGlyphOutline,
    getGlyphOutlineByGid,
  };
}

export function embedTrueTypeFontInCos(
  doc: ParsedCosDocument,
  font: ParsedTrueTypeFont,
  usedGlyphs?: ReadonlyMap<number, string>
): PdfCosRef {
  const fontFileStream = cosStream(font.bytes, {
    dict: cosDict({ Length1: cosNumber(font.bytes.length) }),
    compress: true,
  });
  const fontFileRef = doc.allocateObject(fontFileStream);

  const descriptorDict = cosDict({
    Type: cosName("FontDescriptor"),
    FontName: cosName(font.postScriptName),
    Flags: cosNumber(font.flags),
    FontBBox: cosArray([
      cosNumber(font.bbox[0]),
      cosNumber(font.bbox[1]),
      cosNumber(font.bbox[2]),
      cosNumber(font.bbox[3]),
    ]),
    ItalicAngle: cosNumber(font.italicAngle),
    Ascent: cosNumber(font.ascender),
    Descent: cosNumber(font.descender),
    CapHeight: cosNumber(font.capHeight),
    StemV: cosNumber(80),
    FontFile2: fontFileRef,
  });
  const descriptorRef = doc.allocateObject(descriptorDict);

  const widthItems = [];
  for (let gid = 0; gid < Math.min(font.numGlyphs, 512); gid++) {
    const w = Math.round((font.getAdvanceWidthUnits(gid) * 1000) / font.unitsPerEm);
    widthItems.push(cosNumber(w));
  }
  const wArray = cosArray([cosNumber(0), cosArray(widthItems)]);

  const cidFontDict = cosDict({
    Type: cosName("Font"),
    Subtype: cosName("CIDFontType2"),
    BaseFont: cosName(font.postScriptName),
    CIDSystemInfo: cosDict({
      Registry: cosString("Adobe"),
      Ordering: cosString("Identity"),
      Supplement: cosNumber(0),
    }),
    FontDescriptor: descriptorRef,
    DW: cosNumber(1000),
    W: wArray,
    CIDToGIDMap: cosName("Identity"),
  });
  const cidFontRef = doc.allocateObject(cidFontDict);

  const cmapMap = new Map<number, string>();
  if (usedGlyphs && usedGlyphs.size > 0) {
    for (const [gid, ch] of usedGlyphs.entries()) {
      cmapMap.set(gid, ch);
    }
  }
  const toUnicodeBytes = generateToUnicodeCMap(cmapMap);
  const toUnicodeRef = doc.allocateObject(cosStream(toUnicodeBytes, { compress: true }));

  const type0Dict = cosDict({
    Type: cosName("Font"),
    Subtype: cosName("Type0"),
    BaseFont: cosName(font.postScriptName),
    Encoding: cosName("Identity-H"),
    DescendantFonts: cosArray([cidFontRef]),
    ToUnicode: toUnicodeRef,
  });
  return doc.allocateObject(type0Dict);
}
