import type { DocumentBudget } from "./budget.js";

const maximumCommentId = 2147483647;

export function allocateCommentId(ids: Iterable<number>, budget: DocumentBudget): number {
  const used = new Set<number>();
  let maximum = -1;
  for (const id of ids) {
    budget.charge("work", 1);
    used.add(id);
    maximum = Math.max(maximum, id);
  }
  if (maximum < maximumCommentId) return maximum + 1;
  let next = 0;
  while (used.has(next)) {
    budget.charge("work", 1);
    next++;
  }
  return next;
}
