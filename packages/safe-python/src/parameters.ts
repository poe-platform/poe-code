import { validateAnnotation } from "./annotation-validation.js";
import type { Expression, Parameter } from "./ast.js";
import { reservedWords } from "./keywords.js";
import type { TokenCursor } from "./token-cursor.js";
import { normalizeNfkc } from "./normalization.js";

export function readParameters(cursor: TokenCursor, read: (cursor: TokenCursor, minimum?: number) => Expression, terminator: ":" | ")"): Parameter[] {
  try {
  cursor.meter?.checkpoint(1,96);
  const parameters: Parameter[] = [];
  const names = new Set<string>();
  let slash = false;
  let keywordOnly = false;
  let positionalDefault = false;
  let bareStar = false;
  let keywordCount = 0;
  let finished = false;
  while (cursor.peek().text !== terminator) {
    if (finished) throw cursor.error("arguments cannot follow var-keyword argument");
    const first = cursor.peek();
    if (first.text === "/") {
      if (slash || keywordOnly || parameters.length === 0) throw cursor.error("invalid positional-only separator");
      cursor.take();
      slash = true;
      for (let i = 0; i < parameters.length; i++) {cursor.meter?.checkpoint(1,80);parameters[i] = { ...parameters[i], kind: "positional-only" };}
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
      const bindingName = normalizeNfkc(name.text,cursor.meter);
      if (bindingName === "__debug__") throw cursor.error("cannot assign to __debug__");
      cursor.meter?.checkpoint(1+bindingName.length);
      if (names.has(bindingName)) throw cursor.error("duplicate argument in function definition");
      cursor.meter?.checkpoint(0,32);
      names.add(bindingName);
      cursor.take();
      let end = name.end;
      let annotation: Parameter["annotation"];
      if (terminator === ")" && cursor.peek().text === ":") {
        cursor.take();
        const starred = kind === "var-positional" && cursor.peek().text === "*";
        const star = starred ? cursor.take() : undefined;
        const expression = read(cursor, starred ? 6 : undefined);
        validateAnnotation(expression, cursor);
        if (star) cursor.meter?.checkpoint(0, 72);
        annotation = star ? { kind: "unpack", value: expression, start: star.start, end: expression.end } : expression;
        end = expression.end;
      }
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
      cursor.meter?.checkpoint(0,96);
      parameters.push({ kind, ...(annotation === undefined ? {} : { annotation }), spelling: name.text, name: bindingName, default: value, start: first.start, end: value?.end ?? end });
    }
    if (cursor.peek().text !== ",") break;
    cursor.take();
  }
  if (bareStar && keywordCount === 0) throw cursor.error("named arguments must follow bare star");
  cursor.expect(terminator);
  return parameters;
  } finally {cursor.meter?.checkpoint();}
}
