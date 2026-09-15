import { CodePointString } from "./code-point-string.js";
import { PythonRuntimeError } from "./error.js";
import { exhaustAllocation, type ExecutionMeter } from "./execution-budget.js";

export type CharacterTranslation = number | CodePointString | null | undefined;

/** Translate validated code points. Undefined means absent/identity; null means
 * deletion. ASCII translations cache single ASCII results and deletions until
 * a wider/expanding result forces general lookup, including retrying that point.
 * General deletion runs probe ahead, then retry the first nondeleted point.
 * Mapping protocol dispatch and result-type validation belong to the caller. */
export function translateString(source: CodePointString, mapping: (point: number) => CharacterTranslation, meter: ExecutionMeter): CodePointString {
  meter.checkpoint();
  if (source.length === 0) return source;
  meter.checkpoint(1, 160);
  const output: number[] = [];
  const append = (point: number) => {
    if (output.length === 0xffffffff) exhaustAllocation(meter);
    meter.checkpoint(1, 8);
    output.push(point);
  };
  const lookup = (point: number): CharacterTranslation => {
    const result = mapping(point);
    meter.checkpoint();
    if (typeof result === "number" && (!Number.isInteger(result) || result < 0 || result > 0x10ffff)) {
      throw new PythonRuntimeError("ValueError", "character mapping must be in range(0x110000)");
    }
    return result;
  };
  let ascii = true;
  for (const point of source) {
    meter.checkpoint();
    if (point > 127) { ascii = false; break; }
  }
  let position = 0;
  if (ascii) {
    meter.checkpoint(1, 128 * Int32Array.BYTES_PER_ELEMENT);
    const cache = new Int32Array(128).fill(-2);
    while (position < source.length) {
      const point = source.codePointAt(BigInt(position), meter);
      let mapped = cache[point];
      if (mapped === -2) {
        const result = lookup(point);
        if (result === undefined) mapped = point;
        else if (result === null) mapped = -1;
        else if (typeof result === "number") mapped = result;
        else {
          if (result.length !== 1) break;
          mapped = result.codePointAt(0n, meter);
        }
        if (mapped > 127) break;
        cache[point] = mapped;
      }
      if (mapped !== -1) append(mapped);
      position++;
    }
  }
  while (position < source.length) {
    const point = source.codePointAt(BigInt(position), meter), result = lookup(point);
    position++;
    if (result === null) {
      while (position < source.length && lookup(source.codePointAt(BigInt(position), meter)) === null) position++;
    } else if (result === undefined) append(point);
    else if (typeof result === "number") append(result);
    else for (const replacement of result) append(replacement);
  }
  meter.checkpoint(1, output.length * Uint32Array.BYTES_PER_ELEMENT);
  return new CodePointString(Uint32Array.from(output), meter);
}
