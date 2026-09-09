import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

type BytesClassification = "isascii" | "isspace" | "isalpha" | "isalnum" | "isdigit" | "islower" | "isupper" | "istitle";

/** Bytes predicates use ASCII ranges, not Unicode properties or host locale.
 * Case predicates ignore nonletters but require at least one cased byte. */
export function createRuntimeBytesClassificationMethod(receiver: Extract<RuntimeValue, { kind: "bytes" }>, name: BytesClassification, values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `bytes.${name}() takes no keyword arguments`);
      if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `bytes.${name}() takes no arguments (${positional.length} given)`);
      if (receiver.value.length === 0) return values.boolean(name === "isascii");
      let cased = false, previousCased = false;
      for (const byte of receiver.value) {
        meter.checkpoint();
        const upper = byte >= 65 && byte <= 90, lower = byte >= 97 && byte <= 122, digit = byte >= 48 && byte <= 57;
        let valid: boolean;
        switch (name) {
          case "isascii": valid = byte < 128; break;
          case "isspace": valid = byte === 32 || byte >= 9 && byte <= 13; break;
          case "isalpha": valid = upper || lower; break;
          case "isalnum": valid = upper || lower || digit; break;
          case "isdigit": valid = digit; break;
          case "islower": valid = !upper; break;
          case "isupper": valid = !lower; break;
          case "istitle": valid = upper ? !previousCased : lower ? previousCased : true; break;
        }
        if (!valid) return values.false;
        previousCased = upper || lower;
        cased ||= previousCased;
      }
      return values.boolean(name === "islower" || name === "isupper" || name === "istitle" ? cased : true);
    }
  });
}
