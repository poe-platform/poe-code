import type { DocumentBudget } from "./budget.js";
import { trimXmlWhitespace } from "./stored-lexical.js";

/** Decode a native integer identity without rewriting its stored lexeme. */
export function storedCommentId(value: string | undefined): number | null {
  if (value === undefined) return null;
  const raw = trimXmlWhitespace(value), digits = raw[0] === "+" || raw[0] === "-" ? raw.slice(1) : raw;
  if (!digits || [...digits].some(char => !"0123456789".includes(char))) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id >= 0 ? id === 0 ? 0 : id : null;
}

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
