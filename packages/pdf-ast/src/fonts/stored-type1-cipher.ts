import type { CffCodeSource } from "../vendor/pdfjs-fonts.mjs";
import { StoredFontBytes } from "./stored-font-bytes.js";

type Cipher =
  | { kind: "hex"; length: number }
  | { kind: "plain" }
  | { kind: "cipher"; key: number; discard: number; ascii?: boolean };
function hex(value: number | undefined): number {
  if (value !== undefined) {
    if (value >= 48 && value <= 57) return value - 48;
    if (value >= 65 && value <= 70) return value - 55;
    if (value >= 97 && value <= 102) return value - 87;
  }
  return -1;
}

/** Decrypt or copy a font range with fixed scratch; decoded bytes belong to the
 * caller's program store, including malformed native lenIV/slice semantics. */
export async function appendType1Bytes(
  source: Pick<CffCodeSource, "length" | "byte">,
  output: StoredFontBytes,
  mode: Cipher
) {
  const start = output.length,
    scratch = new Uint8Array(4096);
  let used = 0;
  async function append(value: number) {
    scratch[used++] = value;
    if (used === scratch.length) {
      await output.push(...scratch);
      used = 0;
    }
  }
  let sliceStart = start;
  if (mode.kind === "plain") {
    for (let at = 0; at < source.length; at++) await append((await source.byte(at))!);
  } else if (mode.kind === "hex") {
    let first = -1,
      count = 0;
    for (let at = 0; at < source.length && count < mode.length; at++) {
      const digit = hex(await source.byte(at));
      if (digit < 0) continue;
      if (first < 0) first = digit;
      else {
        await append(first * 16 + digit);
        first = -1;
        count++;
      }
    }
  } else {
    let key = mode.key | 0;
    if (mode.ascii) {
      for (let at = 0; at < source.length; at++) {
        const first = hex(await source.byte(at));
        if (first < 0) continue;
        let second = -1;
        while (++at < source.length && (second = hex(await source.byte(at))) < 0) {
          /* ignored whitespace and non-hex bytes */
        }
        if (at === source.length) break;
        const value = first * 16 + second;
        await append(value ^ (key >> 8));
        key = ((value + key) * 52845 + 22719) & 65535;
      }
      const capacity = source.length >>> 1;
      const discard = Math.trunc(mode.discard) || 0;
      sliceStart =
        start + (discard < 0 ? Math.max(0, capacity + discard) : Math.min(capacity, discard));
    } else if (mode.discard < source.length) {
      const count = Math.trunc(source.length - mode.discard);
      if (!Number.isFinite(count)) throw new RangeError("Invalid typed array length");
      for (let at = 0; at < mode.discard; at++)
        key = (((await source.byte(at))! + key) * 52845 + 22719) & 65535;
      for (let i = 0; i < count; i++) {
        const value = (await source.byte(mode.discard + i))!;
        await append(value ^ (key >> 8));
        key = ((value + key) * 52845 + 22719) & 65535;
      }
    }
  }
  if (used) await output.push(...scratch.subarray(0, used));
  return output.range(Math.min(sliceStart, output.length));
}
