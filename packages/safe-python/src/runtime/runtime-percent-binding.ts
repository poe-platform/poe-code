import type { ExecutionMeter } from "./execution-budget.js";
import { ImmutableBytes } from "./immutable-bytes.js";
import type { PercentFormatBindingContext } from "./percent-format-bind.js";
import { runtimeIndex } from "./runtime-index.js";
import { runtimeTuplePayload } from "./runtime-tuple-payload.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface RuntimePercentBindingHooks {
  /** Pure tuple-subclass storage inspection, never iterable conversion. */
  tupleItems?(value: RuntimeValue): readonly RuntimeValue[] | undefined;
  /** Pure integer-subclass payload inspection, never __index__/__int__. */
  integer?(value: RuntimeValue): bigint | undefined;
  readonly mapping?: {
    has(value: RuntimeValue): boolean;
    get(value: RuntimeValue, key: RuntimeValue): RuntimeValue;
  };
}

/** Exact runtime operand policies plus explicit guest payload/mapping hooks.
 * Python's mapping check includes list/range subscription, but excludes tuples
 * and text; bytes are additionally excluded for a bytes format. Key slices stay
 * in their original code-point/byte representation, including lone surrogates.
 * Missing keys retain guest arguments rather than formatting exception text.
 */
export function createRuntimePercentBindingContext(values: RuntimeValues, meter: ExecutionMeter, hooks?: RuntimePercentBindingHooks): PercentFormatBindingContext<RuntimeValue> {
  meter.checkpoint(1, 256);
  return {
    tupleItems(value) {
      meter.checkpoint();
      return runtimeTuplePayload(value)?.items ?? hooks?.tupleItems?.(value);
    },
    isMapping(value, source) {
      meter.checkpoint();
      if(runtimeTuplePayload(value)!==undefined)return false;
      switch (value.kind) {
        case "tuple": case "str": return false;
        case "bytes": return !(source instanceof ImmutableBytes);
        case "list": case "range": case "dict": case "mappingproxy": return true;
        default: return hooks?.mapping?.has(value) ?? false;
      }
    },
    mappingItem(value, source, start, end) {
      meter.checkpoint();
      const key = source instanceof ImmutableBytes
        ? values.bytes(source.slice(BigInt(start), BigInt(end), null, meter))
        : values.stringPoints(source.slice(BigInt(start), BigInt(end), null, meter));
      while(value.kind==="mappingproxy"){meter.checkpoint();value=value.value;}
      switch (value.kind) {
        case "list": case "range": case "dict": case "bytes":
          return runtimeIndex(value, key, values, meter);
        default: return hooks?.mapping ? hooks.mapping.get(value, key) : runtimeIndex(value, key, values, meter);
      }
    },
    integer(value) {
      meter.checkpoint();
      if (value.kind === "int") return value.value;
      if (value.kind === "bool") return value.value ? 1n : 0n;
      return hooks?.integer?.(value);
    }
  };
}
