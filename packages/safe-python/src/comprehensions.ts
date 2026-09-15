import type { ComprehensionClause, Expression } from "./ast.js";
import type { TokenCursor } from "./token-cursor.js";
import { readLoopTarget } from "./targets.js";

/** Iterables and filters use disjunction precedence, leaving `if` for clauses. */
export function readComprehensionClauses(cursor: TokenCursor, read: (cursor: TokenCursor, minimum?: number) => Expression): ComprehensionClause[] {
  try {
  cursor.meter?.checkpoint(1,32);
  const clauses: ComprehensionClause[] = [];
  do {
    const start = cursor.peek().start;
    const async = cursor.peek().text === "async";
    if (async) cursor.take();
    cursor.expect("for");
    const target = readLoopTarget(cursor, read);
    cursor.expect("in");
    const iterable = read(cursor, 2);
    cursor.meter?.checkpoint(0,32);
    const filters: Expression[] = [];
    while (cursor.peek().text === "if") {
      cursor.take();
      cursor.meter?.checkpoint(0,8);
      filters.push(read(cursor, 2));
    }
    cursor.meter?.checkpoint(0,96);
    clauses.push({ async, target, iterable, filters, start, end: filters.at(-1)?.end ?? iterable.end });
  } while (cursor.peek().text === "for" || cursor.peek().text === "async");
  return clauses;
  } finally {cursor.meter?.checkpoint();}
}
