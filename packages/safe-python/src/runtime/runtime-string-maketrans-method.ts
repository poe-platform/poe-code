import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinFunctionValue, RuntimeValues, TypeValue } from "./runtime-values.js";
import { runtimeStringPayload } from "./runtime-string-payload.js";
import { runtimeIntegerPayload } from "./runtime-integer-payload.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";

/** Static operation: dictionary values are preserved without validation until
 * translate uses them. Character keys become ordinals; later duplicates win. */
export function createRuntimeStringMaketransMethod(values: RuntimeValues, meter: ExecutionMeter, staticOwner?: TypeValue): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "maketrans",
    staticOwner,
    doc: "Return a translation table usable for str.translate().\n\nIf there is only one argument, it must be a dictionary mapping\nUnicode ordinals (integers) or characters to Unicode ordinals,\nstrings or None.  Character keys will be then converted to ordinals.\nIf there are two arguments, they must be strings of equal length,\nand in the resulting dictionary, each character in x will be mapped\nto the character at the same position in y.  If there is a third\nargument, it must be a string, whose characters will be mapped to\nNone in the result.",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "str.maketrans() takes no keyword arguments");
      if (positional.length < 1) throw new PythonRuntimeError("TypeError", "maketrans expected at least 1 argument, got 0");
      if (positional.length > 3) throw new PythonRuntimeError("TypeError", `maketrans expected at most 3 arguments, got ${positional.length}`);
      for (let index = 1; index < positional.length; index++) {
        const value = positional[index];
        if (runtimeStringPayload(value) === undefined) throw new PythonRuntimeError("TypeError", `maketrans() argument ${index + 1} must be str, not ${diagnosticTypeName(value.kind === "none" ? "None" : value.kind === "instance" ? value.type.value.diagnosticName : value.kind === "not-implemented" ? "NotImplementedType" : value.kind, meter, 50)}`);
      }
      const source = positional[0], target = positional[1] === undefined ? undefined : runtimeStringPayload(positional[1]), remove = positional[2] === undefined ? undefined : runtimeStringPayload(positional[2]);
      const result = values.dictionary(keywords.items.emptyCopy());
      if (target !== undefined) {
        const payload = runtimeStringPayload(source);
        if (payload === undefined) throw new PythonRuntimeError("TypeError", "first maketrans argument must be a string if there is a second argument");
        if (payload.value.length !== target.value.length) throw new PythonRuntimeError("ValueError", "the first two maketrans arguments must have equal length");
        for (let index = 0; index < payload.value.length; index++) {
          meter.checkpoint();
          result.items.set(values.integer(payload.value.codePointAt(BigInt(index), meter)), values.integer(target.value.codePointAt(BigInt(index), meter)));
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
          const payload = runtimeStringPayload(key);
          if (payload !== undefined) {
            if (payload.value.length !== 1) throw new PythonRuntimeError("ValueError", "string keys in translatetable must be of length 1");
            key = values.integer(payload.value.codePointAt(0n, meter));
          } else if (runtimeIntegerPayload(key) === undefined) throw new PythonRuntimeError("TypeError", "keys in translate table mustbe strings or integers");
          result.items.set(key, item.value.value);
        }
      }
      return result;
    }
  });
}
