import type { ExecutionMeter } from "./execution-budget.js";
import type { ListStorage } from "./list-storage.js";

export type ListComparisonOperator = "==" | "!=" | "<" | "<=" | ">" | ">=";

export interface ListComparisonContext<Value, Result> {
  /** Rich equality followed by guest truth conversion. */
  equal(left: Value, right: Value): boolean;
  /** Full reflected rich ordering; its result need not be a guest boolean. */
  order(operator: Exclude<ListComparisonOperator, "==" | "!=">, left: Value, right: Value): Result;
  boolean(value: boolean): Result;
}

/** Compare exact list storage using live numeric positions, not a snapshot.
 * Equality callbacks may resize either list or replace the differing slots.
 * Guest type dispatch, recursive comparison limits and finalizers remain with
 * the runtime caller. The meter bounds growth during callback-driven traversal.
 */
export function compareLists<Value, Result>(operator: ListComparisonOperator, left: ListStorage<Value>, right: ListStorage<Value>, context: ListComparisonContext<Value, Result>, meter: ExecutionMeter): Result {
  meter.checkpoint();
  if ((operator === "==" || operator === "!=") && left.length !== right.length) return context.boolean(operator === "!=");
  let index = 0;
  for (; index < left.length && index < right.length; index++) {
    meter.checkpoint();
    const a = left.get(BigInt(index)), b = right.get(BigInt(index));
    if (Object.is(a, b)) continue;
    const equal = context.equal(a, b);
    meter.checkpoint();
    if (!equal) break;
  }
  if (index >= left.length || index >= right.length) {
    const difference = left.length - right.length;
    switch (operator) {
      case "==": return context.boolean(difference === 0);
      case "!=": return context.boolean(difference !== 0);
      case "<": return context.boolean(difference < 0);
      case "<=": return context.boolean(difference <= 0);
      case ">": return context.boolean(difference > 0);
      case ">=": return context.boolean(difference >= 0);
    }
  }
  if (operator === "==" || operator === "!=") return context.boolean(operator === "!=");
  const result = context.order(operator, left.get(BigInt(index)), right.get(BigInt(index)));
  meter.checkpoint();
  return result;
}
