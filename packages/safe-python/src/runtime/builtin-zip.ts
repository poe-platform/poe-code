import type { ExecutionMeter } from "./execution-budget.js";
import type { CompletionIterator } from "./iterator-completion.js";
import type { IterationContext } from "./protocol-iterator.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeStrictOption } from "./runtime-strict-option.js";
import { runtimeTruth } from "./runtime-truth.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";
import { ZipIterator } from "./zip-iterator.js";

export interface ZipBuiltinContext {
  readonly iteration?: IterationContext<RuntimeValue>;
  truth?(value: RuntimeValue): boolean;
}

/** Bind native zip arguments and acquire inputs eagerly, without pulling items.
 * The existing parallel cursor owns strict mismatch probes and completion
 * payloads. Native type registration, subclass construction and tuple reuse
 * remain separate from this explicitly registered capability. */
export function createZipBuiltin(values: RuntimeValues, meter: ExecutionMeter, context?: ZipBuiltinContext): BuiltinFunctionValue {
  meter.checkpoint(1, 96);
  return values.builtinFunction({
    name: "zip",
    invoke(positional, keywords, meter, invocation) {
      meter.checkpoint(0, 64);
      const truth = { truth(value: RuntimeValue) {
        if (context?.truth !== undefined) return context.truth(value);
        if (invocation?.truth !== undefined) return invocation.truth(value);
        return runtimeTruth(value, meter);
      } };
      const strict = runtimeStrictOption("zip", keywords, truth, meter);
      meter.checkpoint(1, 64 + positional.length * 8);
      const sources = new Array<CompletionIterator<RuntimeValue>>(positional.length);
      for (let i = 0; i < positional.length; i++) {
        meter.checkpoint(); sources[i] = runtimeIterate(positional[i], values, meter, context?.iteration ?? invocation?.iteration);
      }
      return values.iterator(new ZipIterator(sources, strict, row => values.tuple(row), meter));
    }
  });
}
