import type { Expression, TypeParameter } from "./ast.js";
import { validateExpressionContext } from "./expression-context.js";
import type { TokenCursor } from "./token-cursor.js";
import { readExpression } from "./expression.js";
import { validateExpression } from "./expression-validation.js";
import { reservedWords } from "./keywords.js";
import { normalizeNfkc } from "./normalization.js";

/** Retain type expressions while validating annotation-scope syntax. */
export function readTypeParameters(cursor: TokenCursor): TypeParameter[] {
  try {
  cursor.meter?.checkpoint(1,64);
  cursor.expect("[");
  cursor.meter?.checkpoint(0, 32);
  const parameters: TypeParameter[] = [];
  const names = new Set<string>();
  let defaultSeen = false;
  for (;;) {
    const start = cursor.peek().start;
    let prefix = "";
    if (cursor.peek().text === "*" || cursor.peek().text === "**") prefix = cursor.take().text;
    const token = cursor.peek();
    if (token.kind !== "name" || reservedWords.has(token.text)) throw cursor.error("expected type parameter name");
    const name = normalizeNfkc(token.text,cursor.meter);
    if (name === "__debug__") throw cursor.error("cannot assign to __debug__");
    cursor.meter?.checkpoint(1+name.length);
    if (names.has(name)) {
      cursor.meter?.checkpoint(0,96+2*name.length);
      throw cursor.error(`duplicate type parameter '${name}'`);
    }
    cursor.meter?.checkpoint(0,32);
    names.add(name);
    cursor.take();
    let bound: Expression | null = null;
    let defaultValue: TypeParameter["default"] = null;
    if (cursor.peek().text === ":") {
      if (prefix) throw cursor.error("variadic type parameters cannot have bounds");
      cursor.take();
      bound = readExpression(cursor);
      validateExpression(bound, cursor.filename, {iterations:new Set(), iterable:false, target:false, assignments:null,
        typeScope:bound.kind === "tuple" ? "TypeVar constraint" : "TypeVar bound"}, cursor.meter);
  validateExpressionContext(bound, {kind:"function", generator:false}, cursor.filename, undefined, cursor.meter);
    }
    if (cursor.peek().text === "=") {
      cursor.take();
      defaultSeen = true;
      const starred = prefix === "*" && cursor.peek().text === "*";
      const star = starred ? cursor.take() : undefined;
      const value = readExpression(cursor, starred ? 6 : undefined);
      if (star) cursor.meter?.checkpoint(0, 72);
      defaultValue = star ? { kind: "unpack", value, start: star.start, end: value.end } : value;
      validateExpression(value, cursor.filename, {iterations:new Set(), iterable:false, target:false, assignments:null,
        typeScope:prefix === "*" ? "TypeVarTuple default" : prefix === "**" ? "ParamSpec default" : "TypeVar default"}, cursor.meter);
  validateExpressionContext(value, {kind:"function", generator:false}, cursor.filename, undefined, cursor.meter);
    } else if (defaultSeen) {
      cursor.meter?.checkpoint(0,160+2*name.length);
      throw cursor.error(`non-default type parameter '${name}' follows default type parameter`);
    }
    cursor.meter?.checkpoint(0, 128);
    parameters.push({ name, spelling: token.text,
      kind: prefix === "*" ? "type-var-tuple" : prefix === "**" ? "param-spec" : "type-var",
      bound, default: defaultValue, start, end: defaultValue?.end ?? bound?.end ?? token.end });
    if (cursor.peek().text !== ",") break;
    cursor.take();
    if (cursor.peek().text === "]") break;
  }
  cursor.expect("]");
  return parameters;
  } finally {cursor.meter?.checkpoint();}
}
