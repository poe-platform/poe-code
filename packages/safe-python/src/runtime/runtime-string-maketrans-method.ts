import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinFunctionValue, RuntimeValues } from "./runtime-values.js";

/** Static operation: dictionary values are preserved without validation until
 * translate uses them. Character keys become ordinals; later duplicates win. */
export function createRuntimeStringMaketransMethod(values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "maketrans",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "str.maketrans() takes no keyword arguments");
      if (positional.length < 1) throw new PythonRuntimeError("TypeError", "maketrans expected at least 1 argument, got 0");
      if (positional.length > 3) throw new PythonRuntimeError("TypeError", `maketrans expected at most 3 arguments, got ${positional.length}`);
      for (let index = 1; index < positional.length; index++) {
        const value = positional[index];
        if (value.kind !== "str") throw new PythonRuntimeError("TypeError", `maketrans() argument ${index + 1} must be str, not ${value.kind === "none" ? "None" : value.kind}`);
      }
      const source = positional[0], target = positional[1], remove = positional[2];
      const result = values.dictionary(keywords.items.emptyCopy());
      if (target !== undefined) {
        if (source.kind !== "str") throw new PythonRuntimeError("TypeError", "first maketrans argument must be a string if there is a second argument");
        if (target.kind !== "str") throw new Error("validated string argument");
        if (source.value.length !== target.value.length) throw new PythonRuntimeError("ValueError", "the first two maketrans arguments must have equal length");
        for (let index = 0; index < source.value.length; index++) {
          meter.checkpoint();
          result.items.set(values.integer(source.value.codePointAt(BigInt(index), meter)), values.integer(target.value.codePointAt(BigInt(index), meter)));
        }
        if (remove?.kind === "str") for (const point of remove.value) {
          meter.checkpoint(); result.items.set(values.integer(point), values.none);
        }
      } else {
        if (source.kind !== "dict") throw new PythonRuntimeError("TypeError", "if you give only one argument to maketrans it must be a dict");
        meter.checkpoint(0, 64);
        const iterator = source.items.iterate((key, value) => { meter.checkpoint(0, 32); return { key, value }; });
        while (true) {
          meter.checkpoint();
          const item = iterator.next();
          if (item.done) break;
          let { key } = item.value;
          if (key.kind === "str") {
            if (key.value.length !== 1) throw new PythonRuntimeError("ValueError", "string keys in translatetable must be of length 1");
            key = values.integer(key.value.codePointAt(0n, meter));
          } else if (key.kind !== "int" && key.kind !== "bool") throw new PythonRuntimeError("TypeError", "keys in translate table mustbe strings or integers");
          result.items.set(key, item.value.value);
        }
      }
      return result;
    }
  });
}
