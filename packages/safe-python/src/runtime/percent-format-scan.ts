import type { CodePointString } from "./code-point-string.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { ImmutableBytes } from "./immutable-bytes.js";

export type PercentFormatEvent =
  | { readonly kind: "literal"; readonly start: number; readonly end: number }
  | { readonly kind: "mapping-key"; readonly start: number; readonly end: number }
  | { readonly kind: "begin" | "mapping-start"; readonly offset: number }
  | { readonly kind: "flags"; readonly alternate: boolean; readonly zero: boolean; readonly left: boolean; readonly space: boolean; readonly sign: boolean }
  | { readonly kind: "width" | "precision"; readonly value: bigint | "*" }
  | { readonly kind: "conversion"; readonly code: number; readonly offset: number };

/** Lazy grammar events over immutable code points or bytes. Literal/key spans
 * reference the original source without copying. Mapping-start and dynamic
 * operand events let consumers perform guest actions before later syntax errors.
 * Raw conversion codes deliberately remain unvalidated until argument binding.
 * This scanner does not render values or establish complete percent formatting.
 */
export function* scanPercentFormat(source: CodePointString | ImmutableBytes, meter: ExecutionMeter): Generator<PercentFormatEvent> {
  meter.checkpoint(1, 128);
  const points = source[Symbol.iterator]();
  let point: number | undefined, position = -1;
  const advance = () => {
    meter.checkpoint(); const item = points.next(); meter.checkpoint();
    position++; point = item.done ? undefined : item.value;
  };
  const number = (limit: bigint, message: string): bigint => {
    let value = 0n;
    while (point !== undefined && point >= 48 && point <= 57) {
      value = value * 10n + BigInt(point - 48);
      if (value > limit) throw new PythonRuntimeError("ValueError", message);
      advance();
    }
    return value;
  };
  advance();
  while (point !== undefined) {
    if (point !== 37) {
      const start = position;
      do { advance(); } while (point !== undefined && point !== 37);
      meter.checkpoint(1, 64); yield { kind: "literal", start, end: position };
      continue;
    }
    const offset = position;
    advance();
    if (point === 37) {
      meter.checkpoint(1, 64); yield { kind: "literal", start: offset, end: offset + 1 };
      advance(); continue;
    }
    meter.checkpoint(1, 64); yield { kind: "begin", offset };
    if (point === 40) {
      meter.checkpoint(1, 64); yield { kind: "mapping-start", offset: position };
      advance();
      const start = position;
      let depth = 1;
      while (point !== undefined) {
        if (point === 40) depth++;
        else if (point === 41 && --depth === 0) break;
        advance();
      }
      if (point === undefined) throw new PythonRuntimeError("ValueError", "incomplete format key");
      meter.checkpoint(1, 64); yield { kind: "mapping-key", start, end: position };
      advance();
    }
    let alternate = false, zero = false, left = false, space = false, sign = false;
    while (true) {
      if (point === 35) alternate = true;
      else if (point === 48) zero = true;
      else if (point === 45) left = true;
      else if (point === 32) space = true;
      else if (point === 43) sign = true;
      else break;
      advance();
    }
    meter.checkpoint(1, 96); yield { kind: "flags", alternate, zero, left, space, sign };
    if (point === 42) {
      meter.checkpoint(1, 64); yield { kind: "width", value: "*" }; advance();
    } else if (point !== undefined && point >= 48 && point <= 57) {
      const value = number((1n << 63n) - 1n, "width too big");
      meter.checkpoint(1, 64); yield { kind: "width", value };
    }
    if (point === 46) {
      advance();
      if (point === 42) {
        meter.checkpoint(1, 64); yield { kind: "precision", value: "*" }; advance();
      } else {
        const value = number(2147483647n, "precision too big");
        meter.checkpoint(1, 64); yield { kind: "precision", value };
      }
    }
    if (point === 104 || point === 108 || point === 76) advance();
    if (point === undefined) throw new PythonRuntimeError("ValueError", "incomplete format");
    meter.checkpoint(1, 64); yield { kind: "conversion", code: point, offset: position };
    advance();
  }
}
