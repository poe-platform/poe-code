import { PythonRuntimeError } from "./error.js";
import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Boundary removal exactifies subtype results, including unchanged text.
 * Partition misses retain the original receiver; hits retain the separator. */
export function createRuntimeStringCutMethod(receiver: RuntimeValue, name: "removeprefix" | "removesuffix" | "partition" | "rpartition", values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  const payload=runtimeStringPayload(receiver);
  if(payload===undefined)throw Error("string cutting requires native string storage");
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `str.${name}() takes no keyword arguments`);
      if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `str.${name}() takes exactly one argument (${positional.length} given)`);
      const argument = positional[0], remove = name === "removeprefix" || name === "removesuffix";
      const argumentPayload=runtimeStringPayload(argument);
      if (argumentPayload===undefined) {
        const type = diagnosticTypeName(argument.kind === "none" ? (remove ? "None" : "NoneType") : argument.kind === "not-implemented" ? "NotImplementedType" : argument.kind==="instance"?argument.type.value.diagnosticName:argument.kind,meter,remove?50:100);
        throw new PythonRuntimeError("TypeError", remove ? `${name}() argument must be str, not ${type}` : `must be str, not ${type}`);
      }
      const text = payload.value, separator = argumentPayload.value;
      if (remove) {
        if (separator.length === 0 || !text.hasAffix(separator, name === "removeprefix" ? "start" : "end", 0n, null, meter)) return receiver.kind==="str"?receiver:values.stringPoints(text);
        const start = name === "removeprefix" ? BigInt(separator.length) : 0n;
        const stop = name === "removesuffix" ? BigInt(text.length - separator.length) : null;
        return values.stringPoints(text.slice(start, stop, null, meter), "canonical");
      }
      if (separator.length === 0) throw new PythonRuntimeError("ValueError", "empty separator");
      const index = text.search(separator, name === "partition" ? "find" : "rfind", 0n, null, meter);
      if (index === -1) {
        const empty = values.string("");
        return values.tuple(name === "partition" ? [receiver, empty, empty] : [empty, empty, receiver]);
      }
      const left = index === 0 ? values.string("") : values.stringPoints(text.slice(0n, BigInt(index), null, meter), "canonical");
      const end = index + separator.length;
      const right = end === text.length ? (index === 0 ? left : values.string("")) : values.stringPoints(text.slice(BigInt(end), null, null, meter), "canonical");
      return values.tuple([left, argument, right]);
    }
  });
}
