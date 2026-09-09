import type { ExecutionMeter } from "./execution-budget.js";
import type { PercentIntegerContext } from "./percent-integer-conversion.js";
import type { RuntimeValue } from "./runtime-values.js";

export interface RuntimePercentIntegerHooks {
  /** Pure guest integer-subclass payload inspection, never conversion. */
  integer?(value: RuntimeValue): bigint | undefined;
  lookupInt?(value: RuntimeValue): (() => RuntimeValue) | undefined;
  lookupIndex?(value: RuntimeValue): (() => RuntimeValue) | undefined;
  /** Optional complete type-name resolution; undefined uses the native kind. */
  typeName?(value: RuntimeValue): string | undefined;
  isTypeError?(error: unknown): boolean;
  /** Required when supplying guest hooks: apply the execution's warning policy. */
  warn(category: "DeprecationWarning", message: string): void;
}

/** Concrete native payloads plus explicit guest conversion capabilities. No
 * attribute probing, string parsing or host object coercion is performed. */
export function createRuntimePercentIntegerContext(meter: ExecutionMeter, hooks?: RuntimePercentIntegerHooks): PercentIntegerContext<RuntimeValue> {
  meter.checkpoint(1, 256);
  return {
    integer(value) {
      meter.checkpoint();
      if (value.kind === "int") return value.value;
      if (value.kind === "bool") return value.value ? 1n : 0n;
      return hooks?.integer?.(value);
    },
    isExactInteger(value) { meter.checkpoint(); return value.kind === "int"; },
    float(value) { meter.checkpoint(); return value.kind === "float" ? value.value : undefined; },
    lookupInt(value) { meter.checkpoint(); return hooks?.lookupInt?.(value); },
    lookupIndex(value) { meter.checkpoint(); return hooks?.lookupIndex?.(value); },
    typeName(value) {
      meter.checkpoint();
      const custom = hooks?.typeName?.(value);
      meter.checkpoint();
      return custom ?? (value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind);
    },
    isTypeError(error) { meter.checkpoint(); return hooks?.isTypeError?.(error) ?? false; },
    warn(category, message) { meter.checkpoint(); hooks?.warn(category, message); }
  };
}
