import type { Expression,SourceSpan } from "../ast.js";
import type { Statement } from "../statement-ast.js";
import type { ExecutionMeter } from "./execution-budget.js";

export interface AugmentedAssignmentContext<Value> {
  /** The operator belongs to the whole statement, not its last RHS operand. */
  position?(site:SourceSpan):void;
  /** Resolve once, retaining receiver/key identity, not a cached value or setter.
   * Get/set must perform the current guest lookup when invoked. Name references
   * retain their lexical binding destination, even if loading uses a fallback.
   */
  resolve(target: Expression): { get(): Value; set(value: Value): void };
  evaluate(expression: Expression): Value;
  /** Includes in-place negotiation and ordinary binary fallback. */
  inplace(operator: string, left: Value, right: Value): Value;
}

export interface ResumableAugmentedAssignmentContext<Value> extends Pick<AugmentedAssignmentContext<Value>, "inplace" | "position"> {
  resolve(target: Expression): Generator<Value, { get(): Value; set(value: Value): void }, Value>;
  evaluate(expression: Expression): Generator<Value, Value, Value>;
}

type AugmentedExecution<Value> =
  | { kind: "synchronous"; context: AugmentedAssignmentContext<Value> }
  | { kind: "resumable"; context: ResumableAugmentedAssignmentContext<Value> };

/** Execute a statically validated augmented assignment without re-evaluating its
 * target. Guest callbacks own protocol dispatch and internal resource accounting.
 * A failed write-back does not undo mutations performed by the in-place operator.
 * The resumable entry point retains the same reference and old value across yields.
 */
export function executeAugmentedAssignment<Value>(
  statement: Extract<Statement, { kind: "augmented-assignment" }>,
  context: AugmentedAssignmentContext<Value>, meter: ExecutionMeter
): void {
  meter.checkpoint(1, 224);
  const result = augmentedContinuation<Value>(statement, { kind: "synchronous", context }, meter).next();
  if (!result.done) throw Error("synchronous augmented assignment unexpectedly suspended");
}

export function createAugmentedAssignmentContinuation<Value>(statement: Extract<Statement, { kind: "augmented-assignment" }>, context: ResumableAugmentedAssignmentContext<Value>, meter: ExecutionMeter): Generator<Value, void, Value> {
  meter.checkpoint(1, 224);
  return augmentedContinuation<Value>(statement, { kind: "resumable", context }, meter);
}

function* augmentedContinuation<Value>(statement: Extract<Statement, { kind: "augmented-assignment" }>, execution: AugmentedExecution<Value>, meter: ExecutionMeter): Generator<Value, void, Value> {
  meter.checkpoint(0);
  const reference = execution.kind === "synchronous" ? execution.context.resolve(statement.target) : yield* execution.context.resolve(statement.target);
  meter.checkpoint();
  const left = reference.get();
  meter.checkpoint();
  const right = execution.kind === "synchronous" ? execution.context.evaluate(statement.value) : yield* execution.context.evaluate(statement.value);
  meter.checkpoint();
  if(execution.context.position!==undefined){try{execution.context.position(statement);}finally{meter.checkpoint(0);}}
  const result = execution.context.inplace(statement.operator, left, right);
  meter.checkpoint();
  reference.set(result);
}
