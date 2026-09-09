import type { FunctionExecutionKind } from "../expression-context.js";
import type { ResolvedScope } from "../symbol-resolution.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { createFunctionFrame, type FunctionCallArguments, type FunctionFrameContext } from "./function-frame.js";
import type { LexicalFrame } from "./lexical-frame.js";
import { executeStatements, type StatementContext } from "./statement-execution.js";

export interface FunctionInvocationContext<Value> extends FunctionFrameContext<Value> {
  readonly none: Value;
  /** Bind expression/statement protocols to this activation. Do not execute guest
   * code merely to prepare the context. Function-local operations use this frame;
   * nested definitions capture its cells, not copied values.
   */
  body(frame: LexicalFrame<Value>): StatementContext<Value>;
  /** Allocate an unstarted generator/coroutine/async-generator object retaining
   * the frame. This must not run the body. Resumption and lifecycle protocols are
   * supplied by the suspension backend, not synchronous statement execution.
   */
  suspended?(kind: Exclude<FunctionExecutionKind, "function">, frame: LexicalFrame<Value>): Value;
}

export class UnsupportedFunctionExecutionError extends Error {
  constructor(readonly kind: Exclude<FunctionExecutionKind, "function">) {
    super(`unsupported function execution: ${kind}`);
    this.name = "UnsupportedFunctionExecutionError";
  }
}

/** Invoke an analyzed function/lambda with already evaluated, expanded arguments.
 * Kind must come from the analyzer entry for this exact scope node. Binding occurs
 * at call time even for suspended functions. Ordinary suites use explicit control
 * flow frames, while lambda bodies evaluate directly in value context. The outer
 * runtime still owns recursion limits, guest traceback/call-stack bookkeeping,
 * full heap accounting and concrete object/suspension protocols.
 */
export function invokeFunction<Value>(
  scope: ResolvedScope, kind: FunctionExecutionKind, call: FunctionCallArguments<Value>,
  context: FunctionInvocationContext<Value>, meter: ExecutionMeter
): Value {
  meter.checkpoint();
  const frame = createFunctionFrame(scope, call, context, meter);
  meter.checkpoint();
  if (kind !== "function") {
    if (!context.suspended) throw new UnsupportedFunctionExecutionError(kind);
    return context.suspended(kind, frame);
  }
  const bodyContext = context.body(frame);
  const node = scope.scope.node;
  if (node.kind === "lambda") {
    meter.checkpoint();
    return bodyContext.evaluate(node.body);
  }
  // createFunctionFrame already rejects other node kinds; retain narrowing here.
  if (node.kind !== "function") throw new Error("function calls require a function or lambda scope");
  const result = executeStatements(node.body, bodyContext, meter);
  return result.kind === "return" && Object.hasOwn(result, "value") ? result.value! : context.none;
}
