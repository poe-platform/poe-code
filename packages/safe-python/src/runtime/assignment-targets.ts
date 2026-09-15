import type { Expression,SourceSpan } from "../ast.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { UnpackedAssignment } from "./assignment-unpacking.js";

export interface AssignmentContext<Value> {
  /** Each nested unpack/store belongs to its own target, not the RHS. */
  position?(site:SourceSpan):void;
  store(name: string, value: Value): void;
  unpack(value: Value, before: number, after: number | null): UnpackedAssignment<Value>;
  list(values: readonly Value[]): Value;
  /** Evaluate the receiver/key now, retaining the resulting reference for set.
   * Concrete expression evaluation, descriptors, subscriptions and internal
   * metering belong to this adapter, not to the target traversal.
   */
  resolve(target: Extract<Expression, { kind: "attribute" | "subscript" }>): { set(value: Value): void };
}

export interface ResumableAssignmentContext<Value> extends Omit<AssignmentContext<Value>, "resolve"> {
  resolve(target: Extract<Expression, { kind: "attribute" | "subscript" }>): Generator<Value, { set(value: Value): void }, Value>;
}

type AssignmentTargetExecution<Value> =
  | { kind: "synchronous"; context: AssignmentContext<Value> }
  | { kind: "resumable"; context: ResumableAssignmentContext<Value> };

/** Assign one already-evaluated RHS to statically validated chained targets.
 * Each unpack completes before that level's child stores; later failures do not
 * roll back earlier stores. Work is iterative, including nested starred targets.
 * Traversal accounts for its work array and queued records; the context owns
 * scope resolution, guest protocols and guest-value heap accounting.
 */
export function assignTargets<Value>(
  targets: readonly Expression[], value: Value, context: AssignmentContext<Value>, meter: ExecutionMeter
): void {
  meter.checkpoint(1, 224);
  const result = assignmentTargetsContinuation<Value>(targets, value, { kind: "synchronous", context }, meter).next();
  if (!result.done) throw Error("synchronous target assignment unexpectedly suspended");
}

/** Preserve queued unpacked values and earlier stores across target evaluation. */
export function createAssignmentTargetsContinuation<Value>(targets: readonly Expression[], value: Value, context: ResumableAssignmentContext<Value>, meter: ExecutionMeter): Generator<Value, void, Value> {
  meter.checkpoint(1, 224);
  return assignmentTargetsContinuation<Value>(targets, value, { kind: "resumable", context }, meter);
}

function* assignmentTargetsContinuation<Value>(targets: readonly Expression[], value: Value, execution: AssignmentTargetExecution<Value>, meter: ExecutionMeter): Generator<Value, void, Value> {
  meter.checkpoint(0, 32);
  const context = execution.context;
  const work: { target: Expression; value: Value }[] = [];
  for (let index = targets.length - 1; index >= 0; index--) {
    meter.checkpoint(1, 40); work.push({ target: targets[index], value });
  }
  while (work.length) {
    meter.checkpoint();
    const current = work.pop()!, target = current.target;
    if(context.position!==undefined){try{context.position(target.contentSpan??target);}finally{meter.checkpoint(0);}}
    if (target.kind === "name") {
      context.store(target.name, current.value);
      meter.checkpoint(0);
    } else if (target.kind === "attribute" || target.kind === "subscript") {
      const reference = execution.kind === "synchronous" ? execution.context.resolve(target) : yield* execution.context.resolve(target);
      meter.checkpoint();
      reference.set(current.value);
      meter.checkpoint(0);
    } else if (target.kind === "tuple" || target.kind === "list") {
      let star = -1;
      for (let index = 0; index < target.items.length; index++) {
        meter.checkpoint();
        if (target.items[index].kind === "unpack") {
          if (star !== -1) throw new Error("assignment targets must be statically validated");
          star = index;
        }
      }
      meter.checkpoint();
      const unpacked = context.unpack(current.value, star === -1 ? target.items.length : star, star === -1 ? null : target.items.length - star - 1);
      meter.checkpoint(0);
      let middle!: Value;
      if (star !== -1) { meter.checkpoint(); middle = context.list(unpacked.starred!); meter.checkpoint(0); }
      for (let index = target.items.length - 1; index >= 0; index--) {
        meter.checkpoint(1, 40);
        const item = target.items[index];
        const child = index === star ? middle : star === -1 || index < star ? unpacked.leading[index] : unpacked.trailing[index - star - 1];
        work.push({ target: item.kind === "unpack" ? item.value : item, value: child });
      }
    } else throw new Error("assignment targets must be statically validated");
  }
}
