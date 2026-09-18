import type { DocumentBudget } from "./budget.js";

/** Allocate within a comment owner's IDs, retaining the signed 32-bit fallback. */
export function nextCommentId(ids: readonly number[], budget: DocumentBudget): number {
  budget.charge("work", ids.length + 1);
  let largest = -1;
  for (const id of ids) largest = Math.max(largest, id);
  if (largest < 2147483647) return largest + 1;
  budget.charge("retainedBytes", ids.length * 16);
  const used = new Set(ids);
  let next = 0;
  while (used.has(next)) { budget.charge("work", 1); next++; }
  return next;
}
