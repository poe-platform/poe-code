import { validateAttributeName, type AttributeNameContext } from "./attribute-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface AttributeMutationContext extends AttributeNameContext {
  /** Full guest mutation, including type overrides and descriptor dispatch.
   * Names/assigned values retain their guest identities. No preflight read. */
  setAttribute(object: RuntimeValue, name: RuntimeValue, value: RuntimeValue): void;
  deleteAttribute(object: RuntimeValue, name: RuntimeValue): void;
}

/** Explicit positional-only setattr/delattr registration. Successful mutation
 * returns None regardless of the guest override's return value. */
export function createAttributeMutationBuiltin(name: "setattr" | "delattr", values: RuntimeValues, meter: ExecutionMeter, context?: AttributeMutationContext): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  const names = context ?? {};
  return values.builtinFunction({ name, invoke(positional, keywords, meter, invocation) {
    meter.checkpoint();
    if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `${name}() takes no keyword arguments`);
    const required = name === "setattr" ? 3 : 2;
    if (positional.length !== required) throw new PythonRuntimeError("TypeError", `${name} expected ${required} arguments, got ${positional.length}`);
    const key = positional[1];
    validateAttributeName(key, names, meter);
    if (context !== undefined) {
      if (name === "setattr") context.setAttribute(positional[0], key, positional[2]);
      else context.deleteAttribute(positional[0], key);
    } else {
      let attributeName = "";
      if (key.kind === "str") for (const point of key.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); attributeName += String.fromCodePoint(point); }
      if (name === "setattr" && invocation?.setAttribute !== undefined) invocation.setAttribute(positional[0], attributeName, positional[2]);
      else if (name === "delattr" && invocation?.deleteAttribute !== undefined) invocation.deleteAttribute(positional[0], attributeName);
      else throw new Error(`${name} requires an execution attribute mutation capability`);
    }
    meter.checkpoint();
    return values.none;
  } });
}
