import type { LexerOptions } from "./lexer.js";
import type { Expression } from "./ast.js";
import { createTokenCursor } from "./token-cursor.js";
import type { TokenCursor } from "./token-cursor.js";
import { readTrailers } from "./primary.js";
import { reservedWords } from "./keywords.js";
import { readDisplay } from "./displays.js";
import { readLambda } from "./lambda.js";
import { validateExpression } from "./expression-validation.js";
import { readStringExpression } from "./string-expressions.js";
import { normalizeNfkc } from "./normalization.js";
import { PythonSyntaxError } from "./source.js";

const binaryPrecedence: Readonly<Record<string, number>> = {
  or: 2, and: 3, "|": 6, "^": 7, "&": 8, "<<": 9, ">>": 9,
  "+": 10, "-": 10, "*": 11, "@": 11, "/": 11, "//": 11, "%": 11, "**": 13
};
const comparisons = new Set(["<", "<=", ">", ">=", "==", "!=", "<>", "in", "is", "not"]);

/** Parse a single expression. Statement grammar and additional expression forms are still being implemented. */
export function parseExpression(text: string, options: LexerOptions = {}): Expression {
  try {
    const cursor = createTokenCursor(text, options);
    let result = readExpression(cursor);
    if (cursor.peek().text === ",") {
      const items = [result];
      let end = result.end;
      while (cursor.peek().text === ",") {
        end = cursor.take().end;
        if (cursor.peek().kind === "newline" || cursor.peek().kind === "end") break;
        const item = readExpression(cursor);
        items.push(item);
        end = item.end;
      }
      result = { kind: "tuple", items, start: result.start, end };
    }
    while (cursor.peek().kind === "newline") cursor.take();
    if (cursor.peek().kind !== "end") throw cursor.error("unexpected token after expression");
    validateExpression(result, options.filename,undefined,options.meter);
    return result;
  } catch (error) {
    if (error instanceof PythonSyntaxError) error.withSource(text,false,options.meter);
    throw error;
  } finally {options.meter?.checkpoint();}
}

/** Shared Pratt reader for expression-bearing grammar productions. */
export function readExpression(cursor: TokenCursor, minimum = 0): Expression {
  const restore=cursor.enterRecursiveCall?.();
  try {
  let left = readPrefix(cursor, minimum);
  while (true) {
    const token = cursor.peek();
    if (token.kind !== "operator" && token.kind !== "name") break;
    if (token.text === "if" && minimum <= 1) {
      cursor.take();
      const condition = readExpression(cursor, 2);
      cursor.expect("else");
      const alternate = readExpression(cursor, 1);
      left = { kind: "conditional", condition, consequent: left, alternate, start: left.start, end: alternate.end };
      continue;
    }
    if (comparisons.has(token.text) && minimum <= 5) {
      const operands = [left];
      const operators: string[] = [];
      while (comparisons.has(cursor.peek().text)) {
        const spelling = cursor.peek().text;
        if ((spelling === "!=" || spelling === "<>") && (spelling === "<>") !== cursor.futureFeatures.has("barry_as_FLUFL")) throw cursor.error("invalid inequality spelling for active future features");
        let operator = cursor.take().text;
        if (operator === "<>") operator = "!=";
        if (operator === "not") { cursor.expect("in"); operator = "not in"; }
        else if (operator === "is" && cursor.peek().text === "not") { cursor.take(); operator = "is not"; }
        operators.push(operator);
        operands.push(readExpression(cursor, 6));
      }
      left = { kind: "comparison", operands, operators, start: left.start, end: operands[operands.length - 1].end };
      continue;
    }
    const precedence = Object.hasOwn(binaryPrecedence, token.text) ? binaryPrecedence[token.text] : undefined;
    if (precedence === undefined || precedence < minimum) break;
    cursor.take();
    const right = readExpression(cursor, token.text === "**" ? 12 : precedence + 1);
    left = {
      kind: token.text === "and" || token.text === "or" ? "boolean" : "binary",
      operator: token.text, left, right, start: left.start, end: right.end
    };
  }
  return left;
  } finally {restore?.();}
}

function readPrefix(cursor: TokenCursor, minimum: number): Expression {
  const token = cursor.peek();
  if (token.text === "lambda" && minimum <= 1) return readLambda(cursor, readExpression);
  if (token.text === "await") {
    cursor.take();
    const value = readTrailers(cursor, readAtom(cursor), readExpression);
    return { kind: "await", value, start: token.start, end: value.end };
  }
  if ((token.text === "not" && minimum <= 4) || ["+", "-", "~"].includes(token.text)) {
    cursor.take();
    const operand = readExpression(cursor, token.text === "not" ? 4 : 12);
    return { kind: "unary", operator: token.text, operand, start: token.start, end: operand.end };
  }
  return readTrailers(cursor, readAtom(cursor), readExpression);
}

function readAtom(cursor: TokenCursor): Expression {
  const token = cursor.peek();
  if (token.kind === "string" || token.kind === "bytes" || token.kind === "fstring-start" || token.kind === "tstring-start") return readStringExpression(cursor, readExpression);
  if (["(", "[", "{"].includes(token.text)) return readDisplay(cursor, readExpression);
  if (token.kind === "integer" || token.kind === "float" || token.kind === "imaginary") {
    cursor.take();
    return { kind: "literal", literalKind: token.kind, value: token.value, start: token.start, end: token.end };
  }
  if (token.text === "True" || token.text === "False" || token.text === "None" || token.text === "...") {
    cursor.take();
    return {
      kind: "literal", literalKind: token.text === "None" ? "none" : token.text === "..." ? "ellipsis" : "boolean",
      value: token.text === "None" || token.text === "..." ? null : token.text === "True", start: token.start, end: token.end
    };
  }
  if (token.kind === "name" && !reservedWords.has(token.text)) {
    cursor.take();
    return { kind: "name", spelling: token.text, name: normalizeNfkc(token.text,cursor.meter), start: token.start, end: token.end };
  }
  throw cursor.error("expected expression");
}
