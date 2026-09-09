import type { CodePointString } from "./code-point-string.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { ImmutableBytes } from "./immutable-bytes.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface OrdHooks {
  /** Pure str/subclass storage inspection, never __str__ or __len__. */
  string?(value: RuntimeValue): CodePointString | undefined;
  /** Pure bytes/bytearray/subclass storage only, not arbitrary buffer exporters.
   * Inspect length without copying; byteAt must not execute guest code. */
  bytes?(value: RuntimeValue): Pick<ImmutableBytes, "length" | "byteAt"> | undefined;
  typeName?(value: RuntimeValue): string;
}

/** Explicit builtin registration. No coercion, iteration or buffer acquisition
 * occurs: only one code point/byte in an accepted string-like value is valid. */
export function createOrdBuiltin(values: RuntimeValues, meter: ExecutionMeter, hooks: OrdHooks = {}): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({ name: "ord", invoke(positional, keywords, meter) {
    meter.checkpoint();
    if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "ord() takes no keyword arguments");
    if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `ord() takes exactly one argument (${positional.length} given)`);
    const value = positional[0];
    const string = value.kind === "str" ? value.value : value.kind === "bytes" ? undefined : hooks.string?.(value);
    meter.checkpoint();
    const bytes = string !== undefined ? undefined : value.kind === "bytes" ? value.value : hooks.bytes?.(value);
    meter.checkpoint();
    const length = string?.length ?? bytes?.length;
    if (length === undefined) {
      const type = hooks.typeName?.(value) ?? (value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind);
      throw new PythonRuntimeError("TypeError", `ord() expected string of length 1, but ${diagnosticTypeName(type, meter)} found`);
    }
    if (length !== 1) throw new PythonRuntimeError("TypeError", `ord() expected a character, but string of length ${length} found`);
    const point = string !== undefined ? string.codePointAt(0n, meter) : bytes!.byteAt(0n, meter);
    meter.checkpoint();
    return values.integer(point);
  } });
}
