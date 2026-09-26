import { SsconvertError } from "../contracts.js";
import type { CellValue } from "../workbook.js";

/** Hex is immutable JSON data, so workbook snapshots own it without admitting
 * typed-array prototypes or host capabilities. Its storage is budgeted separately
 * by the normal snapshot text admission. */
export function decodeByteString(value: string, tick: () => void, maximum = Number.MAX_SAFE_INTEGER): Uint8Array {
  if (value.length % 2) throw new SsconvertError("invalid-request", "Invalid canonical byte-string");
  if (value.length / 2 > maximum) throw new SsconvertError("resource-limit", "ssconvert text byte limit exceeded");
  const nibble = (character: string) => character >= "0" && character <= "9" ? character.charCodeAt(0) - 48
    : character >= "a" && character <= "f" ? character.charCodeAt(0) - 87 : -1;
  // Validate before allocating an owned result.
  for (let index = 0; index < value.length; index += 2) {
    tick();
    if (nibble(value[index]!) < 0 || nibble(value[index + 1]!) < 0 || value.slice(index, index + 2) === "00")
      throw new SsconvertError("invalid-request", "Invalid canonical byte-string");
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    tick(); bytes[index] = nibble(value[index * 2]!) * 16 + nibble(value[index * 2 + 1]!);
  }
  return bytes;
}

/** Preserve valid Unicode as ordinary strings, and invalid UTF-8 as explicit
 * native bytes. Neither replacement decoding nor a guessed legacy charset is used. */
export function byteStringValue(source: Uint8Array, tick: () => void, maximum: number): CellValue {
  let end = 0;
  while (end < source.length) {
    tick(); if (source[end] === 0) break;
    if (++end > maximum) throw new SsconvertError("resource-limit", "ssconvert calculation text limit exceeded");
  }
  const visible = source.subarray(0, end);
  try { return { kind: "string", value: new TextDecoder("UTF-8", { fatal: true, ignoreBOM: true }).decode(visible) }; }
  catch (error) { if (!(error instanceof TypeError)) throw error; }
  const hex: string[] = [];
  for (const byte of visible) { tick(); hex.push(byte.toString(16).padStart(2, "0")); }
  return { kind: "byte-string", value: hex.join("") };
}

export function joinByteText(parts: readonly Uint8Array[], separator: Uint8Array, maximum: number, tick: () => void): CellValue {
  let size = 0;
  for (let index = 0; index < parts.length; index++) {
    tick();
    size += parts[index]!.length + (index ? separator.length : 0);
    if (size > maximum) throw new SsconvertError("resource-limit", "ssconvert calculation text limit exceeded");
  }
  const result = new Uint8Array(size); let offset = 0;
  for (let index = 0; index < parts.length; index++) {
    if (index) for (const byte of separator) { tick(); result[offset++] = byte; }
    for (const byte of parts[index]!) { tick(); result[offset++] = byte; }
  }
  return byteStringValue(result, tick, maximum);
}
