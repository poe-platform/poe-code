import { Lifecycle } from "./lifecycle.js";
import type { Encoding, Parsed } from "./options.js";
import { cTransliterations } from "./transliterations.js";
import { windows1252, latin2, latin9, jis0208, jis0212 } from "./encoding-tables.js";

type Decoded = { readonly count: number; readonly value: number } | { readonly count: number; readonly error: "illegal" | "incomplete" };
export interface ConversionState { swap: boolean }

const LATIN1_DECODED: readonly Decoded[] = Array.from({ length: 256 }, (_, value) => ({ count: 1, value }));
const BYTE_ENCODED: readonly (readonly number[])[] = Array.from({ length: 256 }, (_, value) => [value]);
const singleByteTables: Partial<Record<Encoding, string>> = { windows1252, latin2, latin9 };
// Fixed-size reverse indexes keep conversion work constant per input character.
const reverseTables = new Map([windows1252, latin2, latin9, jis0208, jis0212].map(table => {
  const reverse = new Map<number, number>();
  for (let index = 0; index < table.length; index++) {
    const value = table.charCodeAt(index);
    if (value && !reverse.has(value)) reverse.set(value, index);
  }
  return [table, reverse] as const;
}));

function decode(input: Uint8Array, offset: number, encoding: Encoding, swap: boolean): Decoded {
  const first = input[offset]!;
  if (encoding === "ascii") return first < 128 ? LATIN1_DECODED[first]! : { count: 1, error: "illegal" };
  if (encoding === "latin1") return LATIN1_DECODED[first]!;
  const table = singleByteTables[encoding];
  if (table) {
    const value = first < 128 ? first : table.charCodeAt(first - 128);
    return value || first === 0 ? { count: 1, value } : { count: 1, error: "illegal" };
  }
  if (encoding === "sjis" || encoding === "eucjp") {
    if (first < 128) return { count: 1, value: encoding === "sjis" && first === 0x5c ? 0xa5 : encoding === "sjis" && first === 0x7e ? 0x203e : first };
    if (encoding === "sjis" && first >= 0xa1 && first <= 0xdf) return { count: 1, value: 0xff61 + first - 0xa1 };
    const count = encoding === "eucjp" && first === 0x8f ? 3 : 2;
    const validLead = encoding === "sjis" ? (first >= 0x81 && first <= 0x9f || first >= 0xe0 && first <= 0xef)
      : first === 0x8e || first === 0x8f || first >= 0xa1 && first <= 0xfe;
    if (!validLead) return { count: 1, error: "illegal" };
    for (let index = 1; index < count; index++) {
      if (offset + index >= input.length) return { count: 0, error: "incomplete" };
      const byte = input[offset + index]!;
      const valid = encoding === "sjis" ? byte >= 0x40 && byte <= 0xfc && byte !== 0x7f
        : byte >= 0xa1 && byte <= (first === 0x8e ? 0xdf : 0xfe);
      if (!valid) return { count: 1, error: "illegal" };
    }
    const second = input[offset + 1]!;
    if (encoding === "eucjp" && first === 0x8e) return { count, value: 0xff61 + second - 0xa1 };
    let row: number, column: number;
    if (encoding === "sjis") {
      row = (first - (first < 0xa0 ? 0x81 : 0xc1)) * 2;
      if (second >= 0x9f) { row++; column = second - 0x9f; }
      else column = second - (second < 0x7f ? 0x40 : 0x41);
    } else {
      row = (count === 3 ? second : first) - 0xa1;
      column = input[offset + count - 1]! - 0xa1;
    }
    const value = (count === 3 ? jis0212 : jis0208).charCodeAt(row * 94 + column);
    return value ? { count, value } : { count: 1, error: "illegal" };
  }
  if (encoding.startsWith("utf32")) {
    if (offset + 3 >= input.length) return { count: 0, error: "incomplete" };
    const big = encoding === "utf32be" || encoding === "utf32" && swap;
    let value = 0;
    for (let index = 0; index < 4; index++) value = value * 256 + input[offset + (big ? index : 3 - index)]!;
    return value > 0x10ffff || value >= 0xd800 && value <= 0xdfff ? { count: 4, error: "illegal" } : { count: 4, value };
  }
  if (encoding === "utf8") {
    if (first < 128) return LATIN1_DECODED[first]!;
    let count = 0, value = 0;
    if (first >= 0xc2 && first < 0xe0) { count = 2; value = first & 0x1f; }
    else if (first >= 0xe0 && first < 0xf0) { count = 3; value = first & 0x0f; }
    else if (first >= 0xf0 && first < 0xf5) { count = 4; value = first & 0x07; }
    else {
      count = 1;
      while (count < 5 && offset + count < input.length && (input[offset + count]! & 0xc0) === 0x80) count++;
      return { count, error: "illegal" };
    }
    for (let index = 1; index < count; index++) {
      if (offset + index >= input.length) return { count: 0, error: "incomplete" };
      const byte = input[offset + index]!;
      if ((byte & 0xc0) !== 0x80) return { count: index, error: "illegal" };
      value = value * 64 + (byte & 0x3f);
    }
    if ((count > 2 && value < 2 ** (5 * count - 4)) || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return { count, error: "illegal" };
    return { count, value };
  }
  if (offset + 1 >= input.length) return { count: 0, error: "incomplete" };
  const big = encoding === "utf16be" || encoding === "utf16" && swap;
  const word = big ? first * 256 + input[offset + 1]! : first + input[offset + 1]! * 256;
  if (word < 0xd800 || word > 0xdfff) return { count: 2, value: word };
  if (word >= 0xdc00) return { count: 2, error: "illegal" };
  if (offset + 3 >= input.length) return { count: 0, error: "incomplete" };
  const next = big ? input[offset + 2]! * 256 + input[offset + 3]! : input[offset + 2]! + input[offset + 3]! * 256;
  if (next < 0xdc00 || next > 0xdfff) return { count: 2, error: "illegal" };
  return { count: 4, value: 0x10000 + (word - 0xd800) * 1024 + next - 0xdc00 };
}

function encode(value: number, encoding: Encoding): readonly number[] | undefined {
  if (value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return undefined;
  const table = singleByteTables[encoding];
  if (table) {
    if (value < 128) return BYTE_ENCODED[value]!;
    const index = reverseTables.get(table)!.get(value);
    return index === undefined ? undefined : [index + 128];
  }
  if (encoding === "sjis" || encoding === "eucjp") {
    if (value < 128) return BYTE_ENCODED[value]!;
    if (value === 0xa5) return [0x5c];
    if (value === 0x203e) return [0x7e];
    if (value >= 0xff61 && value <= 0xff9f) return encoding === "sjis" ? [value - 0xff61 + 0xa1] : [0x8e, value - 0xff61 + 0xa1];
    const index = reverseTables.get(jis0208)!.get(value);
    if (index === undefined) {
      const supplementary = reverseTables.get(jis0212)!.get(value);
      return encoding === "eucjp" && supplementary !== undefined ? [0x8f, Math.floor(supplementary / 94) + 0xa1, supplementary % 94 + 0xa1] : undefined;
    }
    const row = Math.floor(index / 94), column = index % 94;
    if (encoding === "eucjp") return [row + 0xa1, column + 0xa1];
    return [Math.floor(row / 2) + (row < 62 ? 0x81 : 0xc1), column + (row % 2 ? 0x9f : column < 63 ? 0x40 : 0x41)];
  }
  if (encoding.startsWith("utf32")) {
    const bytes = [value & 255, value >> 8 & 255, value >> 16 & 255, 0];
    return encoding === "utf32be" ? bytes.reverse() : bytes;
  }
  if (encoding === "ascii" || encoding === "latin1") {
    if (value < (encoding === "ascii" ? 128 : 256)) return BYTE_ENCODED[value]!;
    if (value >= 0xe0000 && value <= 0xe007f) return [];
    return undefined;
  }
  if (encoding === "utf8") {
    if (value < 128) return BYTE_ENCODED[value]!;
    let count = 2;
    while (count < 4 && value >= 2 ** (5 * count + 1)) count++;
    const result = new Array<number>(count);
    for (let index = count - 1; index > 0; index--) { result[index] = 0x80 | (value & 0x3f); value = Math.floor(value / 64); }
    result[0] = (256 - 2 ** (8 - count)) | value;
    return result;
  }
  const words = value < 0x10000 ? [value] : [0xd800 + Math.floor((value - 0x10000) / 1024), 0xdc00 + (value - 0x10000) % 1024];
  const result: number[] = [];
  for (const word of words) {
    if (encoding === "utf16be") result.push(word >> 8, word & 255);
    else result.push(word & 255, word >> 8);
  }
  return result;
}

export async function convert(input: Uint8Array, options: Parsed, state: ConversionState, lifecycle: Lifecycle): Promise<{ status: number; fatal: boolean }> {
  const { budget } = lifecycle;
  budget.retain(32_768 + 256);
  const buffer = new Uint8Array(32_768);
  let used = 0, offset = 0, status = 0, batchCount = 0;
  let targetSuppressed = false, started = false, firstTargetBatch = true;
  const flush = async (): Promise<void> => {
    if (used) { await lifecycle.write(buffer.slice(0, used)); used = 0; }
  };
  const flushFullOutput = async (): Promise<void> => {
    await flush(); batchCount = 1; targetSuppressed = false; firstTargetBatch = false;
  };
  const append = (bytes: readonly number[], transliterated = false): void | Promise<void> => {
    const recursiveBom = transliterated && firstTargetBatch && options.to === "utf16";
    if (!recursiveBom && bytes.length === 1 && used < buffer.length) {
      buffer[used++] = bytes[0]!;
      return;
    }
    if (buffer.length - used < bytes.length + (recursiveBom ? 2 : 0)) {
      return flushFullOutput().then(() => {
        buffer.set(bytes, used); used += bytes.length;
      });
    }
    if (recursiveBom) { buffer[used++] = 0xff; buffer[used++] = 0xfe; }
    buffer.set(bytes, used); used += bytes.length;
  };
  try {
    state.swap = false;
    if (options.from === "utf32" && input.length >= 4) {
      if (input[0] === 0 && input[1] === 0 && input[2] === 0xfe && input[3] === 0xff) { state.swap = true; offset = 4; }
      else if (input[0] === 0xff && input[1] === 0xfe && input[2] === 0 && input[3] === 0) offset = 4;
    }
    if (options.from === "utf16" && input.length >= 2) {
      if (input[0] === 0xfe && input[1] === 0xff) { state.swap = true; offset = 2; }
      else if (input[0] === 0xff && input[1] === 0xfe) offset = 2;
    }
    const asciiDirect = (options.from === "utf8" || options.from === "ascii" || options.from === "latin1")
      && (options.to === "utf8" || options.to === "ascii" || options.to === "latin1");
    while (offset < input.length) {
      if (asciiDirect && input[offset]! < 128 && used < buffer.length && batchCount < 8160) {
        const maxRun = Math.min(input.length - offset, buffer.length - used, 8160 - batchCount, 256);
        let run = 1;
        while (run < maxRun && input[offset + run]! < 128) run++;
        budget.charge(run * 16);
        { const cp = budget.checkpointWork(); if (cp) await cp; }
        buffer.set(input.subarray(offset, offset + run), used);
        used += run;
        offset += run;
        batchCount += run;
        started = true;
        if (batchCount === 8160) {
          batchCount = 0;
          firstTargetBatch = false;
          if (targetSuppressed) {
            status = 1; await flush(); targetSuppressed = false;
          }
        }
        continue;
      }
      budget.charge(16);
      { const cp = budget.checkpointWork(); if (cp) await cp; }
      const decoded = decode(input, offset, options.from, state.swap);
      let error: "illegal" | "incomplete" | undefined;
      if ("error" in decoded) error = decoded.error;
      else {
        batchCount++;
        if (buffer.length - used < (options.to.startsWith("utf16") ? 2 : 1)) await flushFullOutput();
        if (!started && options.to === "utf16") { const a = append([0xff, 0xfe]); if (a) await a; }
        if (!started && options.to === "utf32") { const a = append([0xff, 0xfe, 0, 0]); if (a) await a; }
        started = true;
        let bytes = encode(decoded.value, options.to);
        const transliterated = bytes === undefined && options.transliterate !== false;
        if (transliterated) {
          let replacement = Object.hasOwn(cTransliterations, decoded.value) ? cTransliterations[decoded.value]! : "?";
          if (options.transliterate === "UTF-8") {
            // Canonically decomposed accents reduce to their ASCII base in UTF-8 locales.
            let base = "";
            for (const character of String.fromCodePoint(decoded.value).normalize("NFD")) {
              const value = character.codePointAt(0)!;
              if (value >= 0x300 && value <= 0x36f) continue;
              if (value >= 128) { base = "?"; break; }
              base += character;
            }
            if (base !== "?") replacement = base;
          }
          budget.charge(replacement.length + 1);
          const mutableBytes: number[] = [];
          for (const character of replacement) mutableBytes.push(...encode(character.charCodeAt(0), options.to)!);
          bytes = mutableBytes;
        }
        if (bytes === undefined) { error = "illegal"; targetSuppressed = true; }
        else { const a = append(bytes, transliterated); if (a) await a; }
      }
      if (error === "illegal" && options.discard) status = 1;
      else if (error) {
        await flush();
        await lifecycle.diagnostic(error === "illegal" ? `illegal input sequence at position ${offset}` : "incomplete character or shift sequence at end of buffer");
        return { status: 1, fatal: true };
      }
      offset += decoded.count;
      if (batchCount === 8160) {
        batchCount = 0;
        firstTargetBatch = false;
        if (targetSuppressed) {
          status = 1; await flush(); targetSuppressed = false;
        }
      }
    }
    await flush();
    return { status, fatal: false };
  } finally { budget.retain(-32_768 - 256); }
}
