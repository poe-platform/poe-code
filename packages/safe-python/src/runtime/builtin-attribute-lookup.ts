import { validateAttributeName, type AttributeNameContext } from "./attribute-name.js";
import { PythonRuntimeError } from "./error.js";
import { runtimeExceptionMatches } from "./runtime-exception-matches.js";
import { ExecutionLimitError, type ExecutionMeter } from "./execution-budget.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface AttributeLookupContext extends AttributeNameContext {
  /** Full guest attribute access, including descriptors, __getattribute__ and
   * __getattr__. The validated string/name object is passed through unchanged. */
  attribute(object: RuntimeValue, name: RuntimeValue): RuntimeValue;
  /** Recognize guest AttributeError subclasses, never fatal execution signals. */
  isAttributeError?(error: unknown): boolean;
}

/** Explicit positional-only getattr/hasattr registration. Lookup occurs once;
 * only missing-attribute exceptions enable defaults or a false result. */
export function createAttributeLookupBuiltin(name: "getattr" | "hasattr", values: RuntimeValues, meter: ExecutionMeter, context?: AttributeLookupContext): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  const names = context ?? {};
  return values.builtinFunction({ name, invoke(positional, keywords, meter, invocation) {
    meter.checkpoint();
    if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `${name}() takes no keyword arguments`);
    const count = positional.length;
    if (name === "hasattr" && count !== 2) throw new PythonRuntimeError("TypeError", `hasattr expected 2 arguments, got ${count}`);
    if (name === "getattr" && (count < 2 || count > 3)) throw new PythonRuntimeError("TypeError", `getattr expected at ${count < 2 ? "least 2" : "most 3"} arguments, got ${count}`);
    const key = positional[1];
    validateAttributeName(key, names, meter);
    let attributeName = "";
    if (context === undefined && key.kind === "str") {
      for (const point of key.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); attributeName += String.fromCodePoint(point); }
    }
    let result: RuntimeValue;
    try {
      if (context !== undefined) result = context.attribute(positional[0], key);
      else if (invocation?.attribute !== undefined) result = invocation.attribute(positional[0], attributeName);
      else throw new Error(`${name} requires an execution attribute capability`);
    }
    catch (error) {
      meter.checkpoint();
      if (error instanceof ExecutionLimitError || (name === "getattr" && count === 2)) throw error;
      const missing = context?.isAttributeError === undefined
        ? runtimeExceptionMatches(error,"AttributeError",invocation)
        : context.isAttributeError(error);
      meter.checkpoint();
      if (!missing) throw error;
      return name === "hasattr" ? values.false : positional[2];
    }
    meter.checkpoint();
    return name === "hasattr" ? values.true : result;
  } });
}
