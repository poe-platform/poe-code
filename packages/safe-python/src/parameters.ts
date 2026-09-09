import type { Expression, Parameter } from "./ast.js";
import { reservedWords } from "./keywords.js";
import type { TokenCursor } from "./token-cursor.js";
import { normalizeNfkc } from "./normalization.js";

export function readParameters(cursor: TokenCursor, read: (cursor: TokenCursor, minimum?: number) => Expression, terminator: ":" | ")"): Parameter[] {
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
      const bindingName = normalizeNfkc(name.text);
      if (bindingName === "__debug__") throw cursor.error("cannot assign to __debug__");
      if (names.has(bindingName)) throw cursor.error("duplicate argument in function definition");
      names.add(bindingName);
      cursor.take();
      let end = name.end;
      if (terminator === ")" && cursor.peek().text === ":") {
        cursor.take();
        const starred = kind === "var-positional" && cursor.peek().text === "*";
        if (starred) cursor.take();
        end = read(cursor, starred ? 6 : undefined).end;
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
      parameters.push({ kind, spelling: name.text, name: bindingName, default: value, start: first.start, end: value?.end ?? end });
    }
    if (cursor.peek().text !== ",") break;
    cursor.take();
  }
  if (bareStar && keywordCount === 0) throw cursor.error("named arguments must follow bare star");
  cursor.expect(terminator);
  return parameters;
}
