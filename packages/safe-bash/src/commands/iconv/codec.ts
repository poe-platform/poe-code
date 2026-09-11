import { Lifecycle } from "./lifecycle.js";
import type { Encoding, Parsed } from "./options.js";
import { cTransliterations } from "./transliterations.js";

type Decoded = { readonly count: number; readonly value: number } | { readonly count: number; readonly error: "illegal" | "incomplete" };
export interface ConversionState { swap: boolean }

function decode(input: Uint8Array, offset: number, encoding: Encoding, swap: boolean): Decoded {
  const first = input[offset]!;
  if (encoding === "ascii") return first < 128 ? { count: 1, value: first } : { count: 1, error: "illegal" };
  if (encoding === "latin1") return { count: 1, value: first };
  if (encoding === "utf8") {
    if (first < 128) return { count: 1, value: first };
    let count = 0, value = 0;
    if (first >= 0xc2 && first < 0xe0) { count = 2; value = first & 0x1f; }
    else if (first >= 0xe0 && first < 0xf0) { count = 3; value = first & 0x0f; }
    else if (first >= 0xf0 && first < 0xf8) { count = 4; value = first & 0x07; }
    else if (first >= 0xf8 && first < 0xfc) { count = 5; value = first & 0x03; }
    else if (first >= 0xfc && first < 0xfe) { count = 6; value = first & 0x01; }
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
    if ((count > 2 && value < 2 ** (5 * count - 4)) || (value >= 0xd800 && value <= 0xdfff)) return { count, error: "illegal" };
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

function encode(value: number, encoding: Encoding): number[] | undefined {
  if (encoding === "ascii" || encoding === "latin1") {
    if (value < (encoding === "ascii" ? 128 : 256)) return [value];
    if (value >= 0xe0000 && value <= 0xe007f) return [];
    return undefined;
  }
  if (encoding === "utf8") {
    if (value < 128) return [value];
    let count = 2;
    while (count < 6 && value >= 2 ** (5 * count + 1)) count++;
    const result = new Array<number>(count);
    for (let index = count - 1; index > 0; index--) { result[index] = 0x80 | (value & 0x3f); value = Math.floor(value / 64); }
    result[0] = (256 - 2 ** (8 - count)) | value;
    return result;
  }
  if (value > 0x10ffff) return undefined;
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
  let suppressed = false, targetSuppressed = false, started = false, firstTargetBatch = true;
  const flush = async (): Promise<void> => {
    if (used) { await lifecycle.write(buffer.subarray(0, used)); used = 0; status = 0; }
  };
  const flushFullOutput = async (): Promise<void> => {
    await flush(); batchCount = 1; suppressed = false; targetSuppressed = false; firstTargetBatch = false;
  };
  const append = async (bytes: readonly number[], transliterated = false): Promise<void> => {
    let recursiveBom = transliterated && firstTargetBatch && options.to === "utf16";
    if (buffer.length - used < bytes.length + (recursiveBom ? 2 : 0)) {
      await flushFullOutput(); recursiveBom = false;
    }
    if (recursiveBom) { buffer[used++] = 0xff; buffer[used++] = 0xfe; }
    buffer.set(bytes, used); used += bytes.length;
  };
  try {
    if (options.from === "utf16" && input.length >= 2) {
      if (input[0] === 0xfe && input[1] === 0xff) { state.swap = true; offset = 2; }
      else if (input[0] === 0xff && input[1] === 0xfe) offset = 2;
    }
    while (offset < input.length) {
      budget.charge(16);
      await budget.checkpointWork();
      const decoded = decode(input, offset, options.from, state.swap);
      let error: "illegal" | "incomplete" | undefined;
      if ("error" in decoded) error = decoded.error;
      else {
        batchCount++;
        if (buffer.length - used < (options.to.startsWith("utf16") ? 2 : 1)) await flushFullOutput();
        if (!started && options.to === "utf16") await append([0xff, 0xfe]);
        started = true;
        let bytes = encode(decoded.value, options.to);
        const transliterated = bytes === undefined && options.transliterate;
        if (transliterated) {
          const replacement = Object.hasOwn(cTransliterations, decoded.value) ? cTransliterations[decoded.value]! : "?";
          budget.charge(replacement.length + 1);
          bytes = [];
          for (const character of replacement) bytes.push(...encode(character.charCodeAt(0), options.to)!);
        }
        if (bytes === undefined) { error = "illegal"; targetSuppressed = true; }
        else await append(bytes, transliterated);
      }
      if (error === "illegal" && options.discard) suppressed = true;
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
          status = 1; await flush(); suppressed = false; targetSuppressed = false;
        }
      }
    }
    if (suppressed) status = 1;
    await flush();
    return { status, fatal: false };
  } finally { budget.retain(-32_768 - 256); }
}
