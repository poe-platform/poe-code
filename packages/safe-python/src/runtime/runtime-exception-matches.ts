import { PythonRuntimeError } from "./error.js";
import { ExecutionLimitError } from "./execution-budget.js";
import type { BuiltinInvocationContext } from "./runtime-values.js";

/** Native fast path plus execution-owned guest inheritance. A host termination
 * can never become catchable through an extension's classification policy. */
export function runtimeExceptionMatches(error:unknown,name:string,context?:Pick<BuiltinInvocationContext,"isException">):boolean {
  if(error instanceof ExecutionLimitError)return false;
  if(error instanceof PythonRuntimeError&&error.name===name)return true;
  return context?.isException?.(error,name)??false;
}
