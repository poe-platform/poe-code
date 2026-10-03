// Gnumeric 1.12.61 stf-export.c/stf.c and libgsf 1.14.53 gsf-output-csv.c.
import { SsconvertError, type CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import { exportOptionPairs } from "@poe-code/spreadsheet-engine/cli/export-options";
import { renderCellText, type TextFormatMode } from "@poe-code/spreadsheet-engine/formatting";
import { exportRangeForSheet } from "@poe-code/spreadsheet-engine/workbook/expressions";
import { foldSheetName } from "@poe-code/spreadsheet-ast/case-fold";
import type { Codec } from "@poe-code/spreadsheet-engine/codecs/types";
import { encodeText } from "@poe-code/spreadsheet-engine/encoding/encode";
import { encodeTextStream } from "@poe-code/spreadsheet-engine/encoding/encode-stream";
import { exportLocale } from "@poe-code/spreadsheet-engine/locale/runtime";
import { CodecWriteFailure, TextConverterUnavailable } from "@poe-code/spreadsheet-engine/codecs/write-failure";
import { decodeByteString } from "@poe-code/spreadsheet-ast/byte-value";
import { readByteTextCharacter } from "@poe-code/spreadsheet-engine/encoding/byte-text";

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

function* textField(text: string, options: Pick<TextOptions, "mode" | "quote" | "whitespace">): Generator<string> {
  // Preserve NUL and scan the entire field. Triggers retain the initial
  // configuration even after separator, quote and eol properties change via -O.
  const whitespace = (c: string | undefined) => c !== undefined && c !== "\u000b" && c !== "\ufeff" && c.trim() === "";
  const quoted = options.mode === "always" || options.mode === "auto" &&
    (text.includes(",") || text.includes(" ") || text.includes("\t") || text.includes("\n") || text.includes('"') || options.whitespace &&
      (whitespace(text[0]) || whitespace(text.at(-1))));
  if (!quoted || !options.quote) { yield text; return; }
  yield options.quote;
  let chunk = "";
  for (const c of text) {
    if (options.quote.includes(c)) {
      if (options.quote.length > 4096) { if (chunk) yield chunk; chunk = ""; yield options.quote; }
      else chunk += options.quote;
    }
    chunk += c;
    if (chunk.length >= 4096) { yield chunk; chunk = ""; }
  }
  if (chunk) yield chunk;
  yield options.quote;
}

export function appendTextField(text: string, options: Pick<TextOptions, "mode" | "quote" | "whitespace">, append: (text: string) => void): void {
  for (const chunk of textField(text, options)) append(chunk);
}

async function* textChunks(args: Parameters<NonNullable<Codec["write"]>>, options: TextOptions): AsyncGenerator<string | Uint8Array> {
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
  const tick = () => {
    context.signal.throwIfAborted();
    if (++work > (context.limits.workbookWork ?? context.limits.inputBytes))
      throw new SsconvertError("resource-limit", "ssconvert text export work limit exceeded");
  };
  function* append(text: string) {
    // Bound intermediate storage before retaining chunks. Final encoding admits
    // the actual output bytes, including discarded and expanded transliterations.
    for (const character of text) {
      void character;
      if (++length > renderingContext.limits.outputBytes)
        throw new SsconvertError("resource-limit", "ssconvert output bytes limit exceeded");
    }
    yield text;
  }
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
        if (column !== (range?.startColumn ?? 0)) yield* append(options.separator);
        const cell = cells.get(`${row}:${column}`);
        const value = cell?.cachedResult ?? cell?.value;
        if (value?.kind === "byte-string") {
          const bytes = byteField(decodeByteString(value.value, tick, context.limits.outputBytes), options,
            renderingContext.limits.outputBytes - length, tick);
          length += bytes.length; yield bytes;
        } else {
          for (const chunk of textField(cell ? await renderCellText(cell, book, renderingContext, options.format) : "", options))
            yield* append(chunk);
        }
      }
      yield* append(options.eol);
    }
  }
  context.signal.throwIfAborted();
}

async function* exportText(args: Parameters<NonNullable<Codec["write"]>>, options: TextOptions): AsyncGenerator<Uint8Array> {
  const context = args[2];
  let charset = options.charset, failed = false;
  try { encodeText("", charset, options.transliterate, context); }
  catch (error) {
    context.signal.throwIfAborted();
    if (!(error instanceof TextConverterUnavailable)) throw error;
    charset = "UTF-8"; failed = true;
    await context.diagnostic?.({ code: "text-converter", severity: "warning", message: "Failed to create converter." });
  }
  yield* encodeTextStream(textChunks(args, options), charset, options.transliterate, context);
  if (failed) throw new CodecWriteFailure(new Uint8Array(), "E Error while trying to export file as text");
}

/** Explicit buffering convenience; the engine uses the incremental exporters. */
async function collect(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0, failure: CodecWriteFailure | undefined;
  try { for await (const chunk of source) { chunks.push(chunk.slice()); size += chunk.length; } }
  catch (error) { if (!(error instanceof CodecWriteFailure)) throw error; failure = error; }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (failure) throw new CodecWriteFailure(bytes, failure.message);
  return bytes;
}

export const writeConfigurableTextStream: NonNullable<Codec["writeStream"]> = (...args) => {
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

export const writePlainCsvStream: NonNullable<Codec["writeStream"]> = (...args) => exportText(args,
  { separator: ",", quote: '"', eol: "\n", mode: "auto", whitespace: true,
    format: "automatic", charset: "UTF-8", transliterate: false });

export const writeConfigurableText: NonNullable<Codec["write"]> = (...args) => collect(writeConfigurableTextStream(...args) as AsyncIterable<Uint8Array>);
export const writePlainCsv: NonNullable<Codec["write"]> = (...args) => collect(writePlainCsvStream(...args) as AsyncIterable<Uint8Array>);
