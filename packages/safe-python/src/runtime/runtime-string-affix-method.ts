import { PythonRuntimeError } from "./error.js";
import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {runtimeTuplePayload} from "./runtime-tuple-payload.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeSearchBound } from "./runtime-search-bound.js";
import type { IntegerIndexContext } from "./index-protocol.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Prefix/suffix binding with lazy tuple validation: a successful earlier
 * candidate hides later invalid members, but bound conversion always runs. */
export function createRuntimeStringAffixMethod(receiver: Extract<RuntimeValue, { kind: "str" }>, name: "startswith" | "endswith", values: RuntimeValues, meter: ExecutionMeter, context?: IntegerIndexContext<RuntimeValue>): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `str.${name}() takes no keyword arguments`);
      if (positional.length < 1) throw new PythonRuntimeError("TypeError", `${name} expected at least 1 argument, got 0`);
      if (positional.length > 3) throw new PythonRuntimeError("TypeError", `${name} expected at most 3 arguments, got ${positional.length}`);
      const start = runtimeSearchBound(positional[1], 0n, meter, true, context), stop = runtimeSearchBound(positional[2], 9223372036854775807n, meter, true, context);
      const candidate = positional[0], tuple = runtimeTuplePayload(candidate);
      meter.checkpoint(1, 64);
      const matches = (value: RuntimeValue): boolean => {
        meter.checkpoint();
        const payload=runtimeStringPayload(value);
        if (payload===undefined) {
          const type = diagnosticTypeName(value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind==="instance"?value.type.value.diagnosticName:value.kind,meter,100);
          throw new PythonRuntimeError("TypeError", tuple!==undefined ? `tuple for ${name} must only contain str, not ${type}` : `${name} first arg must be str or a tuple of str, not ${type}`);
        }
        return receiver.value.hasAffix(payload.value, name === "startswith" ? "start" : "end", start, stop, meter);
      };
      if (tuple===undefined) return values.boolean(matches(candidate));
      for (const value of tuple.items) if (matches(value)) return values.true;
      return values.false;
    }
  });
}
