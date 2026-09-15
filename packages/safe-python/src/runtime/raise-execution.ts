import type { Expression } from "../ast.js";
import type { Statement } from "../statement-ast.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

export interface RaiseContext<Value> {
  evaluate(expression: Expression): Value;
  /** Internal exception flags/identity, not virtual instance/subclass checks. */
  isClass(value: Value): boolean;
  isInstance(value: Value): boolean;
  isNone(value: Value): boolean;
  typeOf(value: Value): Value;
  call(type: Value): Value;
  repr(value: Value): string;
  /** Set internal cause and enable context suppression. Null denotes from None;
   * a wrapper preserves exception payloads even when the host value is null.
   */
  setCause(exception: Value, cause: { readonly value: Value } | null): void;
  active(): { readonly value: Value } | undefined;
  /** Final normalization can invoke subclass checks and create a replacement
   * value; preserve the originally requested class. Then attach implicit context
   * and traceback and propagate. Concrete guest operations own internal metering.
   */
  raise(type: Value, value: Value): never;
  /** Propagate the active value/traceback without normalization or a new frame. */
  reraise(value: Value): never;
}

export interface ResumableRaiseContext<Value> extends Omit<RaiseContext<Value>, "evaluate"> {
  evaluate(expression: Expression): Generator<Value, Value, Value>;
}

type RaiseExecution<Value> =
  | { kind: "synchronous"; context: RaiseContext<Value> }
  | { kind: "resumable"; context: ResumableRaiseContext<Value> };

/** Synchronous raise-statement evaluation and initial exception construction.
 * Both source operands execute before constructor calls. Explicit cause mutation
 * precedes final normalization; errors do not roll back earlier guest effects.
 */
export function executeRaise<Value>(
  statement: Extract<Statement, { kind: "raise" }>, context: RaiseContext<Value>, meter: ExecutionMeter
): never {
  meter.checkpoint(1, 224);
  const result = raiseContinuation<Value>(statement, { kind: "synchronous", context }, meter).next();
  throw Error(result.done ? "raise adapter unexpectedly returned" : "synchronous raise unexpectedly suspended");
}

/** Both explicit operands finish before normalization, even when either yields. */
export function createRaiseContinuation<Value>(statement: Extract<Statement, { kind: "raise" }>, context: ResumableRaiseContext<Value>, meter: ExecutionMeter): Generator<Value, never, Value> {
  meter.checkpoint(1, 224);
  return raiseContinuation<Value>(statement, { kind: "resumable", context }, meter);
}

function* raiseContinuation<Value>(statement: Extract<Statement, { kind: "raise" }>, execution: RaiseExecution<Value>, meter: ExecutionMeter): Generator<Value, never, Value> {
  meter.checkpoint(0);
  const context = execution.context;
  if (statement.exception === null) {
    const active = context.active();
    if (active === undefined) throw new PythonRuntimeError("RuntimeError", "No active exception to reraise");
    meter.checkpoint();
    return context.reraise(active.value);
  }
  const requested = execution.kind === "synchronous" ? execution.context.evaluate(statement.exception) : yield* execution.context.evaluate(statement.exception);
  let cause!: Value;
  if (statement.cause !== null) { meter.checkpoint(); cause = execution.kind === "synchronous" ? execution.context.evaluate(statement.cause) : yield* execution.context.evaluate(statement.cause); }
  const construct = (input: Value, label: string): { type: Value; value: Value } => {
    meter.checkpoint();
    if (context.isClass(input)) {
      const value = context.call(input);
      if (!context.isInstance(value)) {
        meter.checkpoint();
        const typeRepr = context.repr(input);
        meter.checkpoint();
        const resultTypeRepr = context.repr(context.typeOf(value));
        throw new PythonRuntimeError("TypeError", `calling ${typeRepr} should have returned an instance of BaseException, not ${resultTypeRepr}`);
      }
      return { type: input, value };
    }
    if (context.isInstance(input)) return { type: context.typeOf(input), value: input };
    throw new PythonRuntimeError("TypeError", `${label} must derive from BaseException`);
  };
  const normalized = construct(requested, "exceptions");
  if (statement.cause !== null) {
    const fixedCause = context.isNone(cause) ? null : { value: construct(cause, "exception causes").value };
    meter.checkpoint();
    context.setCause(normalized.value, fixedCause);
  }
  meter.checkpoint();
  return context.raise(normalized.type, normalized.value);
}
