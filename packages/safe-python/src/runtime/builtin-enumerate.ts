import { EnumerateIterator } from "./enumerate-iterator.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { IntegerIndexContext } from "./index-protocol.js";
import type { IterationContext } from "./protocol-iterator.js";
import { runtimeIntegerIndex } from "./runtime-integer-index.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeStringPayload } from "./runtime-string-payload.js";
import { representationObject } from "./representation-protocol.js";
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
    invoke(positional, keywords, meter, invocation) {
      meter.checkpoint();
      const count = positional.length + keywords.items.size;
      if (positional.length === 0 && count !== 1 && count !== 2) throw new PythonRuntimeError("TypeError", "enumerate() missing required argument 'iterable'");
      if (count > 2) throw new PythonRuntimeError("TypeError", `enumerate() takes at most 2 arguments (${count} given)`);
      let source = positional[0], start = positional[1];
      const entries = keywords.items.snapshot();
      const keywordName = (key: RuntimeValue): string => {
        const payload = runtimeStringPayload(key);
        if (payload === undefined) throw new PythonRuntimeError("TypeError", "keywords must be strings");
        let label = "";
        for (const point of payload.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); label += String.fromCodePoint(point); }
        return label;
      };
      const checkKeyword = (index: number, expected: string): void => {
        const key = entries[index][0];
        let label = keywordName(key);
        if (label === expected) return;
        if (key.kind !== "str") {
          if (invocation?.formatting === undefined) throw Error("enumerate keyword diagnostics require an execution representation capability");
          label = keywordName(representationObject(key, "str", invocation.formatting, meter));
        }
        throw new PythonRuntimeError("TypeError", `'${label}' is an invalid keyword argument for enumerate()`);
      };
      // The vectorcall contract validates keyword positions, not a mapping of
      // accepted names. Distinct subtype keys may have identical text payloads.
      if (entries.length === 2) {
        const reversed = keywordName(entries[0][0]) === "start";
        checkKeyword(0, reversed ? "start" : "iterable");
        checkKeyword(1, reversed ? "iterable" : "start");
        source = entries[reversed ? 1 : 0][1];
        start = entries[reversed ? 0 : 1][1];
      } else if (entries.length === 1) {
        checkKeyword(0, count === 1 ? "iterable" : "start");
        if (count === 1) source = entries[0][1];
        else start = entries[0][1];
      }
      if (source === undefined) throw new PythonRuntimeError("TypeError", "enumerate() missing required argument 'iterable'");
      const indexContext = context?.index ?? invocation?.integerIndex;
      const index = start === undefined ? 0n : runtimeIntegerIndex(start, meter, indexContext);
      const iterator = runtimeIterate(source, values, meter, context?.iteration ?? invocation?.iteration);
      meter.checkpoint(1, 64);
      return values.iterator(new EnumerateIterator(iterator, index, (index, value) => values.tuple(2, position => position === 0 ? values.integer(index) : value), meter));
    }
  });
}
