import type { CollectionItem, Expression } from "./ast.js";
import type { MatchCase, Statement } from "./statement-ast.js";
import type { TokenCursor } from "./token-cursor.js";
import { readExpression } from "./expression.js";
import { readNamedExpression } from "./named-expression.js";
import { readPatterns } from "./patterns.js";
import { validatePattern } from "./pattern-validation.js";

/** Commit to the soft-keyword statement only after recognizing its full header. */
export function readMatch(cursor: TokenCursor, readSuite: (cursor: TokenCursor) => Statement[]): Statement | undefined {
  const start = cursor.peek().start;
  const subject = cursor.attempt(() => {
    cursor.expect("match");
    const subject = readSubject(cursor);
    cursor.expect(":");
    if (cursor.peek().kind !== "newline") throw cursor.error("expected newline after match subject");
    cursor.take();
    return subject;
  });
  if (!subject) return undefined;
  if (cursor.peek().kind !== "indent") throw cursor.error("expected an indented case block");
  cursor.take();
  const cases: MatchCase[] = [];
  let finalCase = false;
  while (cursor.peek().text === "case") {
    if (finalCase) throw cursor.error("irrefutable pattern makes remaining cases unreachable");
    const start = cursor.take().start;
    const pattern = readPatterns(cursor);
    const irrefutable = validatePattern(pattern, cursor);
    let guard: Expression | null = null;
    if (cursor.peek().text === "if") { cursor.take(); guard = readNamedExpression(cursor, readExpression); }
    finalCase = irrefutable && guard === null;
    const body = readSuite(cursor);
    cases.push({ pattern, guard, body, start, end: body[body.length - 1]!.end });
  }
  if (!cases.length || cursor.peek().kind !== "dedent") throw cursor.error("expected case block");
  cursor.take();
  return { kind: "match", subject, cases, start, end: cases[cases.length - 1]!.end };
}

function readSubject(cursor: TokenCursor): Expression {
  const items: CollectionItem[] = [];
  let comma = false;
  let end = cursor.peek().end;
  do {
    if (cursor.peek().text === "*") {
      const start = cursor.take().start;
      const value = readExpression(cursor, 6);
      items.push({ kind: "unpack", value, start, end: value.end });
    } else items.push(readNamedExpression(cursor, readExpression));
    end = items[items.length - 1]!.end;
    if (cursor.peek().text !== ",") break;
    comma = true;
    end = cursor.take().end;
  } while (cursor.peek().text !== ":");
  if (comma) return { kind: "tuple", items, start: items[0]!.start, end };
  const first = items[0]!;
  if (first.kind === "unpack") throw cursor.error("starred subject requires a tuple");
  return first;
}
