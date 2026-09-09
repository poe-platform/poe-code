import { EnumerateIterator } from "./enumerate-iterator.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { integerIndex, type IntegerIndexContext } from "./index-protocol.js";
import type { IterationContext } from "./protocol-iterator.js";
import { runtimeIntegerIndex } from "./runtime-integer-index.js";
import { runtimeIterate } from "./runtime-iteration.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface EnumerateBuiltinContext {
  readonly index?: IntegerIndexContext<RuntimeValue>;
  readonly iteration?: IterationContext<RuntimeValue>;
}

/** Explicit constructor binding. Convert start before eager iterator acquisition;
 * pull values and allocate integer/tuple pairs lazily. Native type registration,
 * subclass construction and tuple reuse are separate object-runtime concerns. */
export function createEnumerateBuiltin(values: RuntimeValues, meter: ExecutionMeter, context?: EnumerateBuiltinContext): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "enumerate",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      const count = positional.length + keywords.items.size;
      if (positional.length === 0 && count !== 1 && count !== 2) throw new PythonRuntimeError("TypeError", "enumerate() missing required argument 'iterable'");
      if (count > 2) throw new PythonRuntimeError("TypeError", `enumerate() takes at most 2 arguments (${count} given)`);
      let source = positional[0], start = positional[1];
      for (const [key, value] of keywords.items.snapshot()) {
        if (key.kind !== "str") throw new PythonRuntimeError("TypeError", "keywords must be strings");
        let label = "";
        for (const point of key.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); label += String.fromCodePoint(point); }
        if (label === "iterable" && positional.length === 0) source = value;
        else if (label === "start" && count === 2) start = value;
        else throw new PythonRuntimeError("TypeError", `'${label}' is an invalid keyword argument for enumerate()`);
      }
      if (source === undefined) throw new PythonRuntimeError("TypeError", "enumerate() missing required argument 'iterable'");
      const index = start === undefined ? 0n : start.kind === "int" || start.kind === "bool" || context?.index === undefined
        ? runtimeIntegerIndex(start, meter) : integerIndex(start, context.index, meter);
      const iterator = runtimeIterate(source, values, meter, context?.iteration);
      meter.checkpoint(1, 64);
      return values.iterator(new EnumerateIterator(iterator, index, (index, value) => values.tuple(2, position => position === 0 ? values.integer(index) : value), meter));
    }
  });
}
