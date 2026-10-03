import { SsconvertError, type CapabilityContext, type RangeSource } from "@poe-code/spreadsheet-engine/contracts";
import { decodeTextSource } from "@poe-code/spreadsheet-engine/encoding/decode-source";
import { formattingLocale } from "@poe-code/spreadsheet-engine/formatting/locale";
import { MAX_SHEET_SIZE } from "@poe-code/spreadsheet-ast/model";
import type { Cell, Workbook } from "@poe-code/spreadsheet-ast";
import type { WorkbookSource } from "@poe-code/spreadsheet-engine/codecs/types";
import { createTextColumnInference, isPartialTextDate } from "./text-values.js";
import { finishTextImport, probeText, trimSpace } from "./text.js";

/** Only the native 512-byte probe prefix is needed, including short reads. */
export async function probeTextSource(source: RangeSource, context: CapabilityContext): Promise<boolean> {
  context.signal.throwIfAborted();
  if (source.size > context.limits.inputBytes) throw new SsconvertError("resource-limit", "ssconvert input bytes limit exceeded");
  const bytes = new Uint8Array(Math.min(source.size, 512));
  for (let offset = 0; offset < bytes.length;) {
    context.signal.throwIfAborted();
    const chunk = await source.read(offset, bytes.length - offset, { signal: context.signal });
    if (!chunk.length || chunk.length > bytes.length - offset) throw new SsconvertError("io", "Truncated text probe");
    bytes.set(chunk, offset); offset += chunk.length;
  }
  return probeText(bytes, context);
}

/** Fragments never retain a complete physical line; only CRLF needs one carry. */
async function* lines(source: AsyncIterable<string>, ending: string) {
  let carry = "";
  for await (const chunk of source) {
    let text = carry + chunk; carry = "";
    if (ending === "\r\n" && text.endsWith("\r")) { carry = "\r"; text = text.slice(0, -1); }
    let offset = 0;
    while (offset < text.length) {
      const end = text.indexOf(ending, offset);
      if (end < 0) { yield { text: text.slice(offset), end: false }; break; }
      yield { text: text.slice(offset, end), end: true }; offset = end + ending.length;
    }
  }
  if (carry) yield { text: carry, end: false };
}

async function lineEnding(source: AsyncIterable<string>) {
  let cr = 0, lf = 0, crlf = 0, pending = false;
  for await (const text of source) for (const character of text) {
    if (pending) {
      pending = false;
      if (character === "\n") { crlf++; continue; }
      cr++;
    }
    if (character === "\r") pending = true;
    else if (character === "\n") lf++;
  }
  if (pending) cr++;
  const max = Math.max(cr, lf, crlf);
  return { ending: max === lf ? "\n" as const : max === crlf ? "\r\n" as const : "\r" as const,
    unique: [cr, lf, crlf].filter(count => count > 0).length === 1 };
}

const whitespace = (character: string) => /[\p{Z}\u0009-\u000d]/u.test(character);
const punctuation = (character: string) => character !== '"' && /[\p{P}\p{S}]/u.test(character);
type Hint = { startsQuote: boolean; quote: boolean; preceding?: string; following?: string };

async function separator(source: AsyncIterable<string>, ending: string, csv: boolean, decimal: string): Promise<string> {
  const argument = decimal === "," ? ";" : ",", column = decimal === "," ? "\\" : ",";
  const candidates = [...new Set(["\t", argument, column, ":", ",", ";", "|", "!", " "])];
  const counts = candidates.map(() => [] as number[]);
  let current = candidates.map(() => 0), length = 0, index = 0;
  let state: "before" | "inside" | "maybe" | "after" | "done" = "before";
  let hint: Hint = { startsQuote: false, quote: false };
  let first: Hint | undefined, later: Hint | undefined, quoted: Hint | undefined;
  const finish = () => {
    if (length) current.forEach((count, index) => counts[index]!.push(count));
    if (index === 0) first = hint;
    else if (hint.startsQuote) later ??= hint;
    if (hint.quote) quoted ??= hint;
    index++; length = 0; current = candidates.map(() => 0);
    hint = { startsQuote: false, quote: false }; state = "before";
  };
  for await (const fragment of lines(source, ending)) {
    for (const character of fragment.text) {
      if (length++ === 0) hint.startsQuote = character === '"';
      const position = candidates.indexOf(character);
      if (position >= 0) current[position]!++;
      if (!csv) continue;
      if (state === "before") {
        if (character === '"') { hint.quote = true; state = "inside"; }
        else if (punctuation(character)) hint.preceding = character;
      } else if (state === "inside") { if (character === '"') state = "maybe"; }
      else if (state === "maybe") state = character === '"' ? "inside" : "after";
      else if (state === "after" && !whitespace(character)) {
        if (punctuation(character)) hint.following = character;
        state = "done";
      }
    }
    if (fragment.end) { finish(); if (index === 999) break; }
  }
  if (length && index < 999) finish();
  if (csv) {
    const selected = later ?? (first?.startsQuote ? first : undefined) ?? quoted;
    return selected?.following ?? selected?.preceding ?? ",";
  }
  const quantile = (character: string, q: number) => {
    const values = counts[candidates.indexOf(character)]!;
    values.sort((a, b) => a - b);
    return values[Math.min(values.length - 1, Math.ceil(q * values.length))] ?? 0;
  };
  if (quantile("\t", .2) >= 1 && quantile("\t", .2) >= quantile(argument, .2) - 1) return "\t";
  for (const character of [argument, column, ":", ",", ";", "|", "!", " "])
    if (quantile(character, .5)) return character === " " ? " \t" : character;
  return "";
}

/** Retain only decoding and grammar decisions, never input chunks or cells. */
async function textGrammar(source: RangeSource, context: CapabilityContext, encoding?: string) {
  context.signal.throwIfAborted();
  if (source.size > context.limits.inputBytes) throw new SsconvertError("resource-limit", "ssconvert input bytes limit exceeded");
  const text = decodeTextSource(source, context.signal, encoding);
  const { ending, unique } = await lineEnding(text);
  const csv = context.inputFilename?.toLowerCase().endsWith(".csv") ?? false;
  const sep = await separator(text, ending, csv, formattingLocale(context.environment.locale).decimal);
  return { text, ending, unique, csv, sep };
}

/** Parse one cell at a time; each replay has its own decoder and parser state. */
async function* scanTextSource(grammar: Awaited<ReturnType<typeof textGrammar>>, context: CapabilityContext) {
  context.signal.throwIfAborted();
  const { text, ending, unique, csv, sep } = grammar, collapse = sep.includes(" ");
  let count = 0, pending: Cell | undefined;
  const name = context.inputFilename?.slice(context.inputFilename.lastIndexOf("/") + 1) ?? "Sheet1";
  const book: Workbook = { sheets: [{ id: "s1", name, cells: [] }], ...(unique ? { textExportEol: ending } : {}) };
  let row = 0, column = 0, maximumColumns = 0, rowsExceeded = false, field = "", trimmed = false;
  let state: "start" | "plain" | "quoted" | "quote" | "discard" = "start";
  const finish = (separator: boolean) => {
    if (!csv) field = trimSpace(field);
    if (field && column < MAX_SHEET_SIZE.columns) {
      if (count >= context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert cells limit exceeded");
      count++; pending = { row, column, value: { kind: "string", value: field } };
    }
    column++; maximumColumns = Math.max(maximumColumns, column + (separator ? 1 : 0));
    field = ""; state = "start"; trimmed = false;
  };
  const consume = (character: string, eol: boolean) => {
    if (row >= MAX_SHEET_SIZE.rows) { rowsExceeded = true; return; }
    const separated = !eol && (collapse ? sep.includes(character) : !!sep && character === sep);
    if (state === "quoted") {
      if (character === '"' && !eol) state = "quote";
      else field += character;
      return;
    }
    if (state === "quote") {
      if (character === '"' && !eol) { field += '"'; state = "quoted"; return; }
      state = "discard";
    }
    if (state === "discard" && !eol && !separated) return;
    if (state === "start") {
      if (collapse && separated) return;
      if (eol) { if (trimmed) finish(false); row++; column = 0; return; }
      if (!csv && !separated && whitespace(character)) { trimmed = true; return; }
      if (character === '"') { state = "quoted"; return; }
      state = "plain";
    }
    if (eol || separated) {
      finish(separated);
      if (eol) { row++; column = 0; }
    } else field += character;
  };
  for await (const fragment of lines(text, ending)) {
    context.signal.throwIfAborted();
    for (const character of fragment.text) {
      consume(character, false);
      if (pending) { yield pending; pending = undefined; }
    }
    if (fragment.end) consume(ending, true);
    if (pending) { yield pending; pending = undefined; }
    if (rowsExceeded) break;
  }
  if (state !== "start" || trimmed) finish(false);
  if (pending) yield pending;
  return { book, row, column, maximumColumns, rowsExceeded };
}

/** Explicit array-model convenience for SDK readers and global operations. */
export async function readTextSource(source: RangeSource, context: CapabilityContext, encoding?: string): Promise<Workbook> {
  const grammar = await textGrammar(source, context, encoding);
  const scan = scanTextSource(grammar, context), cells: Cell[] = [];
  let next = await scan.next();
  while (!next.done) { cells.push(next.value); next = await scan.next(); }
  const { book, row, column, maximumColumns, rowsExceeded } = next.value;
  return finishTextImport(book, cells, row, column, maximumColumns, rowsExceeded, context);
}

/** Source replay replaces a retained cell array for sequential conversions.
 * Formula-bearing inputs continue through the evaluator until it supports indexes.
 */
export async function readTextWorkbookSource(source: RangeSource, context: CapabilityContext, encoding?: string): Promise<WorkbookSource | undefined> {
  const grammar = await textGrammar(source, context, encoding);
  const scan = scanTextSource(grammar, context);
  const allRows = createTextColumnInference({ sheets: [] }, context, 1);
  const withoutHeader = createTextColumnInference({ sheets: [] }, context, 2);
  let needsEvaluation = false, next = await scan.next();
  while (!next.done) {
    const cell = next.value;
    if (cell.value.kind === "string") {
      const text = cell.value.value;
      // Partial dates consult the clock; replay must not reevaluate them later.
      if (text.startsWith("=") && text.length > 1 || isPartialTextDate(text)) needsEvaluation = true;
    }
    allRows.observe(cell); withoutHeader.observe(cell);
    next = await scan.next();
  }
  if (needsEvaluation) return undefined;
  const { book, row, column, maximumColumns, rowsExceeded } = next.value;
  const metadata = await finishTextImport(book, [], row, column, maximumColumns, rowsExceeded, context);
  const inference = row + (column > 0 ? 1 : 0) > 1 ? withoutHeader : allRows;
  return { metadata, async *cells(sheet) {
    if (sheet !== "s1") throw new SsconvertError("invalid-request", "Unknown text sheet");
    const cells = scanTextSource(grammar, context);
    for await (const cell of cells) yield inference.apply(cell);
  } };
}
