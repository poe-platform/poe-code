import { glyphDirection, mergeBBox, PdfTextGlyphNormalizer } from "./text-glyphs.js";
import type {
  PdfDisplayList,
  PdfExtractedPage,
  PdfPlacedGlyph,
  PdfTextBlock,
  PdfTextLine,
  PdfTextWord,
} from "../ast.js";

export interface ExtractTextOptions {
  readonly mode?: "logical" | "layout" | "raw" | "bbox" | undefined;
  readonly rejoinHyphens?: boolean | undefined;
  readonly discardDiagonal?: boolean | undefined;
  readonly clipText?: boolean | undefined;
  readonly colSpacing?: number | undefined;
  readonly fixedPitch?: number | undefined;
  readonly lineSpacing?: number | undefined;
}

export function extractPageFromDisplayList(
  displayList: PdfDisplayList,
  options: ExtractTextOptions = {}
): PdfExtractedPage {
  const glyphs: PdfPlacedGlyph[] = [];
  const normalizer = new PdfTextGlyphNormalizer(options);
  for (const glyph of displayList.glyphs) for (const normalized of normalizer.push(glyph)) glyphs.push(normalized);
  for (const normalized of normalizer.finish()) glyphs.push(normalized);
  if (glyphs.length === 0) {
    return {
      pageIndex: displayList.pageIndex,
      width: displayList.width,
      height: displayList.height,
      blocks: [],
      tables: [],
    };
  }

  const sortedGlyphs =
    options.mode === "raw"
      ? [...glyphs]
      : [...glyphs].sort((a, b) => {
          const da = glyphDirection(a);
          const db = glyphDirection(b);
          const sameDir = da.ux * db.ux + da.uy * db.uy > 0.85;
          const tol = Math.max(a.fontSize, b.fontSize) * 0.45;
          if (sameDir) {
            const dn = db.normal - da.normal;
            if (Math.abs(dn) > tol) return dn;
            return da.along - db.along;
          }
          const dy = b.baselineY - a.baselineY;
          if (Math.abs(dy) > tol) return dy;
          return a.bbox[0] - b.bbox[0];
        });

  const lineGlyphGroups: PdfPlacedGlyph[][] = [];
  for (const g of sortedGlyphs) {
    const lastGroup = lineGlyphGroups[lineGlyphGroups.length - 1];
    if (!lastGroup) {
      lineGlyphGroups.push([g]);
      continue;
    }
    const ref = lastGroup[0]!;
    const dRef = glyphDirection(ref);
    const dCur = glyphDirection(g);
    const tol = Math.max(ref.fontSize, g.fontSize) * 0.45;
    if (
      dRef.ux * dCur.ux + dRef.uy * dCur.uy > 0.85 &&
      Math.abs(dCur.normal - dRef.normal) <= tol
    ) {
      lastGroup.push(g);
    } else {
      lineGlyphGroups.push([g]);
    }
  }

  const lines: PdfTextLine[] = [];
  for (const group of lineGlyphGroups) {
    if (options.mode !== "raw") {
      group.sort((a, b) => glyphDirection(a).along - glyphDirection(b).along);
    }
    const subLines: PdfPlacedGlyph[][] = [];
    for (const g of group) {
      const cur = subLines[subLines.length - 1];
      if (!cur) {
        subLines.push([g]);
        continue;
      }
      const prev = cur[cur.length - 1]!;
      const gap = glyphDirection(g).along - (glyphDirection(prev).along + prev.advanceWidth);
      const colScale = options.colSpacing !== undefined && options.colSpacing > 0 ? options.colSpacing / 0.7 : 1.0;
      const colSplitThreshold = Math.max(prev.fontSize, g.fontSize) * 4.0 * colScale;
      if ((options.mode === "logical" || options.mode === "layout" || options.mode === undefined) && gap > colSplitThreshold) {
        subLines.push([g]);
      } else {
        cur.push(g);
      }
    }

    for (const sl of subLines) {
      const words: PdfTextWord[] = [];
      let curWordGlyphs: PdfPlacedGlyph[] = [];

      const flushWord = () => {
        if (curWordGlyphs.length === 0) return;
        let wBox: [number, number, number, number] = [...curWordGlyphs[0]!.bbox];
        let text = "";
        for (const wg of curWordGlyphs) {
          wBox = mergeBBox(wBox, wg.bbox);
          text += wg.unicode;
        }
        words.push({
          text,
          bbox: wBox,
          fontSize: curWordGlyphs[0]!.fontSize,
          fontName: curWordGlyphs[0]!.fontName,
          glyphs: curWordGlyphs,
        });
        curWordGlyphs = [];
      };

      for (const g of sl) {
        if (g.unicode === " " || g.unicode === "\t") {
          flushWord();
          continue;
        }
        if (curWordGlyphs.length > 0) {
          const prev = curWordGlyphs[curWordGlyphs.length - 1]!;
          const gap = glyphDirection(g).along - (glyphDirection(prev).along + prev.advanceWidth);
          const spaceThreshold = Math.max(prev.fontSize, g.fontSize) * 0.22;
          if (gap > spaceThreshold) {
            flushWord();
          }
        }
        curWordGlyphs.push(g);
      }
      flushWord();

      if (words.length > 0) {
        let lBox: [number, number, number, number] = [...words[0]!.bbox];
        for (const w of words) {
          lBox = mergeBBox(lBox, w.bbox);
        }
        lines.push({
          text: words.map(w => w.text).join(" "),
          bbox: lBox,
          baselineY: sl[0]!.baselineY,
          words,
        });
      }
    }
  }

  if (options.mode === "logical" && lines.length > 2) {
    const midX = displayList.width * 0.5;
    const leftCol = lines.filter(l => l.bbox[2] <= midX + 18);
    const rightCol = lines.filter(l => l.bbox[0] >= midX - 18 && !leftCol.includes(l));
    if (leftCol.length >= 1 && rightCol.length >= 1 && leftCol.length + rightCol.length === lines.length) {
      leftCol.sort((a, b) => b.baselineY - a.baselineY);
      rightCol.sort((a, b) => b.baselineY - a.baselineY);
      lines.splice(0, lines.length, ...leftCol, ...rightCol);
    }
  }

  const blocks: PdfTextBlock[] = [];
function isBulletPrefixedLine(str: string): boolean {
  const trimmed = str.trimStart();
  if (trimmed.startsWith("•")) return true;
  if ((trimmed.startsWith("-") || trimmed.startsWith("*")) && trimmed.length > 1) {
    const second = trimmed[1]!;
    return second === " " || second === "\t";
  }
  return false;
}


  for (const line of lines) {
    const lineFontSize = line.words[0]?.glyphs[0]?.fontSize ?? 12;
    const lineKind =
      lineFontSize >= 15
        ? "heading"
        : isBulletPrefixedLine(line.text)
          ? "list-item"
          : "paragraph";
    const prevBlock = blocks[blocks.length - 1];
    if (!prevBlock) {
      blocks.push({ kind: lineKind, bbox: [...line.bbox], lines: [line] });
      continue;
    }
    const prevLine = prevBlock.lines[prevBlock.lines.length - 1]!;
    const vGap = prevLine.baselineY - line.baselineY;
    const avgSize = prevLine.words[0]?.glyphs[0]?.fontSize ?? 12;
    const sameColumn = Math.abs(line.bbox[0] - prevLine.bbox[0]) < avgSize * 5;
    if (prevBlock.kind === "paragraph" && lineKind === "paragraph" && vGap > 0 && vGap <= avgSize * 1.9 && sameColumn) {
      prevBlock.lines.push(line);
      blocks[blocks.length - 1] = {
        ...prevBlock,
        bbox: mergeBBox(prevBlock.bbox, line.bbox),
      };
    } else {
      blocks.push({ kind: lineKind, bbox: [...line.bbox], lines: [line] });
    }
  }

  return {
    pageIndex: displayList.pageIndex,
    width: displayList.width,
    height: displayList.height,
    blocks,
    tables: [],
  };
}

function startsWithAsciiLower(str: string): boolean {
  if (str.length === 0) return false;
  const c = str.charCodeAt(0);
  return c >= 0x61 && c <= 0x7a;
}

export function formatExtractedPageText(
  page: PdfExtractedPage,
  options: ExtractTextOptions = {}
): string {
  const mode = options.mode ?? "logical";
  const rejoinHyphens = options.rejoinHyphens ?? true;

  if (mode === "bbox") {
    return JSON.stringify(
      page.blocks.flatMap(b =>
        b.lines.map(l => ({
          text: l.text,
          bbox: l.bbox,
          words: l.words.map(w => ({ text: w.text, bbox: w.bbox })),
        }))
      ),
      null,
      2
    );
  }

  if (mode === "layout") {
    const allLines = page.blocks.flatMap(b => b.lines).sort((a, b) => {
      const dy = b.baselineY - a.baselineY;
      if (Math.abs(dy) > 4) return dy;
      return a.bbox[0] - b.bbox[0];
    });
    const leftMargin = allLines.reduce((left, line) => Math.min(left, line.bbox[0]), Infinity);
    const rows: PdfTextLine[][] = [];
    for (const l of allLines) {
      const lastRow = rows[rows.length - 1];
      if (lastRow && Math.abs(lastRow[0]!.baselineY - l.baselineY) <= 4) {
        lastRow.push(l);
      } else {
        rows.push([l]);
      }
    }
    return rows
      .map((row, rowIdx) => {
        row.sort((a, b) => a.bbox[0] - b.bbox[0]);
        const pitch = options.fixedPitch !== undefined && options.fixedPitch > 0 ? options.fixedPitch : 6;
        let lineStr = "";
        let curX = leftMargin;
        if (options.fixedPitch !== undefined && options.fixedPitch > 0) {
          const words = row.flatMap(seg => seg.words).sort((a, b) => a.bbox[0] - b.bbox[0]);
          for (const w of words) {
            const spaces = Math.max(lineStr.length > 0 ? 1 : 0, Math.round((w.bbox[0] - curX) / pitch));
            lineStr += " ".repeat(Math.min(spaces, 80)) + w.text;
            curX = w.bbox[2];
          }
        } else {
          for (const seg of row) {
            const spaces = Math.max(lineStr.length > 0 ? 2 : 0, Math.round((seg.bbox[0] - curX) / pitch));
            lineStr += " ".repeat(Math.min(spaces, 40)) + seg.text;
            curX = seg.bbox[2];
          }
        }
        let prefixNewlines = "";
        if (rowIdx > 0 && options.lineSpacing !== undefined && options.lineSpacing > 0) {
          const prevY = rows[rowIdx - 1]![0]!.baselineY;
          const curY = row[0]!.baselineY;
          const blankCount = Math.max(0, Math.min(40, Math.round((prevY - curY) / options.lineSpacing) - 1));
          if (blankCount > 0) {
            prefixNewlines = "\n".repeat(blankCount);
          }
        }
        return prefixNewlines + lineStr.trimEnd();
      })
      .join("\n");
  }

  return page.blocks
    .map(b => {
      let out = "";
      for (let i = 0; i < b.lines.length; i++) {
        const lineText = b.lines[i]!.text;
        if (i === 0) {
          out = lineText;
        } else if (rejoinHyphens && out.endsWith("-") && startsWithAsciiLower(lineText)) {
          out = out.slice(0, -1) + lineText;
        } else {
          out += "\n" + lineText;
        }
      }
      return out;
    })
    .join("\n\n");
}
