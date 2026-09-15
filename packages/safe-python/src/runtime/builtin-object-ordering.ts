import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** Object's ordering slots decline every pair. Explicit base-slot calls never
 * delegate to the receiver's overrides or to native payload comparison. */
export function installObjectOrderingWrappers(values: RuntimeValues, meter: ExecutionMeter, objectType: TypeValue): void {
  meter.checkpoint(0, 192);
  for (const [name, operator] of [["__lt__", "<"], ["__le__", "<="], ["__gt__", ">"], ["__ge__", ">="]]) {
    meter.checkpoint(0, 96);
    const descriptor = values.wrapperDescriptor({ owner: objectType, name, doc: `Return self${operator}value.`, accepts: () => true,
      invoke(_instance, positional, keywords, meter) {
        meter.checkpoint();
        if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
        if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `expected 1 argument, got ${positional.length}`);
        return values.notImplemented;
      }
    });
    objectType.value.namespace.items.set(values.string(name), descriptor);
  }
}
