import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { CodePointString } from "./code-point-string.js";
import { runtimeIntegerIndex } from "./runtime-integer-index.js";
import type { IntegerIndexContext } from "./index-protocol.js";
import { runtimeLength } from "./runtime-length.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export function createRuntimeBytesHexMethod(receiver: Extract<RuntimeValue, { kind: "bytes" }>, values: RuntimeValues, meter: ExecutionMeter, context?: IntegerIndexContext<RuntimeValue>): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "hex",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      const count = positional.length + keywords.items.size;
      if (count > 2) throw new PythonRuntimeError("TypeError", `hex() takes at most 2 ${positional.length === 0 ? "keyword " : ""}arguments (${count} given)`);
      let separator = positional[0], grouping = positional[1];
      for (const [key, value] of keywords.items.snapshot()) {
        if (key.kind !== "str") throw new PythonRuntimeError("TypeError", "keywords must be strings");
        let label = "";
        for (const point of key.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); label += String.fromCodePoint(point); }
        if (label !== "sep" && label !== "bytes_per_sep") throw new PythonRuntimeError("TypeError", `hex() got an unexpected keyword argument '${label}'`);
        const position = label === "sep" ? 1 : 2;
        if (positional.length >= position) throw new PythonRuntimeError("TypeError", `argument for hex() given by name ('${label}') and position (${position})`);
        if (label === "sep") separator = value; else grouping = value;
      }
      const group = grouping === undefined ? 1n : runtimeIntegerIndex(grouping, meter, context);
      if (BigInt.asIntN(32, group) !== group) throw new PythonRuntimeError("OverflowError", "Python int too large to convert to C int");
      let point: number | null = null;
      if (separator !== undefined) {
        if (BigInt(runtimeLength(separator, meter)) !== 1n) throw new PythonRuntimeError("ValueError", "sep must be length 1.");
        if (separator.kind !== "str" && separator.kind !== "bytes") throw new PythonRuntimeError("TypeError", "sep must be str or bytes.");
        point = separator.kind === "str" ? separator.value.codePointAt(0n, meter) : separator.value.byteAt(0n, meter);
        if (point > 127) throw new PythonRuntimeError("ValueError", "sep must be ASCII.");
      }
      return values.stringPoints(CodePointString.fromBytesHex(receiver.value, point, Number(group), meter));
    }
  });
}
