import type { CodePointString } from "./code-point-string.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RepresentationContext } from "./representation-protocol.js";
import { runtimeScalarRepresentation } from "./runtime-scalar-representation-method.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface RuntimeRepresentationHooks {
  /** Pure guest str-subclass storage inspection. */
  string?(value: RuntimeValue): CodePointString | undefined;
  lookupStr?(value: RuntimeValue): (() => RuntimeValue) | undefined;
  lookupRepr?(value: RuntimeValue): (() => RuntimeValue) | undefined;
  typeName?(value: RuntimeValue): string | undefined;
  /** Explicit default for unresolved types; the runtime owns identity/address
   * policy. Other native/container slots must be supplied through lookup hooks. */
  defaultRepr(value: RuntimeValue): RuntimeValue;
}

/** Existing native scalar slots plus explicit guest representation capabilities.
 * Does not invent generic strings for unfinished native/container types. */
export function createRuntimeRepresentationContext(values: RuntimeValues, meter: ExecutionMeter, hooks: RuntimeRepresentationHooks): RepresentationContext<RuntimeValue> {
  meter.checkpoint(1, 384);
  return {
    isExactString(value) { meter.checkpoint(); return value.kind === "str"; },
    string(value) { meter.checkpoint(); return value.kind === "str" ? value.value : hooks.string?.(value); },
    lookupStr(value) {
      meter.checkpoint();
      if (value.kind === "str" || value.kind === "bytes" || value.kind === "int" || value.kind === "bool") {
        meter.checkpoint(0, 64);
        return () => runtimeScalarRepresentation(value, "__str__", values, meter);
      }
      return hooks.lookupStr?.(value);
    },
    lookupRepr(value) {
      meter.checkpoint();
      if (value.kind === "str" || value.kind === "bytes" || value.kind === "int" || value.kind === "bool") {
        meter.checkpoint(0, 64);
        return () => runtimeScalarRepresentation(value, "__repr__", values, meter);
      }
      return hooks.lookupRepr?.(value);
    },
    typeName(value) {
      meter.checkpoint();
      const custom = hooks.typeName?.(value); meter.checkpoint();
      return custom ?? (value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind);
    },
    defaultRepr(value) { meter.checkpoint(); return hooks.defaultRepr(value); },
    stringPoints(value) { meter.checkpoint(); return values.stringPoints(value); }
  };
}
