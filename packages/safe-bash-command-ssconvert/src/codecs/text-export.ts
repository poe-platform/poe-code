// Gnumeric 1.12.61 stf-export.c/stf.c and libgsf 1.14.53 gsf-output-csv.c.
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { exportOptionPairs } from "../cli/export-options.js";
import { renderCellText, type TextFormatMode } from "../formatting.js";
import { exportRangeForSheet } from "../workbook/expressions.js";
import { foldSheetName } from "../workbook/case-fold.js";
import type { Codec } from "./types.js";
import { encodeText } from "../encoding/encode.js";
import { exportLocale } from "../locale/runtime.js";
import { CodecWriteFailure, TextConverterUnavailable } from "./write-failure.js";
import { decodeByteString } from "../encoding/byte-value.js";
import { readByteTextCharacter } from "../encoding/byte-text.js";

function byteField(source: Uint8Array, options: TextOptions, maximum: number, tick: () => void): Uint8Array {
  if (!['utf-8', 'utf8'].includes(options.charset.toLowerCase()) || options.quote.length > 1 || options.quote.charCodeAt(0) >= 128)
    throw new SsconvertError("unsupported-feature", "Native byte-string export requires UTF-8 and an ASCII CSV quote");
  const whitespace = (point: number) => point >= 9 && point <= 13 && point !== 11 || point === 32 || point === 0xa0 || point === 0x1680 ||
    point >= 0x2000 && point <= 0x200a || point === 0x2028 || point === 0x2029 || point === 0x202f || point === 0x205f || point === 0x3000;
  let trigger = false;
  const quote = options.quote.charCodeAt(0);
  for (let position = 0; position < source.length;) {
    const character = readByteTextCharacter(source, position, tick);
    if ([44, 32, 9, 10, 34].includes(character.point)) trigger = true;
    position = character.next;
  }
  let last = source.length - 1;
  while (last > 0 && (source[last]! & 192) === 128) { tick(); last--; }
  const quoted = !!options.quote && (options.mode === "always" || options.mode === "auto" &&
    (trigger || options.whitespace && source.length > 0 && (whitespace(readByteTextCharacter(source, 0, tick).point) ||
      whitespace(readByteTextCharacter(source, last, tick).point))));
  if (!quoted) {
    if (source.length > maximum) throw new SsconvertError("resource-limit", "ssconvert output bytes limit exceeded");
    return source;
  }
  const result: number[] = [];
  const append = (bytes: readonly number[]) => {
    if (bytes.length > maximum - result.length) throw new SsconvertError("resource-limit", "ssconvert output bytes limit exceeded");
    for (const byte of bytes) { tick(); result.push(byte); }
  };
  append([quote]);
  // libgsf quoted fields use g_string_append_unichar, including GLib's historical
  // six-byte encoding of unsigned -1. Unquoted fields keep their original bytes.
  for (let position = 0; position < source.length;) {
    const character = readByteTextCharacter(source, position, tick); position = character.next;
    const point = character.point;
    if (point === quote) append([quote]);
    const width = point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : point < 2097152 ? 4 : point < 67108864 ? 5 : 6;
    if (width === 1) { append([point]); continue; }
    const encoded = new Array<number>(width); let remaining = point;
    for (let index = width - 1; index > 0; index--) { encoded[index] = 128 | (remaining & 63); remaining = Math.floor(remaining / 64); }
    encoded[0] = [0, 0, 192, 224, 240, 248, 252][width]! | remaining;
    append(encoded);
  }
  append([quote]);
  return Uint8Array.from(result);
}

interface TextOptions {
  separator: string;
  quote: string;
  eol: string;
  mode: "never" | "auto" | "always";
  whitespace: boolean;
  format: TextFormatMode;
  charset: string;
  transliterate: boolean;
  locale?: string;
}

function appendField(text: string, options: TextOptions, append: (text: string) => void): void {
  // Native strlen stops at NUL. Triggers retain the initial configuration even
  // after separator, quote and eol properties are changed by -O.
  text = text.split("\0", 1)[0]!;
  const whitespace = (c: string | undefined) => c !== undefined && c !== "\u000b" && c !== "\ufeff" && c.trim() === "";
  const quoted = options.mode === "always" || options.mode === "auto" &&
    (text.includes(",") || text.includes(" ") || text.includes("\t") || text.includes("\n") || text.includes('"') || options.whitespace &&
      (whitespace(text[0]) || whitespace(text.at(-1))));
  if (!quoted || !options.quote) { append(text); return; }
  append(options.quote);
  for (const c of text) {
    if (options.quote.includes(c)) append(options.quote);
    append(c);
  }
  append(options.quote);
}

async function exportText(args: Parameters<NonNullable<Codec["write"]>>, options: TextOptions): Promise<Uint8Array> {
  const [book, , suppliedContext, selection] = args;
  const context: CapabilityContext = options.locale === undefined ? suppliedContext : {
    ...suppliedContext, environment: exportLocale(suppliedContext.environment, options.locale)
  };
  // Formatting returns UTF-8 before conversion. Transliteration can discard
  // scalars entirely, so the source-text budget also bounds intermediate storage.
  const renderingContext = ["utf-8", "utf8"].includes(options.charset.toLowerCase()) ? context : {
    ...context, limits: Object.freeze({ ...context.limits,
      outputBytes: Math.min(Number.MAX_SAFE_INTEGER, Math.max(context.limits.outputBytes * 4,
        context.limits.workbookTextBytes ?? context.limits.inputBytes)) })
  };
  let length = 0, work = 0;
  const chunks: (string | Uint8Array)[] = [];
  const tick = () => {
    context.signal.throwIfAborted();
    if (++work > (context.limits.workbookWork ?? context.limits.inputBytes))
      throw new SsconvertError("resource-limit", "ssconvert text export work limit exceeded");
  };
  const append = (text: string) => {
    // Bound intermediate storage before retaining chunks. Final encoding admits
    // the actual output bytes, including discarded and expanded transliterations.
    for (const character of text) {
      void character;
      if (++length > renderingContext.limits.outputBytes)
        throw new SsconvertError("resource-limit", "ssconvert output bytes limit exceeded");
    }
    chunks.push(text);
  };
  const ids = selection?.sheets ?? book.sheets.map(sheet => sheet.id);
  for (const id of ids) {
    tick();
    const sheet = book.sheets.find(sheet => sheet.id === id);
    if (!sheet) throw new SsconvertError("invalid-request", `ssconvert: Unknown sheet "${id}"`);
    const range = selection?.range && exportRangeForSheet(selection.range, book, id);
    if (selection?.range && !range) continue;
    let endRow = 0, endColumn = 0;
    const cells = new Map<string, (typeof sheet.cells)[number]>();
    for (const cell of sheet.cells) {
      tick();
      cells.set(`${cell.row}:${cell.column}`, cell);
      if ((cell.cachedResult ?? cell.value).kind !== "blank") {
        endRow = Math.max(endRow, cell.row); endColumn = Math.max(endColumn, cell.column);
      }
    }
    endRow = range?.endRow ?? endRow; endColumn = range?.endColumn ?? endColumn;
    for (let row = range?.startRow ?? 0; row <= endRow; row++) {
      for (let column = range?.startColumn ?? 0; column <= endColumn; column++) {
        tick();
        if (column !== (range?.startColumn ?? 0)) append(options.separator);
        const cell = cells.get(`${row}:${column}`);
        const value = cell?.cachedResult ?? cell?.value;
        if (value?.kind === "byte-string") {
          const bytes = byteField(decodeByteString(value.value, tick, context.limits.outputBytes), options,
            renderingContext.limits.outputBytes - length, tick);
          length += bytes.length; chunks.push(bytes);
        } else appendField(cell ? await renderCellText(cell, book, renderingContext, options.format) : "", options, append);
      }
      append(options.eol);
    }
  }
  context.signal.throwIfAborted();
  if (chunks.some(chunk => chunk instanceof Uint8Array)) {
    const encoded: Uint8Array[] = []; let size = 0;
    for (const chunk of chunks) {
      tick();
      const bytes = typeof chunk === "string" ? encodeText(chunk, "UTF-8", false, suppliedContext) : chunk;
      if (bytes.length > context.limits.outputBytes - size) throw new SsconvertError("resource-limit", "ssconvert output bytes limit exceeded");
      size += bytes.length; encoded.push(bytes);
    }
    const result = new Uint8Array(size); let offset = 0;
    for (const bytes of encoded) for (const byte of bytes) { tick(); result[offset++] = byte; }
    return result;
  }
  const text = chunks.join("");
  try { return encodeText(text, options.charset, options.transliterate, suppliedContext); }
  catch (error) {
    context.signal.throwIfAborted();
    if (!(error instanceof TextConverterUnavailable)) throw error;
    await context.diagnostic?.({ code: "text-converter", severity: "warning", message: "Failed to create converter." });
    throw new CodecWriteFailure(encodeText(text, "UTF-8", false, context), "E Error while trying to export file as text");
  }
}

export const writeConfigurableText: NonNullable<Codec["write"]> = async (...args) => {
  const options: TextOptions = { separator: ",", quote: '"', eol: args[0].textExportEol ?? "\n", mode: "auto", whitespace: true,
    format: "automatic", charset: "UTF-8", transliterate: true };
  const context = args[2];
  for (const text of args[1]) for (const [key, value] of exportOptionPairs(text)) {
    context.signal.throwIfAborted();
    switch (key) {
      case "separator": options.separator = value; break;
      case "quote": options.quote = value; break;
      case "eol": options.eol = { unix: "\n", mac: "\r", windows: "\r\n" }[value.toLowerCase()]!; break;
      case "charset": options.charset = value; break;
      case "locale":
        options.locale = value;
        break;
      case "format": options.format = ({ GNM_STF_FORMAT_AUTO: "automatic", GNM_STF_FORMAT_RAW: "raw",
        GNM_STF_FORMAT_PRESERVE: "preserve" } as Record<string, TextFormatMode>)[value] ?? value as TextFormatMode; break;
      case "quoting-mode": options.mode = ({ GSF_OUTPUT_CSV_QUOTING_MODE_NEVER: "never", GSF_OUTPUT_CSV_QUOTING_MODE_AUTO: "auto",
        GSF_OUTPUT_CSV_QUOTING_MODE_ALWAYS: "always" } as Record<string, TextOptions["mode"]>)[value] ?? value as TextOptions["mode"]; break;
      case "quoting-on-whitespace": options.whitespace = ["true", "yes", "1"].includes(foldSheetName(value)); break;
      case "transliterate-mode": options.transliterate = ["transliterate", "GNM_STF_TRANSLITERATE_MODE_TRANS"].includes(value); break;
    }
  }
  return exportText(args, options);
};

export const writePlainCsv: NonNullable<Codec["write"]> = async (...args) => exportText(args,
  { separator: ",", quote: '"', eol: "\n", mode: "auto", whitespace: true,
    format: "automatic", charset: "UTF-8", transliterate: false });
