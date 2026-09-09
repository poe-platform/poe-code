import type { Expression } from "../ast.js";
import type { Statement } from "../statement-ast.js";
import { annotationTargetExpressions } from "../annotation-targets.js";
import { assignTargets, type AssignmentContext } from "./assignment-targets.js";
import type { ExecutionMeter } from "./execution-budget.js";

export interface AssignmentExecutionContext<Value> extends AssignmentContext<Value> {
  evaluate(expression: Expression): Value;
}

/** Execute statically validated ordinary/annotated assignments. Annotation
 * expressions never execute; valueless target expressions still have effects.
 * Evaluation is synchronous; guest protocols, suspension and complete temporary
 * frame allocation accounting remain adapter/runtime responsibilities.
 */
export function executeAssignment<Value>(
  statement: Extract<Statement, { kind: "assignment" | "annotated-assignment" }>,
  context: AssignmentExecutionContext<Value>, meter: ExecutionMeter
): void {
  meter.checkpoint();
  if (statement.kind === "annotated-assignment" && statement.value === null) {
    for (const expression of annotationTargetExpressions(statement.target, "<string>", meter)) {
      meter.checkpoint();
      context.evaluate(expression);
    }
    return;
  }
  const value = context.evaluate(statement.value!);
  assignTargets(statement.kind === "assignment" ? statement.targets : [statement.target], value, context, meter);
}
