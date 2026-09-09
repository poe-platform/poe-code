import type { ExecutionMeter } from "./execution-budget.js";
import type { FormatContext } from "./format-protocol.js";
import { createRuntimeRepresentationContext, type RuntimeRepresentationHooks } from "./runtime-representation.js";
import { objectFormat } from "./object-format.js";
import { stringFormat } from "./string-format.js";
import { integerFormat } from "./integer-format.js";
import { floatFormat } from "./float-format.js";
import { representationObject } from "./representation-protocol.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";
import { UnsupportedExpressionError } from "./expression-evaluation.js";

export interface RuntimeFormatHooks extends RuntimeRepresentationHooks {
  lookupFormat?(value: RuntimeValue): ((spec: RuntimeValue) => RuntimeValue) | undefined;
}

/** Exact native families with inherited object formatting and implemented repr. */
export function hasNativeObjectFormat(value: RuntimeValue): boolean {
  return value.kind === "none" || value.kind === "ellipsis" || value.kind === "not-implemented"
    || value.kind === "bytes" || value.kind === "list" || value.kind === "tuple" || value.kind === "dict"
    || value.kind === "mappingproxy" || value.kind === "range" || value.kind === "dict_keys"
    || value.kind === "dict_values" || value.kind === "dict_items";
}

/** Shared native formatting/representation capabilities. Remaining numeric
 * presentations stay explicit gaps rather than pretending their slots are absent.
 * Guest lookup owns inherited methods and descriptor behavior for guest types. */
export function createRuntimeFormatContext(values: RuntimeValues, meter: ExecutionMeter, hooks: RuntimeFormatHooks): FormatContext<RuntimeValue> {
  meter.checkpoint(1, 512);
  const context: FormatContext<RuntimeValue> = {
    ...createRuntimeRepresentationContext(values, meter, hooks),
    isExactInteger(value) { meter.checkpoint(); return value.kind === "int"; },
    lookupFormat(value) {
      meter.checkpoint();
      if (value.kind === "str") {
        meter.checkpoint(0, 64);
        return spec => {
          const storage = context.string(spec); meter.checkpoint();
          if (storage === undefined) throw new Error("validated format spec lost string storage");
          const result = stringFormat(value.value, storage, "str", meter);
          return result === value.value ? value : values.stringPoints(result);
        };
      }
      if (hasNativeObjectFormat(value)) {
        meter.checkpoint(0, 64);
        return spec => {
          const storage = context.string(spec); meter.checkpoint();
          if (storage === undefined) throw new Error("validated format spec lost string storage");
          return objectFormat(value, storage, context, meter);
        };
      }
      if (value.kind === "int" || value.kind === "bool" || value.kind === "float" || value.kind === "complex") {
        meter.checkpoint(0, 64);
        return spec => {
          const storage = context.string(spec); meter.checkpoint();
          if (storage === undefined) throw new Error("validated format spec lost string storage");
          if (storage.length === 0) return representationObject(value, "str", context, meter);
          if (value.kind === "int" || value.kind === "bool") {
            const integer = value.kind === "int" ? value.value : value.value ? 1n : 0n;
            return values.stringPoints(integerFormat(integer, storage, value.kind, meter));
          }
          if (value.kind === "float") return values.stringPoints(floatFormat(value.value, storage, "float", meter));
          throw new UnsupportedExpressionError("call");
        };
      }
      return hooks.lookupFormat?.(value);
    }
  };
  return context;
}
