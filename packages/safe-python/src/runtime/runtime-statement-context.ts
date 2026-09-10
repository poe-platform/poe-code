import type { Expression } from "../ast.js";
import { createAssignmentContinuation, executeAssignment, type AssignmentExecutionContext, type ResumableAssignmentExecutionContext } from "./assignment-execution.js";
import { assignTargets, createAssignmentTargetsContinuation } from "./assignment-targets.js";
import { unpackAssignment } from "./assignment-unpacking.js";
import { createAugmentedAssignmentContinuation, executeAugmentedAssignment, type AugmentedAssignmentContext } from "./augmented-assignment.js";
import { createDeletionContinuation, deleteTargets } from "./deletion-targets.js";
import { PythonRuntimeError } from "./error.js";
import { ProtocolIterator } from "./protocol-iterator.js";
import { nativeIteratorLengthHint } from "./native-iterator-length-hint.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { createExpressionContinuation, evaluateExpression, type ExpressionContext } from "./expression-evaluation.js";
import { runtimeInPlace } from "./runtime-inplace.js";
import { createRuntimeReferenceContinuation, resolveRuntimeReference, type RuntimeReferenceWrites } from "./runtime-reference.js";
import { UnsupportedStatementError, type LeafStatement, type ResumableStatementContext, type StatementContext } from "./statement-execution.js";
import type { BuiltinInvocationContext, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export type UnhandledRuntimeStatement = Exclude<LeafStatement, { kind: "expression-statement" | "assignment" | "annotated-assignment" | "augmented-assignment" | "delete" }>;

export interface RuntimeStatementBindings extends RuntimeReferenceWrites,
  Pick<StatementContext<RuntimeValue>, "assertions" | "managers" | "exceptions"> {
  readonly invocation?: BuiltinInvocationContext;
  readonly asyncIterate?:ResumableStatementContext<RuntimeValue>["asyncIterate"];
  /** Invoke the left type's in-place slot, returning NotImplemented when absent
   * or declined. Do not perform ordinary binary fallback here. Disabled slots
   * raise through the adapter; mutations are not undone if fallback later fails. */
  inplace?(operator: string, left: RuntimeValue, right: RuntimeValue): RuntimeValue;
  /** Execute definitions/imports/raise or throw an explicit implementation gap. */
  executeUnhandled(statement: UnhandledRuntimeStatement): void;
  /** Resumable definition/import/raise assembly. Without this capability these
   * leaf kinds fail explicitly; they never fall back to synchronous evaluation. */
  executeUnhandledContinuation?(statement: UnhandledRuntimeStatement): Generator<RuntimeValue, void, RuntimeValue>;
}

export interface RuntimeStatementContext extends StatementContext<RuntimeValue> {
  /** Bind source-level continuations lazily; do not execute guest code. */
  suspend(): ResumableStatementContext<RuntimeValue>;
}

/** Connect analyzed statement traversal to concrete expressions, references and
 * exact-value mutation. Hooks supply the unfinished object/exception/import
 * capabilities explicitly; no filesystem or host execution capability is added.
 * Guest in-place slots precede exact native mutation, then the expression
 * context performs ordinary binary fallback. All components share one meter.
 */
export function createRuntimeStatementContext(expressions: ExpressionContext<RuntimeValue>, bindings: RuntimeStatementBindings, values: RuntimeValues, meter: ExecutionMeter): RuntimeStatementContext {
  meter.checkpoint(1, 832);
  const resolve = (target: Expression) => resolveRuntimeReference(target, expressions, bindings, values, meter);
  const assignment: AssignmentExecutionContext<RuntimeValue> = {
    evaluate: expression => evaluateExpression(expression, expressions, meter),
    store: expressions.store.bind(expressions), list: expressions.list.bind(expressions), resolve,
    unpack(value, before, after) {
      meter.checkpoint();
      // Exact sequences expose their cardinality without guest iteration. Do
      // not use subclass payloads: their iterator can have different contents.
      const length=value.kind==="list"?value.items.length:value.kind==="tuple"?value.items.length:undefined;
      if(after===null&&length!==undefined&&length>before)throw new PythonRuntimeError("ValueError",`too many values to unpack (expected ${before}, got ${length})`);
      const iterator = expressions.iterate(value, name => {
        throw new PythonRuntimeError("TypeError", `cannot unpack non-iterable ${name} object`);
      });
      return unpackAssignment(iterator, before, after, meter,
        () => {
          if (iterator instanceof ProtocolIterator) {
            const remainder = iterator.reacquire();
            iterator.lengthHint(8n);
            return remainder;
          }
          nativeIteratorLengthHint(iterator, meter);
          return iterator;
        });
    }
  };
  const augmented: AugmentedAssignmentContext<RuntimeValue> = {
    evaluate: assignment.evaluate, resolve,
    inplace(operator, left, right) {
      const result = bindings.inplace === undefined ? values.notImplemented : bindings.inplace(operator, left, right);
      meter.checkpoint();
      if (result !== values.notImplemented) return result;
      return runtimeInPlace(operator, left, right, values, meter, expressions, bindings.invocation);
    }
  };
  const deletion = { removeName: bindings.deleteName.bind(bindings), resolve };
  const context: RuntimeStatementContext = {
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
    },
    suspend() {
      meter.checkpoint(1, 768);
      const resolveSuspended = (target: Expression) => createRuntimeReferenceContinuation(target, expressions, bindings, values, meter);
      const suspended: ResumableAssignmentExecutionContext<RuntimeValue> = {
        ...assignment,
        evaluate: expression => createExpressionContinuation(expression, expressions, meter, values.none),
        resolve: resolveSuspended
      };
      const inPlace = { ...augmented, evaluate: suspended.evaluate, resolve: resolveSuspended };
      const remove = { ...deletion, resolve: resolveSuspended };
      function* executeLeaf(statement: LeafStatement): Generator<RuntimeValue, void, RuntimeValue> {
        meter.checkpoint(0);
        switch (statement.kind) {
          case "expression-statement": yield* suspended.evaluate(statement.expression); return;
          case "assignment": case "annotated-assignment": yield* createAssignmentContinuation(statement, suspended, meter); return;
          case "augmented-assignment": yield* createAugmentedAssignmentContinuation(statement, inPlace, meter); return;
          case "delete": yield* createDeletionContinuation(statement.targets, remove, meter); return;
          default:
            if (bindings.executeUnhandledContinuation === undefined) throw new UnsupportedStatementError(statement.kind);
            yield* bindings.executeUnhandledContinuation(statement);
        }
      }
      return {
        evaluate: suspended.evaluate,
        test: expression => createExpressionContinuation(expression, expressions, meter, values.none, "branch"),
        iterate: context.iterate, assertions: context.assertions, managers: context.managers, exceptions: context.exceptions,
        asyncIterate:bindings.asyncIterate,
        assign(target, value) { meter.checkpoint(0, 8); return createAssignmentTargetsContinuation([target], value, suspended, meter); },
        execute(statement) { meter.checkpoint(1, 192); return executeLeaf(statement); }
      };
    }
  };
  if (bindings.assertions) context.assertions = bindings.assertions;
  if (bindings.managers) context.managers = bindings.managers;
  if (bindings.exceptions) context.exceptions = bindings.exceptions;
  return context;
}
