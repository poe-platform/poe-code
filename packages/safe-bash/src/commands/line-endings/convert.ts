import type { ConversionOptions, Direction } from "./internal.js";
import { LineEndingError } from "./internal.js";
import { Lifecycle, Reader, Writer } from "./io.js";

export interface UnicodeState { high: number }
export interface ConversionResult { readonly kind: "ok" | "binary" | "unicode" | "bom-error"; readonly encoding: string }

export async function convert(direction: Direction, reader: Reader, writer: Writer, life: Lifecycle, options: ConversionOptions, state: UnicodeState, name: string, stdio: boolean): Promise<ConversionResult> {
  const prefix: number[] = [];
  let bom: "bytes" | "le" | "be" | "utf8" | "gb" = "bytes";
  const diagnostic = async (message: string) => { await life.diagnostic(`${direction}: ${message}\n`); };
  const first = await reader.get();
  let bomError = false;
  if (first !== -1) {
    if (first !== 0xff && first !== 0xfe && first !== 0xef && first !== 0x84) prefix.push(first);
    else {
      const second = await reader.get();
      if (second === -1) bomError = true;
      else if (first === 0xff && second === 0xfe) bom = "le";
      else if (first === 0xfe && second === 0xff) bom = "be";
      else {
        const third = await reader.get();
        if (third === -1) bomError = true;
        else if (first === 0xef && second === 0xbb && third === 0xbf) bom = "utf8";
        else {
          prefix.push(first, second, third);
          if (first === 0x84 && second === 0x31 && third === 0x95) {
            const fourth = await reader.get();
            if (fourth === -1) bomError = true;
            else if (fourth === 0x33) { bom = "gb"; prefix.length = 0; }
            else prefix.push(fourth);
          }
        }
      }
    }
  }
  if (bomError) {
    if (!options.quiet) await diagnostic("can not read from input file: Success");
    return { kind: "bom-error", encoding: "" };
  }
  if (bom === "bytes") bom = options.assume;
  const wide = bom === "le" || bom === "be";
  const encoding = wide ? bom === "le" ? "UTF-16LE" : "UTF-16BE" : "";
  const env = life.budget.context.env;
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || "C";
  const utf8 = locale === "C.UTF-8" || locale === "C.utf8";
  if (wide && !options.keepUtf16 && !utf8 && locale !== "C" && locale !== "POSIX") throw new LineEndingError("UTF-16 conversion supports only C/POSIX and C.UTF-8 locales");
  if (options.addBom || options.keepBom && bom !== "bytes") {
    const bytes = options.keepUtf16 && wide ? bom === "le" ? [0xff, 0xfe] : [0xfe, 0xff] : bom === "gb" ? [0x84, 0x31, 0x95, 0x33] : [0xef, 0xbb, 0xbf];
    for (const byte of bytes) await writer.put(byte);
  }
  let prefixOffset = 0;
  const byte = async () => prefixOffset < prefix.length ? prefix[prefixOffset++]! : await reader.get();
  let pushed = -1;
  const unit = async (): Promise<number> => {
    if (pushed !== -1) { const value = pushed; pushed = -1; return value; }
    const lead = await byte();
    if (lead === -1 || !wide) return lead;
    const trail = await byte();
    return trail === -1 ? -1 : bom === "le" ? lead + trail * 256 : lead * 256 + trail;
  };
  let line = 1;
  const result: { kind: ConversionResult["kind"] } = { kind: "ok" };
  const put = async (value: number): Promise<boolean> => {
    if (!wide) { await writer.put(options.sevenBit && bom === "bytes" && value >= 128 ? 32 : value); return true; }
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
  for (;;) {
    let current = await unit();
    if (current === -1) break;
    if (!options.force && current < 32 && current !== 9 && current !== 10 && current !== 12 && current !== 13) {
      result.kind = "binary";
      if (!options.quiet) await diagnostic(`Binary symbol 0x${current.toString(16).toUpperCase().padStart(wide ? 4 : 2, "0")} found at line ${line}`);
      break;
    }
    if (direction === "dos2unix") {
      if (current === 13) {
        pushed = await unit();
        if (pushed !== 10) { if (!await put(13)) break; }
        else if (options.newline && !await put(10)) break;
      } else {
        if (current === 10) line++;
        if (!await put(current)) break;
      }
    } else {
      if (current === 10) { if (!await put(13)) break; }
      else if (current === 13) {
        current = await unit();
        if (current === -1) current = 13;
        else { if (!await put(13)) break; previous = 13; }
      }
      if (current === 10) line++;
      if (!await put(current)) break;
      if (options.newline && current === 10 && previous !== 13) {
        if (!await put(13) || !await put(10)) break;
      }
      previous = current;
    }
  }
  if (stdio || result.kind === "ok") await writer.flush();
  if (!options.quiet) {
    if (result.kind === "binary") await diagnostic(`Skipping binary file ${name}`);
    if (result.kind === "unicode") await diagnostic(`Skipping UTF-16 file ${name}, an UTF-16 conversion error occurred on line ${line}.`);
  }
  return { kind: result.kind, encoding };
}
