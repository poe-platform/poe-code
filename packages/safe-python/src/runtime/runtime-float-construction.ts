import { PythonRuntimeError } from "./error.js";
import { ExecutionLimitError, type ExecutionMeter } from "./execution-budget.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { validateIndexResult } from "./index-protocol.js";
import { createRuntimeIndexContext } from "./runtime-index-context.js";
import { integerToFloat } from "./numeric-conversion.js";
import { parseFloatText } from "./float-text.js";
import { runtimeFloatPayload } from "./runtime-float-payload.js";
import { runtimeIntegerPayload } from "./runtime-integer-payload.js";
import type { ImmutableBytes } from "./immutable-bytes.js";
import type { RuntimeBufferContext, RuntimeBufferLease } from "./runtime-buffer-context.js";
import type { BuiltinInvocationContext, DictionaryValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface RuntimeFloatConstructionContext {
  readonly invocation?: BuiltinInvocationContext;
  readonly buffers?: RuntimeBufferContext;
  byteArray?(value: RuntimeValue): ImmutableBytes | undefined;
  /** Additional guest exception representations, never host implementation faults. */
  isPythonException?(error: unknown): boolean;
}

/** Native float construction, prior to canonical type/subclass allocation.
 * Numeric protocols precede text/buffer parsing; __int__ and __bytes__ do not
 * participate. Buffer storage is released on every exit after acquisition. */
export function constructRuntimeFloat(positional: readonly RuntimeValue[], keywords: DictionaryValue, values: RuntimeValues, meter: ExecutionMeter, context: RuntimeFloatConstructionContext = {}): Extract<RuntimeValue, { kind: "float" }> {
  meter.checkpoint();
  if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "float() takes no keyword arguments");
  if (positional.length > 1) throw new PythonRuntimeError("TypeError", `float expected at most 1 argument, got ${positional.length}`);
  const source = positional[0];
  if (source === undefined) return values.float(0);
  const numeric = convertRuntimeFloatNumber(source,values,meter,context.invocation);
  if(numeric!==undefined)return numeric;
  const input = source.kind === "str" || source.kind === "bytes" ? source.value : context.byteArray?.(source); meter.checkpoint();
  if (input !== undefined) return values.float(parseFloatText(input,meter));
  let lease: RuntimeBufferLease | undefined;
  try { lease = context.buffers?.acquireSimple(source); }
  catch (error) { if (error instanceof ExecutionLimitError || (!(error instanceof PythonRuntimeError) && context.isPythonException?.(error) !== true)) throw error; }
  if (lease !== undefined) {
    try { meter.checkpoint();return values.float(parseFloatText(lease.copy(),meter)); }
    finally { lease.release(); }
  }
  meter.checkpoint();
  const type=diagnosticTypeName(context.invocation?.typeName?.(source)??(source.kind==="none"?"NoneType":source.kind==="not-implemented"?"NotImplementedType":source.kind),meter);
  throw new PythonRuntimeError("TypeError", `float() argument must be a string or a real number, not '${type}'`);
}

/** Numeric conversion only. Undefined means no numeric protocol was present,
 * not a failed conversion; guest conversion errors propagate unchanged. */
export function convertRuntimeFloatNumber(source: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, invocation?: BuiltinInvocationContext): Extract<RuntimeValue,{kind:"float"}>|undefined {
  meter.checkpoint();
  if (source.kind === "float") return source;
  const typeName = (value: RuntimeValue, limit?: number): string => diagnosticTypeName(invocation?.typeName?.(value) ?? (value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind), meter, limit);
  const method = invocation?.lookupSpecial?.(source,"__float__"); meter.checkpoint();
  if (method !== undefined) {
    const result = invocation!.call(method,[]); meter.checkpoint();
    const payload = runtimeFloatPayload(result);
    if (payload === undefined) throw new PythonRuntimeError("TypeError", `${typeName(source,50)}.__float__ returned non-float (type ${typeName(result,50)})`);
    if (result.kind === "float") return result;
    invocation?.warn?.("DeprecationWarning", `${typeName(source,50)}.__float__ returned non-float (type ${typeName(result,50)}).  The ability to return an instance of a strict subclass of float is deprecated, and may be removed in a future version of Python.`);
    meter.checkpoint();return values.float(payload.value);
  }
  const floating = runtimeFloatPayload(source);
  if (floating !== undefined) return values.float(floating.value);
  const integer = runtimeIntegerPayload(source);
  if (integer !== undefined) { meter.checkpoint();return values.float(integerToFloat(integer.kind === "int" ? integer.value : integer.value ? 1n : 0n)); }
  const index = invocation?.integerIndex ?? (invocation === undefined ? undefined : createRuntimeIndexContext(invocation,meter));
  const indexMethod = index?.lookupIndex(source); meter.checkpoint();
  if (indexMethod !== undefined) {
    const result = validateIndexResult(indexMethod(),index!,meter);
    return values.float(integerToFloat(index!.integer(result)!));
  }
  return undefined;
}
