import type { Expression } from "../ast.js";
import type { Statement } from "../statement-ast.js";
import { annotationTargetExpressions } from "../annotation-targets.js";
import { assignTargets, createAssignmentTargetsContinuation, type AssignmentContext, type ResumableAssignmentContext } from "./assignment-targets.js";
import type { ExecutionMeter } from "./execution-budget.js";

export interface AssignmentExecutionContext<Value> extends AssignmentContext<Value> {
  evaluate(expression: Expression): Value;
}

export interface ResumableAssignmentExecutionContext<Value> extends ResumableAssignmentContext<Value> {
  evaluate(expression: Expression): Generator<Value, Value, Value>;
}

type AssignmentExecution<Value> =
  | { kind: "synchronous"; context: AssignmentExecutionContext<Value> }
  | { kind: "resumable"; context: ResumableAssignmentExecutionContext<Value> };

/** Execute statically validated ordinary/annotated assignments. Annotation
 * expressions never execute; valueless target expressions still have effects.
 * Synchronous and resumable paths share evaluation and target ordering. Guest
 * protocols and complete temporary accounting remain adapter responsibilities.
 */
export function executeAssignment<Value>(
  statement: Extract<Statement, { kind: "assignment" | "annotated-assignment" }>,
  context: AssignmentExecutionContext<Value>, meter: ExecutionMeter
): void {
  meter.checkpoint(1, 224);
  const result = assignmentContinuation<Value>(statement, { kind: "synchronous", context }, meter).next();
  if (!result.done) throw Error("synchronous assignment unexpectedly suspended");
}

export function createAssignmentContinuation<Value>(statement: Extract<Statement, { kind: "assignment" | "annotated-assignment" }>, context: ResumableAssignmentExecutionContext<Value>, meter: ExecutionMeter): Generator<Value, void, Value> {
  meter.checkpoint(1, 224);
  return assignmentContinuation<Value>(statement, { kind: "resumable", context }, meter);
}

function* assignmentContinuation<Value>(statement: Extract<Statement, { kind: "assignment" | "annotated-assignment" }>, execution: AssignmentExecution<Value>, meter: ExecutionMeter): Generator<Value, void, Value> {
  meter.checkpoint(0);
  if (statement.kind === "annotated-assignment" && statement.value === null) {
    for (const expression of annotationTargetExpressions(statement.target, "<string>", meter)) {
      meter.checkpoint();
      if (execution.kind === "synchronous") execution.context.evaluate(expression);
      else yield* execution.context.evaluate(expression);
    }
    return;
  }
  const value = execution.kind === "synchronous" ? execution.context.evaluate(statement.value!) : yield* execution.context.evaluate(statement.value!);
  const targets = statement.kind === "assignment" ? statement.targets : [statement.target];
  if (execution.kind === "synchronous") assignTargets(targets, value, execution.context, meter);
  else yield* createAssignmentTargetsContinuation(targets, value, execution.context, meter);
}
