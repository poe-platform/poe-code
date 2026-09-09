import type { Expression } from "../ast.js";
import { executeAssignment, type AssignmentExecutionContext } from "./assignment-execution.js";
import { assignTargets } from "./assignment-targets.js";
import { unpackAssignment } from "./assignment-unpacking.js";
import { executeAugmentedAssignment, type AugmentedAssignmentContext } from "./augmented-assignment.js";
import { deleteTargets } from "./deletion-targets.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { evaluateExpression, type ExpressionContext } from "./expression-evaluation.js";
import { runtimeInPlace } from "./runtime-inplace.js";
import { resolveRuntimeReference, type RuntimeReferenceWrites } from "./runtime-reference.js";
import { UnsupportedStatementError, type LeafStatement, type StatementContext } from "./statement-execution.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";

export type UnhandledRuntimeStatement = Exclude<LeafStatement, { kind: "expression-statement" | "assignment" | "annotated-assignment" | "augmented-assignment" | "delete" }>;

export interface RuntimeStatementBindings extends RuntimeReferenceWrites,
  Pick<StatementContext<RuntimeValue>, "assertions" | "managers" | "exceptions"> {
  /** Execute definitions/imports/raise or throw an explicit implementation gap. */
  executeUnhandled(statement: UnhandledRuntimeStatement): void;
}

/** Connect analyzed statement traversal to concrete expressions, references and
 * exact-value mutation. Hooks supply the unfinished object/exception/import
 * capabilities explicitly; no filesystem or host execution capability is added.
 * Starred unpacking length hints, full temporary accounting and guest in-place
 * negotiation remain unfinished. All components share this execution meter.
 */
export function createRuntimeStatementContext(expressions: ExpressionContext<RuntimeValue>, bindings: RuntimeStatementBindings, values: RuntimeValues, meter: ExecutionMeter): StatementContext<RuntimeValue> {
  meter.checkpoint(1, 768);
  const resolve = (target: Expression) => resolveRuntimeReference(target, expressions, bindings, values, meter);
  const assignment: AssignmentExecutionContext<RuntimeValue> = {
    evaluate: expression => evaluateExpression(expression, expressions, meter),
    store: expressions.store.bind(expressions), list: expressions.list.bind(expressions), resolve,
    unpack(value, before, after) {
      let iterator: Iterator<RuntimeValue>;
      try { iterator = expressions.iterate(value); }
      catch (error) {
        if (error instanceof PythonRuntimeError && error.name === "TypeError" &&
            value.kind !== "list" && value.kind !== "tuple" && value.kind !== "range" && value.kind !== "iterator" && value.kind !== "str" && value.kind !== "bytes" && value.kind !== "dict") {
          const name = value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind;
          throw new PythonRuntimeError("TypeError", `cannot unpack non-iterable ${name} object`);
        }
        throw error;
      }
      return unpackAssignment(iterator, before, after, meter);
    }
  };
  const augmented: AugmentedAssignmentContext<RuntimeValue> = {
    evaluate: assignment.evaluate, resolve,
    inplace(operator, left, right) {
      const result = runtimeInPlace(operator, left, right, values, meter);
      if (result === values.notImplemented) throw new UnsupportedStatementError("augmented-assignment");
      return result;
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
