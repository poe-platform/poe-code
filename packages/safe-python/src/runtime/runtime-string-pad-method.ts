import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeSizeIndex } from "./runtime-size-index.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export function createRuntimeStringPadMethod(receiver: Extract<RuntimeValue, { kind: "str" }>, name: "center" | "ljust" | "rjust" | "zfill", values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `str.${name}() takes no keyword arguments`);
      if (name === "zfill") {
        if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `str.zfill() takes exactly one argument (${positional.length} given)`);
      } else {
        if (positional.length < 1) throw new PythonRuntimeError("TypeError", `${name} expected at least 1 argument, got ${positional.length}`);
        if (positional.length > 2) throw new PythonRuntimeError("TypeError", `${name} expected at most 2 arguments, got ${positional.length}`);
      }
      const width = runtimeSizeIndex(positional[0], meter), character = positional[1];
      let fill = name === "zfill" ? 48 : 32;
      if (character !== undefined) {
        if (character.kind !== "str") {
          const type = character.kind === "none" ? "NoneType" : character.kind === "not-implemented" ? "NotImplementedType" : character.kind;
          throw new PythonRuntimeError("TypeError", `The fill character must be a unicode character, not ${type}`);
        }
        if (character.value.length !== 1) throw new PythonRuntimeError("TypeError", "The fill character must be exactly one character long");
        fill = character.value.codePointAt(0n, meter);
      }
      const alignment = name === "center" ? "center" : name === "ljust" ? "left" : name === "rjust" ? "right" : "sign";
      const result = receiver.value.pad(width, alignment, fill, meter);
      return result === receiver.value ? receiver : values.stringPoints(result);
    }
  });
}
