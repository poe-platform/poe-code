import { type3WordOrder, type Type3Word, type Type3OrderReply } from "./type3-word-order.js";
import { textDirection, sameTextLine, textWordBreak, PdfTextGlyphOrder, mergeBBox, PdfTextGlyphNormalizer } from "./text-glyphs.js";
import type {
  PdfDisplayList,
  PdfExtractedPage,
  PdfPlacedGlyph,
  PdfTextBlock,
  PdfTextLine,
  PdfTextWord,
} from "../ast.js";

export interface ExtractTextOptions {
  /** Omit invisible and clipping-only text (PDF rendering modes 3 and 7). */
  readonly discardInvisible?: boolean | undefined;
  readonly mode?: "logical" | "layout" | "raw" | "bbox" | undefined;
  readonly rejoinHyphens?: boolean | "soft" | undefined;
  readonly discardDiagonal?: boolean | undefined;
  readonly clipText?: boolean | undefined;
  /** Discard characters whose baseline advance lies outside these page bounds. */
  readonly pageBounds?: readonly [number, number, number, number] | undefined;
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

  const lines: PdfTextLine[] = [];
  const type3 = options.mode !== "raw" && glyphs.some(g => g.type3FontSize !== undefined) && glyphs.every(g => g.matrix[0] > 0 && g.matrix[1] === 0);
  if (type3) {
    const pool: Type3Word[] = [], words: PdfTextWord[] = [];
    let current: PdfPlacedGlyph[] = [], baseline = 0;
    const flushWord = () => {
      if (!current.length) return;
      let bbox = current[0]!.bbox;
      for (const g of current) bbox = mergeBBox(bbox, g.bbox);
      words.push({ text: current.map(g => g.unicode).join(""), bbox, fontSize: current[0]!.fontSize, fontName: current[0]!.fontName, glyphs: current });
      current = [];
    };
    const flushLine = () => {
      flushWord(); if (!words.length) return;
      let bbox = words[0]!.bbox;
      for (const w of words) bbox = mergeBBox(bbox, w.bbox);
      lines.push({ text: words.map(w => w.text).join(" "), bbox, baselineY: baseline, words: words.splice(0) });
    };
    const program = type3WordOrder(0, options.fixedPitch); let reply: Type3OrderReply;
    for (let step = program.next(); !step.done; step = program.next(reply)) {
      const request = step.value; reply = undefined;
      if (request.kind === "glyph") reply = { glyph: glyphs[request.position]!, next: request.position + 1 < glyphs.length ? request.position + 1 : -1 };
      else if (request.kind === "read") reply = [...pool[request.index]!];
      else if (request.kind === "write") pool[request.index] = [...request.word];
      else {
        if (request.lineStart) { flushLine(); baseline = glyphs[request.first]!.baselineY; }
        else if (request.wordStart) flushWord();
        for (let i = request.first; i !== request.end; i = i + 1 < glyphs.length ? i + 1 : -1) current.push(glyphs[i]!);
      }
    }
    flushLine();
  } else {
  const order = new PdfTextGlyphOrder();
  for (const glyph of glyphs) order.observe(glyph);
  const sortedGlyphs = options.mode === "raw" ? [...glyphs] : glyphs
    .filter(g => !textDirection(g).diagonal || (g.unicode !== " " && g.unicode !== "\t"))
    .sort((a, b) => order.compare(a, b));

  const lineGlyphGroups: PdfPlacedGlyph[][] = [];
  let previousNonSpace: PdfPlacedGlyph | undefined;
  for (const g of sortedGlyphs) {
    const previous = previousNonSpace;
    if (g.unicode !== " " && g.unicode !== "\t") previousNonSpace = g;
    const lastGroup = lineGlyphGroups[lineGlyphGroups.length - 1];
    if (!lastGroup) {
      lineGlyphGroups.push([g]);
      continue;
    }
    const ref = options.mode === "raw" && textDirection(g).diagonal ? previous ?? lastGroup[0]! : lastGroup[0]!;
    if (sameTextLine(ref, g, options.mode === "raw")) {
      lastGroup.push(g);
    } else {
      lineGlyphGroups.push([g]);
    }
  }

  for (const group of lineGlyphGroups) {
    if (options.mode !== "raw") {
      group.sort((a, b) => textDirection(a).along - textDirection(b).along);
    }
    const subLines: PdfPlacedGlyph[][] = [];
    for (const g of group) {
      const cur = subLines[subLines.length - 1];
      if (!cur) {
        subLines.push([g]);
        continue;
      }
      const prev = cur[cur.length - 1]!;
      const gap = textDirection(g).along - (textDirection(prev).along + textDirection(prev).advance);
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
          if (textWordBreak(prev, g, options.mode === "raw")) {
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

  }

  if (!type3 && options.mode === "logical" && lines.length > 2) {
    const midX = displayList.width * 0.5;
    const leftCol = lines.filter(l => l.bbox[2] <= midX + 18);
    const rightCol = lines.filter(l => l.bbox[0] >= midX - 18 && !leftCol.includes(l));
    if (leftCol.length >= 1 && rightCol.length >= 1 && leftCol.length + rightCol.length === lines.length) {
      // Isolated column blocks read across rows in Poppler. Only promote
      // columns containing lines close enough to form a multi-line block.
      const connected = [leftCol, rightCol].some(column => column.some((line, index) => {
        const previous = column[index - 1];
        const gap = previous ? previous.baselineY - line.baselineY : 0;
        return previous && gap > 0 && gap <= (previous.words[0]?.fontSize ?? 12) * 1.5;
      }));
      if (connected) {
        leftCol.sort((a, b) => b.baselineY - a.baselineY);
        rightCol.sort((a, b) => b.baselineY - a.baselineY);
        lines.splice(0, lines.length, ...leftCol, ...rightCol);
      }
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
    const avgSize = (type3 ? prevLine.words[0]?.glyphs[0]?.type3FontSize : undefined) ?? prevLine.words[0]?.glyphs[0]?.fontSize ?? 12;
    const sameColumn = Math.abs(line.bbox[0] - prevLine.bbox[0]) < avgSize * 5;
    const sameKind = prevBlock.kind === lineKind && (lineKind === "paragraph"
      || (options.mode !== "raw" && lineKind === "heading" && lineFontSize === prevLine.words[0]?.fontSize));
    if (sameKind && (type3 ? vGap >= 0 : vGap > 0) && vGap <= avgSize * 1.9 && sameColumn) {
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
    const columns = new Map<PdfTextLine, number>();
    if (!(options.fixedPitch !== undefined && options.fixedPitch > 0)) {
      const horizontal = [...allLines].sort((a, b) => a.bbox[0] - b.bbox[0]);
      for (let i = 0; i < horizontal.length; i++) {
        const line = horizontal[i]!;
        let column = 0;
        for (let j = 0; j < i; j++) {
          const previous = horizontal[j]!;
          // Poppler separates disjoint columns by three characters, independent
          // of the physical gap. Overlapping extents interpolate text columns.
          const offset = line.bbox[0] > previous.bbox[2] ? previous.text.length + 3
            : previous.bbox[2] === previous.bbox[0] ? 0
            : Math.trunc((line.bbox[0] - previous.bbox[0]) / (previous.bbox[2] - previous.bbox[0]) * previous.text.length);
          column = Math.max(column, columns.get(previous)! + offset);
        }
        columns.set(line, column);
      }
    }
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
        if (options.fixedPitch !== undefined && options.fixedPitch > 0) {
          const words = row.flatMap(seg => seg.words).sort((a, b) => a.bbox[0] - b.bbox[0]);
          for (const w of words) {
            const spaces = Math.max(lineStr.length > 0 ? 1 : 0, Math.round(w.bbox[0] / pitch) - lineStr.length);
            lineStr += " ".repeat(Math.min(spaces, 80)) + w.text;
          }
        } else {
          for (const seg of row) {
            const spaces = Math.max(lineStr.length > 0 ? 1 : 0, columns.get(seg)! - lineStr.length);
            lineStr += " ".repeat(Math.min(spaces, 40)) + seg.text;
          }
        }
        let prefixNewlines = "";
        if (rowIdx > 0) {
          const prevY = rows[rowIdx - 1]![0]!.baselineY;
          const curY = row[0]!.baselineY;
          const previous = rows[rowIdx - 1]!.at(-1)!;
          // Poppler truncates the gap in preceding-font units and caps it at five returns.
          const fontSize = previous.words[0]?.fontSize ?? 12;
          const blankCount = options.lineSpacing !== undefined && options.lineSpacing > 0
            ? Math.max(0, Math.min(40, Math.round((prevY - curY) / options.lineSpacing) - 1))
            : Math.max(0, Math.min(4, Math.trunc((previous.baselineY - curY) / (fontSize > 0 ? fontSize : 12)) - 1));
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
        } else if (rejoinHyphens && (out.endsWith("\u00ad") || (rejoinHyphens !== "soft" && out.endsWith("-"))) && startsWithAsciiLower(lineText)) {
          out = out.slice(0, -1) + lineText;
        } else {
          out += "\n" + lineText;
        }
      }
      return out;
    })
    .join(options.mode === "raw" ? "\n" : "\n\n");
}
