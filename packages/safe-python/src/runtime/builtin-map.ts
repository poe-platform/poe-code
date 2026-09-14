import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { CompletionIterator } from "./iterator-completion.js";
import { MapIterator, type MapIterationContext } from "./map-iterator.js";
import type { IterationContext } from "./protocol-iterator.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeStrictOption } from "./runtime-strict-option.js";
import { runtimeTruth } from "./runtime-truth.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface MapBuiltinContext extends Partial<MapIterationContext<RuntimeValue>> {
  iteration?: IterationContext<RuntimeValue>;
  truth?(value: RuntimeValue): boolean;
}

/** Native constructor binding with eager input acquisition but lazy calls.
 * Explicit callbacks override the invocation's normal runtime call capability.
 * The selected capability owns callability/argument dispatch; no mapper
 * inspection occurs before a complete row is pulled. MapIterator owns strict
 * mismatch handling, resumability and callback exhaustion metadata. Native type
 * registration and subclass construction remain separate runtime concerns. */
export function createMapBuiltin(values: RuntimeValues, meter: ExecutionMeter, context: MapBuiltinContext = {}): BuiltinFunctionValue {
  meter.checkpoint(1, 96);
  return values.builtinFunction({
    name: "map",
    invoke(positional, keywords, meter, invocation) {
      meter.checkpoint(0, 64);
      const truth = { truth(value: RuntimeValue) {
        if (context.truth !== undefined) return context.truth(value);
        if (invocation?.truth !== undefined) return invocation.truth(value);
        return runtimeTruth(value, meter);
      } };
      const strict = runtimeStrictOption("map", keywords, truth, meter, values, invocation);
      if (positional.length < 2) throw new PythonRuntimeError("TypeError", "map() must have at least two arguments.");
      const count = positional.length - 1;
      meter.checkpoint(1, 32 + count * 8);
      const sources = new Array<CompletionIterator<RuntimeValue>>(count);
      for (let i = 0; i < count; i++) {
        meter.checkpoint(); sources[i] = runtimeIterate(positional[i + 1], values, meter, context.iteration ?? invocation?.iteration);
      }
      meter.checkpoint(0, 128);
      const callbacks: MapIterationContext<RuntimeValue> = {
        call(callee, arguments_) {
          if (context.call !== undefined) return context.call(callee, arguments_);
          if (invocation !== undefined) return invocation.call(callee, arguments_);
          throw new Error("map requires an execution call capability");
        },
        isStopIteration(error) {
          if (context.isStopIteration !== undefined) return context.isStopIteration(error);
          if (invocation !== undefined) return invocation.isStopIteration(error);
          return error instanceof PythonRuntimeError && error.name === "StopIteration";
        }
      };
      return values.iterator(new MapIterator(positional[0], sources, strict, callbacks, meter));
    }
  });
}
