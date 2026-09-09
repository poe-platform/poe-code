import type { Expression } from "../ast.js";
import type { Statement } from "../statement-ast.js";
import type { ExecutionMeter } from "./execution-budget.js";

export interface AugmentedAssignmentContext<Value> {
  /** Resolve once, retaining receiver/key identity, not a cached value or setter.
   * Get/set must perform the current guest lookup when invoked. Name references
   * retain their lexical binding destination, even if loading uses a fallback.
   */
  resolve(target: Expression): { get(): Value; set(value: Value): void };
  evaluate(expression: Expression): Value;
  /** Includes in-place negotiation and ordinary binary fallback. */
  inplace(operator: string, left: Value, right: Value): Value;
}

/** Execute a statically validated augmented assignment without re-evaluating its
 * target. Guest callbacks own protocol dispatch and internal resource accounting.
 * A failed write-back does not undo mutations performed by the in-place operator.
 * This synchronous kernel does not support suspended RHS evaluation yet.
 */
export function executeAugmentedAssignment<Value>(
  statement: Extract<Statement, { kind: "augmented-assignment" }>,
  context: AugmentedAssignmentContext<Value>, meter: ExecutionMeter
): void {
  meter.checkpoint();
  const reference = context.resolve(statement.target);
  meter.checkpoint();
  const left = reference.get();
  meter.checkpoint();
  const right = context.evaluate(statement.value);
  meter.checkpoint();
  const result = context.inplace(statement.operator, left, right);
  meter.checkpoint();
  reference.set(result);
}
