import type { PagedStorage } from "@poe-code/safe-fs/storage";
import { RetainedOfficeBlocks } from "./retained-office-blocks.js";
import { retainTextTable } from "./retained-text-table.js";
import { retainCsv } from "./retained-csv.js";
import { retainXlsxText } from "./retained-xlsx.js";
import { retainTextPdf } from "./retained-pdf.js";
import { retainOfficeXml } from "./retained-docx.js";
import { docxDocumentPrefix, docxDocumentSuffix } from "./docx-parts.js";
import { xlsxMetadata, xlsxDocumentPrefix, xlsxDocumentSuffix } from "./xlsx-parts.js";
import { escapeHtmlText } from "./html.js";
import type { RetainedSofficeContext, SofficeSnapshot } from "./retained-input.js";

/** Keep spreadsheet structure and all encoded output in the caller's backing. */
export async function retainSpreadsheetConversion(storage: PagedStorage, source: SofficeSnapshot, context: RetainedSofficeContext,
  format: string, title: string, filter?: string, input: "xlsx" | "csv" | "text" | "markdown" = "xlsx"): Promise<SofficeSnapshot> {
  const { signal } = context, blocks = new RetainedOfficeBlocks(storage, signal), encoder = new TextEncoder();
  if (input === "text" || input === "markdown") await retainTextTable(storage, source, blocks, signal, input === "markdown");
  else if (input === "csv") await retainCsv(storage, source, blocks, signal);
  else await retainXlsxText(storage, source, context, blocks);
  const snapshot = blocks.snapshot(), table = (await blocks.table(snapshot, 0))!;
  const escapeXml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  let separator = ",", quote = '"', quoteAll = false;
  if (filter && format === "csv") {
    const parts = filter.split(","), sep = Number.parseInt(parts[0] ?? "44", 10), quoted = Number.parseInt(parts[1] ?? "34", 10);
    if (Number.isFinite(sep) && sep > 0) separator = String.fromCharCode(sep);
    if (Number.isFinite(quoted) && quoted > 0) quote = String.fromCharCode(quoted);
    quoteAll = parts[6] === "true";
  }
  async function* cellText(row: number, cell: number): AsyncGenerator<string> {
    const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
    for await (const bytes of table.streamCell(row, cell)) for (let offset = 0; offset < bytes.length; offset += 4096) {
      signal.throwIfAborted(); yield decoder.decode(bytes.subarray(offset, offset + 4096), { stream: true });
    }
    yield decoder.decode();
  }
  async function* markup(): AsyncGenerator<string> {
    if (format === "html") yield `<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>${escapeHtmlText(title)}</title></head><body>\n<table>\n`;
    else if (format === "docx") yield docxDocumentPrefix + "<w:tbl>";
    else if (format === "xlsx") yield xlsxDocumentPrefix;
    for (let row = 0; row < table.rows; row++) {
      signal.throwIfAborted();
      if (format === "html") yield "  <tr>";
      else if (format === "docx") yield "<w:tr>";
      else if (format === "xlsx") yield `<row r="${row + 1}">`;
      else if (row) yield "\n";
      const cells = await table.cells(row);
      for (let cell = 0; cell < cells; cell++) {
        if (format === "csv") {
          if (cell) yield separator;
          let quoted = quoteAll;
          if (!quoted) for await (const text of cellText(row, cell)) if (text.includes(separator) || text.includes(quote) || text.includes("\n") || text.includes("\r")) { quoted = true; break; }
          if (quoted) yield quote;
          for await (const text of cellText(row, cell)) yield quoted ? text.replaceAll(quote, quote + quote) : text;
          if (quoted) yield quote;
        } else if (!["html", "docx", "xlsx"].includes(format)) {
          if (cell) yield "\t";
          yield* cellText(row, cell);
        } else {
          if (format === "html") yield "<td>";
          else if (format === "docx") yield "<w:tc><w:p><w:r><w:t>";
          else {
            let letters = "";
            for (let column = cell + 1; column > 0; column = Math.floor((column - 1) / 26)) letters = String.fromCharCode(65 + (column - 1) % 26) + letters;
            yield `<c r="${letters}${row + 1}" t="inlineStr"><is><t>`;
          }
          for await (const text of cellText(row, cell)) yield format === "html" ? escapeHtmlText(text) : escapeXml(text);
          yield format === "html" ? "</td>" : format === "docx" ? "</w:t></w:r></w:p></w:tc>" : "</t></is></c>";
        }
      }
      if (format === "html") yield "</tr>\n";
      else if (format === "docx") yield "</w:tr>";
      else if (format === "xlsx") yield "</row>";
    }
    if (format === "html") yield "</table>\n</body></html>\n";
    else if (format === "docx") yield "</w:tbl>" + docxDocumentSuffix;
    else if (format === "xlsx") yield xlsxDocumentSuffix;
    else yield "\n";
  }
  async function* chunks(): AsyncGenerator<Uint8Array> {
    for await (const text of markup()) {
      const bytes = encoder.encode(text);
      for (let offset = 0; offset < bytes.length; offset += 16384) { signal.throwIfAborted(); yield bytes.subarray(offset, offset + 16384); }
    }
  }
  const archive = format === "pdf" ? await retainTextPdf(storage, blocks, snapshot, title, context, filter)
    : format === "docx" ? await retainOfficeXml(storage, chunks(), signal)
    : format === "xlsx" ? await retainOfficeXml(storage, chunks(), signal, { metadata: xlsxMetadata, documentPath: "xl/worksheets/sheet1.xml" }) : undefined;
  const output = archive ? () => archive.read() : chunks;
  let size = archive?.size ?? 0;
  if (!archive) for await (const bytes of output()) {
    size += bytes.length; if (!Number.isSafeInteger(size)) throw new RangeError("Output exceeds safe storage addressing");
  }
  const position = storage.allocate(size); let written = 0;
  for await (const bytes of output()) for (let offset = 0; offset < bytes.length; offset += 16384) {
    signal.throwIfAborted(); const part = bytes.subarray(offset, offset + 16384);
    await storage.write(position + written, part); written += part.length;
  }
  return { position, size };
}
