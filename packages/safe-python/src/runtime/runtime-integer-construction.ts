import { PythonRuntimeError } from "./error.js";
import { ExecutionLimitError, type ExecutionMeter } from "./execution-budget.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { integerIndex, validateIndexResult } from "./index-protocol.js";
import { createRuntimeIndexContext } from "./runtime-index-context.js";
import { floatToInteger } from "./numeric-conversion.js";
import { parseIntegerText } from "./integer-text.js";
import type { ImmutableBytes } from "./immutable-bytes.js";
import type { RuntimeBufferContext, RuntimeBufferLease } from "./runtime-buffer-context.js";
import type { BuiltinInvocationContext, DictionaryValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface RuntimeIntegerConstructionContext {
  readonly invocation?: BuiltinInvocationContext;
  readonly buffers?: RuntimeBufferContext;
  /** Exact or subclass bytearray storage, unlike a general buffer export. */
  byteArray?(value: RuntimeValue): ImmutableBytes | undefined;
  readonly maxDigits?: number;
}

/** int's native argument binding and conversion operation. Ordinary call
 * assembly validates keyword names before entering here; raw allocators may
 * instead reach this operation's count-first keyword-dictionary convention.
 * Canonical type allocation and owned int-subclass storage remain caller-owned. */
export function constructRuntimeInteger(positional: readonly RuntimeValue[], keywords: DictionaryValue, values: RuntimeValues, meter: ExecutionMeter, context: RuntimeIntegerConstructionContext = {}): Extract<RuntimeValue, { kind: "int" }> {
  meter.checkpoint();
  let base = positional[1];
  if (keywords.items.size !== 0) {
    const count = positional.length + keywords.items.size;
    if (count > 2) throw new PythonRuntimeError("TypeError", `int() takes at most 2 ${positional.length === 0 ? "keyword " : ""}arguments (${count} given)`);
    for (const [key, value] of keywords.items.snapshot()) {
      meter.checkpoint();
      if (key.kind !== "str") throw new PythonRuntimeError("TypeError", "keywords must be strings");
      let name = "";
      for (const point of key.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); name += String.fromCodePoint(point); }
      if (name !== "base") throw new PythonRuntimeError("TypeError", `int() got an unexpected keyword argument '${name}'`);
      base = value;
    }
  } else if (positional.length > 2) throw new PythonRuntimeError("TypeError", `int expected at most 2 arguments, got ${positional.length}`);
  const source = positional[0];
  if (source === undefined) {
    if (base !== undefined) throw new PythonRuntimeError("TypeError", "int() missing string argument");
    return values.integer(0);
  }
  const invocation = context.invocation;
  const index = invocation?.integerIndex ?? (invocation === undefined ? undefined : createRuntimeIndexContext(invocation, meter));
  const typeName = (value: RuntimeValue): string => diagnosticTypeName(invocation?.typeName?.(value) ?? (value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind), meter);
  if (base !== undefined) {
    let radix: bigint;
    if (base.kind === "int") radix = base.value;
    else if (base.kind === "bool") radix = base.value ? 1n : 0n;
    else if (index !== undefined) radix = integerIndex(base, index, meter);
    else throw new PythonRuntimeError("TypeError", `'${typeName(base)}' object cannot be interpreted as an integer`);
    if (radix !== 0n && (radix < 2n || radix > 36n)) throw new PythonRuntimeError("ValueError", "int() base must be >= 2 and <= 36, or 0");
    const input = source.kind === "str" || source.kind === "bytes" ? source.value : context.byteArray?.(source); meter.checkpoint();
    if (input === undefined) throw new PythonRuntimeError("TypeError", "int() can't convert non-string with explicit base");
    return values.integer(parseIntegerText(input, Number(radix), meter, context.maxDigits));
  }
  if (source.kind === "int") return source;
  if (source.kind === "bool") return values.integer(source.value ? 1 : 0);
  if (source.kind === "float") { meter.checkpoint(1, 160); return values.integer(floatToInteger(source.value)); }
  const intMethod = invocation?.lookupSpecial?.(source, "__int__"); meter.checkpoint();
  if (intMethod !== undefined) {
    const result = invocation!.call(intMethod, []); meter.checkpoint();
    const payload = result.kind === "int" ? result.value : result.kind === "bool" ? result.value ? 1n : 0n : index?.integer(result);
    if (payload === undefined) throw new PythonRuntimeError("TypeError", `__int__ returned non-int (type ${typeName(result)})`);
    if (result.kind === "int") return result;
    invocation?.warn?.("DeprecationWarning", `__int__ returned non-int (type ${typeName(result)}).  The ability to return an instance of a strict subclass of int is deprecated, and may be removed in a future version of Python.`);
    meter.checkpoint(); return values.integer(payload);
  }
  const indexMethod = index?.lookupIndex(source); meter.checkpoint();
  if (indexMethod !== undefined) {
    const result = validateIndexResult(indexMethod(), index!, meter);
    return result.kind === "int" ? result : values.integer(index!.integer(result)!);
  }
  const input = source.kind === "str" || source.kind === "bytes" ? source.value : context.byteArray?.(source); meter.checkpoint();
  if (input !== undefined) return values.integer(parseIntegerText(input, 10, meter, context.maxDigits));
  let lease: RuntimeBufferLease | undefined;
  try { lease = context.buffers?.acquireSimple(source); }
  catch (error) { if (error instanceof ExecutionLimitError || !(error instanceof PythonRuntimeError)) throw error; }
  if (lease !== undefined) {
    try { meter.checkpoint(); return values.integer(parseIntegerText(lease.copy(), 10, meter, context.maxDigits)); }
    finally { lease.release(); }
  }
  meter.checkpoint();
  throw new PythonRuntimeError("TypeError", `int() argument must be a string, a bytes-like object or a real number, not '${typeName(source)}'`);
}
