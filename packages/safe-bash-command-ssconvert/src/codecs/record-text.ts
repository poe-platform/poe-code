import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { Cell, Workbook } from "../workbook.js";
import { inferText } from "../workbook/updates/inference.js";
import { parseExpression } from "../formulas/parser.js";
import { gnumericGrammar } from "../formulas/conventions.js";
import { serializeExpression } from "../formulas/serialization.js";

/** libgsf ASCII text lines, decoded as ISO-8859-1, not WHATWG Windows-1252. */
export function recordInput(bytes: Uint8Array, context: CapabilityContext, name: string) {
  context.signal.throwIfAborted();
  if (bytes.length > context.limits.inputBytes) throw new SsconvertError("resource-limit", `ssconvert ${name} input bytes limit exceeded`);
  let offset = 0, line = 0;
  return {
    get line() { return line; },
    async next(): Promise<string | undefined> {
      context.signal.throwIfAborted();
      if (offset >= bytes.length) return undefined;
      const chunks: string[] = [];
      while (offset < bytes.length && bytes[offset] !== 10 && bytes[offset] !== 13) {
        const start = offset;
        while (offset < bytes.length && bytes[offset] !== 10 && bytes[offset] !== 13 && offset - start < 4096) offset++;
        chunks.push(String.fromCharCode(...bytes.subarray(start, offset)));
        context.signal.throwIfAborted();
      }
      if (bytes[offset++] === 13 && bytes[offset] === 10) offset++;
      line++;
      if (line % 128 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); context.signal.throwIfAborted(); }
      const text = chunks.join("");
      const nul = text.indexOf("\0");
      return nul < 0 ? text : text.slice(0, nul);
    }
  };
}

export function enteredRecord(text: string, row: number, column: number, context: CapabilityContext): Cell {
  const book: Workbook = { sheets: [] };
  if (text.startsWith("=")) {
    const parsed = parseExpression(text, { position: { sheet: "Sheet1", row, column }, signal: context.signal,
      maximumNodes: context.limits.operations, maximumLength: context.limits.inputBytes });
    if (parsed.ok) return { row, column, value: { kind: "blank" }, cachedResult: { kind: "blank" }, formula: serializeExpression(parsed.document, gnumericGrammar, false, true), formulaDirty: false };
  }
  if (["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A"].includes(text))
    return { row, column, value: { kind: "error", value: text } };
  const inferred = inferText(text, book);
  const valueFormat = inferred.format === "0%" ? "0.00%" : inferred.format === "yyyy-mm-dd" ? "yyyy-mmm-dd" : inferred.format;
  return { row, column, value: inferred.value, ...(valueFormat ? { style: { gnumericValueFormat: valueFormat } } : {}) };
}

export function recordSheet(book: Workbook) {
  const sheet = book.sheets.find(s => s.id === book.activeSheet) ?? book.sheets[0];
  if (!sheet) throw new SsconvertError("io", "Cannot get default sheet.");
  return sheet;
}
