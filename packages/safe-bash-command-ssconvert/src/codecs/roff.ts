import type { Codec } from "./types.js";
import { renderCellText } from "../formatting.js";
import { SsconvertError } from "../contracts.js";
import { documentOutput, documentSheet, documentFont } from "./document-export.js";

/** Gnumeric 1.12.61 plugins/html/roff.c, .me/tbl syntax including native quirks. */
export const writeRoff: NonNullable<Codec["write"]> = async (book, _options, context) => {
  const out = documentOutput(context, "TROFF");
  if (book.sheets.length > context.limits.sheets) throw new SsconvertError("resource-limit", "ssconvert document sheets limit exceeded");
  out.put('.\\" TROFF file\n.fo \'\'%\'\'\n');
  for (const sheet of book.sheets) {
    const { extent: r, cells, styleAt } = documentSheet(sheet, context, out.tick, false);
    out.put(`${sheet.name}\n\n.TS H\nallbox;\n`);
    for (let row = r.startRow; row <= r.endRow; row++) {
      if (row > r.startRow) out.put(".T&\n");
      let vsize = 10;
      for (let col = r.startColumn; col <= r.endColumn; col++) {
        out.tick(); if (col > r.startColumn) out.put(" ");
        const cell = cells.get(`${row}:${col}`);
        if (!cell) { out.put("l"); continue; }
        const style = styleAt(row, col, cell), a = style?.attributes ?? {}, font = documentFont(style), f = font.attributes;
        const align = Number(a.HAlign ?? 1);
        out.put(align & 4 ? "r" : [8, 64, 128].includes(align) ? "c" : "l");
        const bold = Number(f.Bold ?? 0), italic = Number(f.Italic ?? 0);
        if (font.mono || font.helvetica || bold || italic) out.put(`f${font.mono ? "C" : font.helvetica ? "H" : "T"}${bold ? "B" : ""}${italic ? "I" : ""}${!bold && !italic ? "R" : ""}`);
        const size = Math.trunc(Number(f.Unit ?? 10));
        if (size) { out.put(`p${size}`); vsize = Math.max(size, vsize); }
      }
      out.put(`.\n.vs ${(2.5 + vsize).toFixed(2)}p\n`);
      for (let col = r.startColumn; col <= r.endColumn; col++) {
        out.tick(); if (col > r.startColumn) out.put("\t");
        const cell = cells.get(`${row}:${col}`);
        if (!cell) { out.put(" "); continue; }
        if (Number(styleAt(row, col, cell)?.attributes.Hidden ?? 0)) continue;
        const text = await renderCellText(cell, book, context, "preserve");
        for (const c of text) { out.tick(); if (c === "\0") break; out.put(c === "." ? "\\." : c === "\\" ? "\\\\" : c); }
      }
      out.put("\n"); if (row === r.startRow) out.put(".TH\n");
    }
    out.put(".TE\n\n");
  }
  return out.finish();
};
