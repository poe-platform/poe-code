import type { ExecutionMeter } from "./execution-budget.js";
import type { PercentIntegerContext } from "./percent-integer-conversion.js";
import type { PercentCharacterContext } from "./percent-character-conversion.js";
import type { PercentFloatContext } from "./percent-float-conversion.js";
import type { CodePointString } from "./code-point-string.js";
import type { RuntimeValue } from "./runtime-values.js";

export interface RuntimePercentConversionHooks {
  /** Pure guest integer-subclass payload inspection, never conversion. */
  integer?(value: RuntimeValue): bigint | undefined;
  lookupInt?(value: RuntimeValue): (() => RuntimeValue) | undefined;
  lookupIndex?(value: RuntimeValue): (() => RuntimeValue) | undefined;
  /** Pure guest float-subclass payload; integer formatting must not use it. */
  floating?(value: RuntimeValue): number | undefined;
  lookupFloat?(value: RuntimeValue): (() => RuntimeValue) | undefined;
  /** Classify guest BaseException instances, not host implementation failures. */
  isPythonException?(error: unknown): boolean;
  /** Optional complete type-name resolution; undefined uses the native kind. */
  typeName?(value: RuntimeValue): string | undefined;
  qualifiedTypeName?(value: RuntimeValue): string | undefined;
  /** Pure guest str/subclass storage, never __str__ conversion. */
  string?(value: RuntimeValue): CodePointString | undefined;
  /** Guest bytes/bytearray storage, excluding arbitrary buffer protocols. */
  bytes?: PercentCharacterContext<RuntimeValue>["bytes"];
  isTypeError?(error: unknown): boolean;
  /** Required when supplying guest hooks: apply the execution's warning policy. */
  warn(category: "DeprecationWarning", message: string): void;
}

/** Concrete native payloads plus explicit guest conversion capabilities. No
 * attribute probing, string parsing or host object coercion is performed. */
export function createRuntimePercentConversionContext(meter: ExecutionMeter, hooks?: RuntimePercentConversionHooks): PercentIntegerContext<RuntimeValue> & PercentCharacterContext<RuntimeValue> & PercentFloatContext<RuntimeValue> {
  meter.checkpoint(1, 512);
  return {
    integer(value) {
      meter.checkpoint();
      if (value.kind === "int") return value.value;
      if (value.kind === "bool") return value.value ? 1n : 0n;
      return hooks?.integer?.(value);
    },
    isExactInteger(value) { meter.checkpoint(); return value.kind === "int"; },
    float(value) { meter.checkpoint(); return value.kind === "float" ? value.value : undefined; },
    floating(value) { meter.checkpoint(); return value.kind === "float" ? value.value : hooks?.floating?.(value); },
    isExactFloat(value) { meter.checkpoint(); return value.kind === "float"; },
    lookupFloat(value) { meter.checkpoint(); return hooks?.lookupFloat?.(value); },
    isPythonException(error) { meter.checkpoint(); return hooks?.isPythonException?.(error) ?? false; },
    string(value) { meter.checkpoint(); return value.kind === "str" ? value.value : hooks?.string?.(value); },
    bytes(value) { meter.checkpoint(); return value.kind === "bytes" ? value : hooks?.bytes?.(value); },
    lookupInt(value) { meter.checkpoint(); return hooks?.lookupInt?.(value); },
    lookupIndex(value) { meter.checkpoint(); return hooks?.lookupIndex?.(value); },
    typeName(value) {
      meter.checkpoint();
      const custom = hooks?.typeName?.(value);
      meter.checkpoint();
      return custom ?? (value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind);
    },
    isTypeError(error) { meter.checkpoint(); return hooks?.isTypeError?.(error) ?? false; },
    qualifiedTypeName(value) {
      meter.checkpoint();
      const custom = hooks?.qualifiedTypeName?.(value);
      meter.checkpoint();
      return custom ?? this.typeName(value);
    },
    warn(category, message) { meter.checkpoint(); hooks?.warn(category, message); }
  };
}
