import type { CodePointString } from "./code-point-string.js";
import type { ImmutableBytes } from "./immutable-bytes.js";
import { PythonRuntimeError } from "./error.js";
import { ExecutionLimitError, type ExecutionMeter } from "./execution-budget.js";
import { validateIndexResult, type IntegerIndexContext } from "./index-protocol.js";

export interface PercentCharacterContext<Value> extends IntegerIndexContext<Value> {
  /** Full Python %T display name, distinct from the index protocol's tp_name. */
  qualifiedTypeName(value: Value): string;
  /** Pure str/subclass storage inspection, not __str__ conversion. */
  string(value: Value): CodePointString | undefined;
  /** Pure bytes/bytearray/subclass storage; memoryview and buffers are excluded. */
  bytes(value: Value): { readonly kind: "bytes" | "bytearray"; readonly value: Pick<ImmutableBytes, "length" | "byteAt"> } | undefined;
  isTypeError?(error: unknown): boolean;
}

/** Resolve one %c code point/byte. Width is applied afterwards; precision and
 * numeric flags do not affect the character. Text remaps index TypeErrors,
 * whereas bytes preserves failures from a present index slot. */
export function percentCharacter<Value>(value: Value, byteFormat: boolean, context: PercentCharacterContext<Value>, meter: ExecutionMeter): number {
  meter.checkpoint();
  if (byteFormat) {
    const bytes = context.bytes(value); meter.checkpoint();
    if (bytes !== undefined) {
      if (bytes.value.length !== 1) throw new PythonRuntimeError("TypeError", `%c requires an integer in range(256) or a single byte, not a ${bytes.kind} object of length ${bytes.value.length}`);
      const point = bytes.value.byteAt(0n, meter); meter.checkpoint();
      return point;
    }
  } else {
    const string = context.string(value); meter.checkpoint();
    if (string !== undefined) {
      if (string.length !== 1) throw new PythonRuntimeError("TypeError", `%c requires an int or a unicode character, not a string of length ${string.length}`);
      const point = string.codePointAt(0n, meter); meter.checkpoint();
      return point;
    }
  }
  let integer: bigint | undefined;
  try {
    integer = context.integer(value); meter.checkpoint();
    if (integer === undefined) {
      const method = context.lookupIndex(value); meter.checkpoint();
      if (method !== undefined) {
        const result = validateIndexResult(method(), context, meter);
        integer = context.integer(result); meter.checkpoint();
      }
    }
  } catch (error) {
    if (byteFormat || error instanceof ExecutionLimitError) throw error;
    meter.checkpoint();
    const typeError = error instanceof PythonRuntimeError && error.name === "TypeError" || context.isTypeError?.(error) === true;
    meter.checkpoint();
    if (!typeError) throw error;
    integer = undefined;
  }
  if (integer === undefined) {
    const name = context.qualifiedTypeName(value);
    meter.checkpoint(1, 256 + name.length * 2);
    throw new PythonRuntimeError("TypeError", `%c requires ${byteFormat ? "an integer in range(256) or a single byte" : "an int or a unicode character"}, not ${name}`);
  }
  if (integer < 0n || integer >= (byteFormat ? 256n : 0x110000n)) throw new PythonRuntimeError("OverflowError", `%c arg not in range(${byteFormat ? "256" : "0x110000"})`);
  return Number(integer);
}
