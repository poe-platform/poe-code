import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeIntegerIndex } from "./runtime-integer-index.js";
import { runtimeStringPayload } from "./runtime-string-payload.js";
import type { IntegerIndexContext } from "./index-protocol.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export function createRuntimeExpandtabsMethod(original: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, context?: IntegerIndexContext<RuntimeValue>): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  const receiver = original.kind === "bytes" ? original : runtimeStringPayload(original);
  if (receiver === undefined) throw Error("tab expansion requires native string or bytes storage");
  return values.builtinFunction({
    name: "expandtabs",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      const count = positional.length + keywords.items.size;
      if (count > 1) throw new PythonRuntimeError("TypeError", `expandtabs() takes at most 1 ${positional.length === 0 ? "keyword " : ""}argument (${count} given)`);
      let argument = positional[0];
      for (const [key, value] of keywords.items.snapshot()) {
        if (key.kind !== "str") throw new PythonRuntimeError("TypeError", "keywords must be strings");
        let label = "";
        for (const point of key.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); label += String.fromCodePoint(point); }
        if (label !== "tabsize") throw new PythonRuntimeError("TypeError", `expandtabs() got an unexpected keyword argument '${label}'`);
        argument = value;
      }
      const tabsize = argument === undefined ? 8n : runtimeIntegerIndex(argument, meter, context);
      if (BigInt.asIntN(32, tabsize) !== tabsize) throw new PythonRuntimeError("OverflowError", "Python int too large to convert to C int");
      if (receiver.kind === "bytes") {
        const result = receiver.value.expandTabs(Number(tabsize), meter);
        return values.bytes(result, result.length === 0 ? "canonical" : "fresh");
      }
      const result = receiver.value.expandTabs(Number(tabsize), meter);
      return original === receiver && result === receiver.value ? receiver : values.stringPoints(result);
    }
  });
}
