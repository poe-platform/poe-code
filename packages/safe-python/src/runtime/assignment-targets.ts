import type { Expression } from "../ast.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { UnpackedAssignment } from "./assignment-unpacking.js";

export interface AssignmentContext<Value> {
  store(name: string, value: Value): void;
  unpack(value: Value, before: number, after: number | null): UnpackedAssignment<Value>;
  list(values: readonly Value[]): Value;
  /** Evaluate the receiver/key now, retaining the resulting reference for set.
   * Concrete expression evaluation, descriptors, subscriptions and internal
   * metering belong to this adapter, not to the target traversal.
   */
  resolve(target: Extract<Expression, { kind: "attribute" | "subscript" }>): { set(value: Value): void };
}

/** Assign one already-evaluated RHS to statically validated chained targets.
 * Each unpack completes before that level's child stores; later failures do not
 * roll back earlier stores. Work is iterative, including nested starred targets.
 * The context owns scope resolution, guest protocols and heap accounting.
 */
export function assignTargets<Value>(
  targets: readonly Expression[], value: Value, context: AssignmentContext<Value>, meter: ExecutionMeter
): void {
  meter.checkpoint();
  const work: { target: Expression; value: Value }[] = [];
  for (let index = targets.length - 1; index >= 0; index--) {
    meter.checkpoint(); work.push({ target: targets[index], value });
  }
  while (work.length) {
    meter.checkpoint();
    const current = work.pop()!, target = current.target;
    if (target.kind === "name") context.store(target.name, current.value);
    else if (target.kind === "attribute" || target.kind === "subscript") {
      const reference = context.resolve(target);
      meter.checkpoint();
      reference.set(current.value);
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
      let middle!: Value;
      if (star !== -1) { meter.checkpoint(); middle = context.list(unpacked.starred!); }
      for (let index = target.items.length - 1; index >= 0; index--) {
        meter.checkpoint();
        const item = target.items[index];
        const child = index === star ? middle : star === -1 || index < star ? unpacked.leading[index] : unpacked.trailing[index - star - 1];
        work.push({ target: item.kind === "unpack" ? item.value : item, value: child });
      }
    } else throw new Error("assignment targets must be statically validated");
  }
}
