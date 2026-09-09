import type { Expression, Parameter } from "./ast.js";
import { reservedWords } from "./keywords.js";
import type { TokenCursor } from "./token-cursor.js";

export function readLambda(cursor: TokenCursor, read: (cursor: TokenCursor) => Expression): Expression {
  const start = cursor.expect("lambda").start;
  const parameters: Parameter[] = [];
  const names = new Set<string>();
  let slash = false;
  let keywordOnly = false;
  let positionalDefault = false;
  let bareStar = false;
  let keywordCount = 0;
  let finished = false;
  while (cursor.peek().text !== ":") {
    if (finished) throw cursor.error("arguments cannot follow var-keyword argument");
    const first = cursor.peek();
    if (first.text === "/") {
      if (slash || keywordOnly || parameters.length === 0) throw cursor.error("invalid positional-only separator");
      cursor.take();
      slash = true;
      for (let i = 0; i < parameters.length; i++) parameters[i] = { ...parameters[i], kind: "positional-only" };
    } else {
      let kind: Parameter["kind"] = keywordOnly ? "keyword-only" : "positional-or-keyword";
      if (first.text === "*" || first.text === "**") {
        if (first.text === "*" && keywordOnly) throw cursor.error("duplicate star parameter");
        cursor.take();
        keywordOnly = true;
        if (first.text === "*" && cursor.peek().text === ",") {
          bareStar = true;
          cursor.take();
          continue;
        }
        kind = first.text === "*" ? "var-positional" : "var-keyword";
        finished = kind === "var-keyword";
      }
      const name = cursor.peek();
      if (name.kind !== "name" || reservedWords.has(name.text)) throw cursor.error("expected parameter name");
      if (names.has(name.text)) throw cursor.error("duplicate argument in function definition");
      names.add(name.text);
      cursor.take();
      let value: Expression | null = null;
      if (cursor.peek().text === "=") {
        if (kind === "var-positional" || kind === "var-keyword") throw cursor.error("variadic arguments cannot have defaults");
        cursor.take();
        value = read(cursor);
      }
      if (kind === "positional-or-keyword") {
        if (value === null && positionalDefault) throw cursor.error("non-default argument follows default argument");
        positionalDefault ||= value !== null;
      }
      if (kind === "keyword-only") keywordCount++;
      parameters.push({ kind, spelling: name.text, default: value, start: first.start, end: value?.end ?? name.end });
    }
    if (cursor.peek().text !== ",") break;
    cursor.take();
  }
  if (bareStar && keywordCount === 0) throw cursor.error("named arguments must follow bare star");
  cursor.expect(":");
  const body = read(cursor);
  return { kind: "lambda", parameters, body, start, end: body.end };
}
