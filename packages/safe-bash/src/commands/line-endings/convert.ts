import type { ConversionOptions, Direction } from "./internal.js";
import { LineEndingError } from "./internal.js";
import { Lifecycle, Reader, Writer } from "./io.js";
import { encodingLabels, readEncoding } from "./encoding.js";

export interface UnicodeState { high: number }
export interface ConversionResult { readonly kind: "ok" | "binary" | "unicode" | "bom-error"; readonly encoding: string }

export async function convert(direction: Direction, reader: Reader, writer: Writer, life: Lifecycle, options: ConversionOptions, state: UnicodeState, name: string, stdio: boolean): Promise<ConversionResult> {
  const diagnostic = async (message: string) => { await life.diagnostic(`${direction}: ${message}\n`); };
  const input = await readEncoding(reader);
  if (input.error) {
    if (!options.quiet) await diagnostic("can not read from input file: Success");
    return { kind: "bom-error", encoding: "" };
  }
  const bom = input.bom === "bytes" ? options.assume : input.bom;
  if (options.verbose) {
    if (options.assume !== "bytes") await diagnostic(`Assuming UTF-16${options.assume === "le" ? "LE" : "BE"} encoding.`);
    if (input.bom !== "bytes") await diagnostic(`Input file ${name} has ${encodingLabels[input.bom]} BOM.`);
  }
  const wide = bom === "le" || bom === "be";
  const encoding = wide ? bom === "le" ? "UTF-16LE" : "UTF-16BE" : "";
  const env = life.budget.context.env;
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || "C";
  const utf8 = locale === "C.UTF-8" || locale === "C.utf8";
  if (wide && !options.keepUtf16 && !utf8 && locale !== "C" && locale !== "POSIX") throw new LineEndingError("UTF-16 conversion supports only C/POSIX and C.UTF-8 locales");
  if (options.addBom || options.keepBom && bom !== "bytes") {
    const bytes = options.keepUtf16 && wide ? bom === "le" ? [0xff, 0xfe] : [0xfe, 0xff] : bom === "gb" ? [0x84, 0x31, 0x95, 0x33] : [0xef, 0xbb, 0xbf];
    for (const byte of bytes) await writer.put(byte);
    if (options.verbose) await diagnostic(`Writing ${options.keepUtf16 && wide ? encodingLabels[bom] : bom === "gb" ? "GB18030" : "UTF-8"} BOM.`);
  }
  const byte = input.byte;
  let pushed = -1;
  const unit = (): number | Promise<number> => {
    if (pushed !== -1) { const value = pushed; pushed = -1; return value; }
    const lead = byte();
    if (typeof lead === "number") {
      if (lead === -1 || !wide) return lead;
      const trail = byte();
      if (typeof trail === "number") return trail === -1 ? -1 : bom === "le" ? lead + trail * 256 : lead * 256 + trail;
      return trail.then(t => t === -1 ? -1 : bom === "le" ? lead + t * 256 : lead * 256 + t);
    }
    return lead.then(async l => {
      if (l === -1 || !wide) return l;
      const trail = await byte();
      return trail === -1 ? -1 : bom === "le" ? l + trail * 256 : l * 256 + trail;
    });
  };
  let line = 1;
  const result: { kind: ConversionResult["kind"] } = { kind: "ok" };
  const put = (value: number): boolean | Promise<boolean> => {
    if (!wide) {
      const p = writer.put(options.sevenBit && bom === "bytes" && value >= 128 ? 32 : value);
      return p ? p.then(() => true) : true;
    }
    return putWide(value);
  };
  const putWide = async (value: number): Promise<boolean> => {
    if (options.keepUtf16) {
      await writer.put(bom === "le" ? value & 255 : value >> 8);
      await writer.put(bom === "le" ? value >> 8 : value & 255);
      return true;
    }
    if (state.high >= 0xd800 && state.high < 0xdc00 && (value < 0xdc00 || value >= 0xe000)) {
      await diagnostic("error: Invalid surrogate pair. Missing low surrogate."); result.kind = "unicode"; return false;
    }
    if (value >= 0xd800 && value < 0xdc00) { state.high = value; return true; }
    if (value >= 0xdc00 && value < 0xe000) {
      if (!(state.high >= 0xd800 && state.high < 0xdc00)) {
        await diagnostic("error: Invalid surrogate pair. Missing high surrogate."); result.kind = "unicode"; return false;
      }
      value = 0x10000 + (state.high & 1023) * 1024 + (value & 1023); state.high = 1;
    }
    if (!utf8 && value > 127) {
      if (!options.quiet) await diagnostic("Invalid or incomplete multibyte or wide character");
      result.kind = "unicode"; return false;
    }
    if (value < 128) await writer.put(value);
    else if (value < 2048) { await writer.put(0xc0 | value >> 6); await writer.put(0x80 | value & 63); }
    else if (value < 65536) { await writer.put(0xe0 | value >> 12); await writer.put(0x80 | value >> 6 & 63); await writer.put(0x80 | value & 63); }
    else { await writer.put(0xf0 | value >> 18); await writer.put(0x80 | value >> 12 & 63); await writer.put(0x80 | value >> 6 & 63); await writer.put(0x80 | value & 63); }
    return true;
  };
  let previous = 0;
  let last = -1, converted = 0;
  for (;;) {
    const u = unit();
    const current = typeof u === "number" ? u : await u;
    if (current === -1) break;
    last = current;
    if (!options.force && current < 32 && current !== 9 && current !== 10 && current !== 12 && current !== 13) {
      result.kind = "binary";
      if (!options.quiet) await diagnostic(`Binary symbol 0x${current.toString(16).toUpperCase().padStart(wide ? 4 : 2, "0")} found at line ${line}`);
      break;
    }
    if (direction === "dos2unix") {
      if (current === 13) {
        const u2 = unit();
        pushed = typeof u2 === "number" ? u2 : await u2;
        if (pushed !== 10) { const ok = put(13); if (!(typeof ok === "boolean" ? ok : await ok)) break; }
        else { converted++; last = 10; if (options.newline) { const ok = put(10); if (!(typeof ok === "boolean" ? ok : await ok)) break; } }
      } else {
        if (current === 10) line++;
        const ok = put(current);
        if (!(typeof ok === "boolean" ? ok : await ok)) break;
      }
    } else {
      if (current === 10 && previous !== 13) { converted++; const ok = put(13); if (!(typeof ok === "boolean" ? ok : await ok)) break; }
      if (current === 10) line++;
      const ok = put(current);
      if (!(typeof ok === "boolean" ? ok : await ok)) break;
      if (options.newline && current === 10) {
        const ok1 = put(13);
        if (!(typeof ok1 === "boolean" ? ok1 : await ok1)) break;
        const ok2 = put(10);
        if (!(typeof ok2 === "boolean" ? ok2 : await ok2)) break;
      }
      previous = current;
    }
  }
  if (result.kind === "ok" && options.addEol && last !== -1 && last !== 10) {
    if (options.verbose) await diagnostic("Added line break to last line.");
    if (direction === "unix2dos") await put(13);
    await put(10);
  }
  if (result.kind === "ok" && options.verbose) await diagnostic(`Converted ${converted} out of ${line - 1} line breaks.`);
  if (stdio || result.kind === "ok") await writer.flush();
  if (!options.quiet) {
    if (result.kind === "binary") await diagnostic(`Skipping binary file ${name}`);
    if (result.kind === "unicode") await diagnostic(`Skipping UTF-16 file ${name}, an UTF-16 conversion error occurred on line ${line}.`);
  }
  return { kind: result.kind, encoding };
}
