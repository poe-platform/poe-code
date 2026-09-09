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
export function createAttributeMutationBuiltin(name: "setattr" | "delattr", values: RuntimeValues, meter: ExecutionMeter, context: AttributeMutationContext): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({ name, invoke(positional, keywords, meter) {
    meter.checkpoint();
    if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `${name}() takes no keyword arguments`);
    const required = name === "setattr" ? 3 : 2;
    if (positional.length !== required) throw new PythonRuntimeError("TypeError", `${name} expected ${required} arguments, got ${positional.length}`);
    validateAttributeName(positional[1], context, meter);
    if (name === "setattr") context.setAttribute(positional[0], positional[1], positional[2]);
    else context.deleteAttribute(positional[0], positional[1]);
    meter.checkpoint();
    return values.none;
  } });
}
