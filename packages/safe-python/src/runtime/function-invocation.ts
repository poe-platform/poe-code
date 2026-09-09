import type { FunctionExecutionKind } from "../expression-context.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { createFunctionFrame, type FunctionCallArguments, type FunctionFrameContext } from "./function-frame.js";
import type { LexicalFrame } from "./lexical-frame.js";
import { executeStatements, type StatementContext } from "./statement-execution.js";
import type { CallStack } from "./call-stack.js";
import type { CompiledFunction } from "./function-compilation.js";
import type { CompiledClassBody } from "./class-compilation.js";
import { bindArguments } from "./argument-binding.js";

export interface FunctionInvocationContext<Value, Key = string> extends FunctionFrameContext<Value, Key> {
  readonly none: Value;
  /** Shared across all nested calls in this execution context. */
  readonly calls: Pick<CallStack<LexicalFrame<Value>>, "enter">;
  /** Bind expression/statement protocols to this activation. Do not execute guest
   * code merely to prepare the context. Function-local operations use this frame;
   * nested definitions capture its cells, not copied values.
   */
  body(frame: LexicalFrame<Value>): StatementContext<Value>;
  /** Ordinary invocation of class-body code uses its defining globals as locals,
   * not the prepared namespace used by __build_class__. */
  classBody?(code: CompiledClassBody<Value>): Value;
  /** Allocate an unstarted generator/coroutine/async-generator object retaining
   * the frame. This must not run the body. Resumption and lifecycle protocols are
   * supplied by the suspension backend, not synchronous statement execution.
   */
  suspended?(kind: Exclude<FunctionExecutionKind, "function">, frame: LexicalFrame<Value>, code: CompiledFunction<Value>): Value;
}

export class UnsupportedFunctionExecutionError extends Error {
  constructor(readonly kind: Exclude<FunctionExecutionKind, "function">) {
    super(`unsupported function execution: ${kind}`);
    this.name = "UnsupportedFunctionExecutionError";
  }
}

/** Invoke a compiled function/lambda with already evaluated, expanded arguments.
 * Compilation retains the analyzed execution kind and reusable body. Binding occurs
 * at call time even for suspended functions. Ordinary suites use explicit control
 * flow frames, while lambda bodies evaluate directly in value context. The outer
 * runtime supplies shared depth policy and still owns guest traceback bookkeeping,
 * stack-independent call dispatch, full heap accounting and suspension protocols.
 */
export function invokeFunction<Value, Key = string>(
  code: CompiledFunction<Value>, call: FunctionCallArguments<Value, Key>,
  context: FunctionInvocationContext<Value, Key>, meter: ExecutionMeter
): Value {
  meter.checkpoint();
  if (code.body.kind === "class") {
    bindArguments(call.name, [], call.positional, call.keywords, call.defaults, meter, call.keywordNames);
    if (context.classBody === undefined) throw new Error("class-body function execution is unavailable");
    const result = context.classBody(code.body.code);
    meter.checkpoint();
    return result;
  }
  const frame = createFunctionFrame(code.scope, call, context, meter);
  meter.checkpoint();
  if (code.kind !== "function") {
    if (!context.suspended) throw new UnsupportedFunctionExecutionError(code.kind);
    return context.suspended(code.kind, frame, code);
  }
  const leave = context.calls.enter(frame);
  try {
    const bodyContext = context.body(frame);
    if (code.body.kind === "expression") {
      meter.checkpoint();
      return bodyContext.evaluate(code.body.expression);
    }
    const result = executeStatements(code.body.statements, bodyContext, meter);
    return result.kind === "return" && Object.hasOwn(result, "value") ? result.value! : context.none;
  } finally {
    leave();
  }
}
