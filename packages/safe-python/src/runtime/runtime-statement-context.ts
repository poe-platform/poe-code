import type { Expression } from "../ast.js";
import { executeAssignment, type AssignmentExecutionContext } from "./assignment-execution.js";
import { assignTargets } from "./assignment-targets.js";
import { unpackAssignment } from "./assignment-unpacking.js";
import { executeAugmentedAssignment, type AugmentedAssignmentContext } from "./augmented-assignment.js";
import { deleteTargets } from "./deletion-targets.js";
import { PythonRuntimeError } from "./error.js";
import { ProtocolIterator } from "./protocol-iterator.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { evaluateExpression, type ExpressionContext } from "./expression-evaluation.js";
import { runtimeInPlace } from "./runtime-inplace.js";
import { resolveRuntimeReference, type RuntimeReferenceWrites } from "./runtime-reference.js";
import { type LeafStatement, type StatementContext } from "./statement-execution.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";

export type UnhandledRuntimeStatement = Exclude<LeafStatement, { kind: "expression-statement" | "assignment" | "annotated-assignment" | "augmented-assignment" | "delete" }>;

export interface RuntimeStatementBindings extends RuntimeReferenceWrites,
  Pick<StatementContext<RuntimeValue>, "assertions" | "managers" | "exceptions"> {
  /** Invoke the left type's in-place slot, returning NotImplemented when absent
   * or declined. Do not perform ordinary binary fallback here. Disabled slots
   * raise through the adapter; mutations are not undone if fallback later fails. */
  inplace?(operator: string, left: RuntimeValue, right: RuntimeValue): RuntimeValue;
  /** Execute definitions/imports/raise or throw an explicit implementation gap. */
  executeUnhandled(statement: UnhandledRuntimeStatement): void;
}

/** Connect analyzed statement traversal to concrete expressions, references and
 * exact-value mutation. Hooks supply the unfinished object/exception/import
 * capabilities explicitly; no filesystem or host execution capability is added.
 * Guest in-place slots precede exact native mutation, then the expression
 * context performs ordinary binary fallback. All components share one meter.
 */
export function createRuntimeStatementContext(expressions: ExpressionContext<RuntimeValue>, bindings: RuntimeStatementBindings, values: RuntimeValues, meter: ExecutionMeter): StatementContext<RuntimeValue> {
  meter.checkpoint(1, 768);
  const resolve = (target: Expression) => resolveRuntimeReference(target, expressions, bindings, values, meter);
  const assignment: AssignmentExecutionContext<RuntimeValue> = {
    evaluate: expression => evaluateExpression(expression, expressions, meter),
    store: expressions.store.bind(expressions), list: expressions.list.bind(expressions), resolve,
    unpack(value, before, after) {
      const iterator = expressions.iterate(value, name => {
        throw new PythonRuntimeError("TypeError", `cannot unpack non-iterable ${name} object`);
      });
      return unpackAssignment(iterator, before, after, meter,
        iterator instanceof ProtocolIterator ? () => {
          const remainder = iterator.reacquire();
          iterator.lengthHint(8n);
          return remainder;
        } : undefined);
    }
  };
  const augmented: AugmentedAssignmentContext<RuntimeValue> = {
    evaluate: assignment.evaluate, resolve,
    inplace(operator, left, right) {
      const result = bindings.inplace === undefined ? values.notImplemented : bindings.inplace(operator, left, right);
      meter.checkpoint();
      if (result !== values.notImplemented) return result;
      return runtimeInPlace(operator, left, right, values, meter, expressions);
    }
  };
  const deletion = { removeName: bindings.deleteName.bind(bindings), resolve };
  const context: StatementContext<RuntimeValue> = {
    evaluate: assignment.evaluate,
    test: expression => evaluateExpression(expression, expressions, meter, "branch"),
    iterate: expressions.iterate.bind(expressions),
    assign(target, value) { meter.checkpoint(0, 8); assignTargets([target], value, assignment, meter); },
    execute(statement) {
      meter.checkpoint();
      switch (statement.kind) {
        case "expression-statement": assignment.evaluate(statement.expression); return;
        case "assignment": case "annotated-assignment": executeAssignment(statement, assignment, meter); return;
        case "augmented-assignment": executeAugmentedAssignment(statement, augmented, meter); return;
        case "delete": deleteTargets(statement.targets, deletion, meter); return;
        default: bindings.executeUnhandled(statement);
      }
    }
  };
  if (bindings.assertions) context.assertions = bindings.assertions;
  if (bindings.managers) context.managers = bindings.managers;
  if (bindings.exceptions) context.exceptions = bindings.exceptions;
  return context;
}
