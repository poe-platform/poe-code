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
import { PythonSource, PythonSyntaxError } from "./source.js";
import { PythonIndentationError } from "./indentation.js";

const binaryPrecedence: Readonly<Record<string, number>> = {
  or: 2, and: 3, "|": 6, "^": 7, "&": 8, "<<": 9, ">>": 9,
  "+": 10, "-": 10, "*": 11, "@": 11, "/": 11, "//": 11, "%": 11, "**": 13
};
const comparisons = new Set(["<", "<=", ">", ">=", "==", "!=", "<>", "in", "is", "not"]);

/** Parse a standalone expression, including comma-separated tuple forms. */
export function parseExpression(text: string, options: LexerOptions = {}): Expression {
  let cursor: TokenCursor | undefined;
  try {
    cursor = createTokenCursor(text, options, "eval");
    if (cursor.peek().kind === "end") {
      // An empty eval grammar reports the last physical line the tokenizer
      // read, not the end marker's next line or an implicit final newline.
      const source = new PythonSource(text, options.filename, options.meter);
      let line = 0, offset = source.position.offset, atStart = true, diagnostic = "";
      let whitespace = true, indentation = 0;
      while (!source.done) {
        if (atStart) {
          line++;
          offset = source.position.offset;
          diagnostic = "";
          whitespace = true;
          indentation = 0;
        }
        const character = source.advance();
        options.meter?.checkpoint(1, 4);
        diagnostic += character;
        if (character === "\f") indentation = 0;
        else if (character === " " || character === "\t") indentation++;
        else whitespace = false;
        atStart = character === "\n";
      }
      options.meter?.checkpoint(1, 320);
      // An unterminated whitespace line can still produce an INDENT token
      // in eval mode. A formfeed resets indentation, just as in the lexer.
      if (whitespace && indentation > 0) {
        throw new PythonIndentationError("unexpected indent", cursor.filename,
          {offset, line, column: diagnostic.length - 1}, {offset, line, column: -2})
          .withSourceLine(diagnostic, options.meter);
      }
      const position = {offset, line, column: -1};
      throw new PythonSyntaxError("invalid syntax", cursor.filename, position, position).withSourceLine(diagnostic, options.meter);
    }
    let result = readExpression(cursor);
    if (cursor.peek().text === ",") {
      cursor.meter?.checkpoint(0,104);
      const items = [result];
      let end = result.end;
      while (cursor.peek().text === ",") {
        end = cursor.take().end;
        if (cursor.peek().kind === "newline" || cursor.peek().kind === "end") break;
        const item = readExpression(cursor);
        cursor.meter?.checkpoint(0,8);
        items.push(item);
        end = item.end;
      }
      result = { kind: "tuple", items, start: result.start, end };
    }
    while (cursor.peek().kind === "newline") cursor.take();
    if (cursor.peek().kind !== "end") {
      const token = cursor.peek();
      cursor.meter?.checkpoint(0, 192);
      // Eval input keeps its physical final line. The lexer's structural
      // newline must not become source text in the parser's diagnostic.
      throw new PythonSyntaxError("invalid syntax", cursor.filename, token.start, token.end)
        .withSource(text, false, cursor.meter);
    }
    validateExpression(result, options.filename,undefined,options.meter);
    return result;
  } catch (error) {
    const failure = error instanceof PythonSyntaxError && cursor !== undefined ? cursor.finishSyntaxError(error) : error;
    if (failure instanceof PythonSyntaxError) failure.withSource(text,false,options.meter);
    throw failure;
  } finally {options.meter?.checkpoint();}
}

/** Shared Pratt reader for expression-bearing grammar productions. */
export function readExpression(cursor: TokenCursor, minimum = 0): Expression {
  let restore:(()=>void)|undefined;
  try {
  cursor.meter?.checkpoint();
  restore=cursor.enterRecursiveCall?.();
  let left = readPrefix(cursor, minimum);
  while (true) {
    const token = cursor.peek();
    if (token.kind !== "operator" && token.kind !== "name") break;
    if (token.text === "if" && minimum <= 1) {
      cursor.take();
      const condition = readExpression(cursor, 2);
      cursor.expect("else");
      if (cursor.peek().kind === "newline") throw cursor.newlineError("expected expression after 'else', but statement is given", true);
      const alternate = readExpression(cursor, 1);
      cursor.meter?.checkpoint(0,96);
      left = { kind: "conditional", condition, consequent: left, alternate, start: left.start, end: alternate.end };
      continue;
    }
    if (comparisons.has(token.text) && minimum <= 5) {
      cursor.meter?.checkpoint(0,144);
      const operands = [left];
      const operators: string[] = [];
      while (comparisons.has(cursor.peek().text)) {
        const spelling = cursor.peek().text;
        if ((spelling === "!=" || spelling === "<>") && (spelling === "<>") !== cursor.futureFeatures.has("barry_as_FLUFL")) throw cursor.error("invalid inequality spelling for active future features");
        let operator = cursor.take().text;
        if (operator === "<>") operator = "!=";
        if (operator === "not") { cursor.expect("in"); operator = "not in"; }
        else if (operator === "is" && cursor.peek().text === "not") { cursor.take(); operator = "is not"; }
        cursor.meter?.checkpoint(0,16);operators.push(operator);
        operands.push(readExpression(cursor, 6));
      }
      left = { kind: "comparison", operands, operators, start: left.start, end: operands[operands.length - 1].end };
      continue;
    }
    const precedence = Object.hasOwn(binaryPrecedence, token.text) ? binaryPrecedence[token.text] : undefined;
    if (precedence === undefined || precedence < minimum) break;
    cursor.take();
    const right = readExpression(cursor, token.text === "**" ? 12 : precedence + 1);
    cursor.meter?.checkpoint(0,96);
    left = {
      kind: token.text === "and" || token.text === "or" ? "boolean" : "binary",
      operator: token.text, left, right, start: left.start, end: right.end
    };
  }
  return left;
  } finally {try{restore?.();}finally{cursor.meter?.checkpoint();}}
}

function readPrefix(cursor: TokenCursor, minimum: number): Expression {
  const token = cursor.peek();
  if (token.text === "lambda" && minimum <= 1) return readLambda(cursor, readExpression);
  if (token.text === "await") {
    cursor.take();
    const value = readTrailers(cursor, readAtom(cursor), readExpression);
    cursor.meter?.checkpoint(0,64);
    return { kind: "await", value, start: token.start, end: value.end };
  }
  if ((token.text === "not" && minimum <= 4) || token.text === "+" || token.text === "-" || token.text === "~") {
    cursor.take();
    const operand = readExpression(cursor, token.text === "not" ? 4 : 12);
    cursor.meter?.checkpoint(0,80);
    return { kind: "unary", operator: token.text, operand, start: token.start, end: operand.end };
  }
  return readTrailers(cursor, readAtom(cursor), readExpression);
}

function readAtom(cursor: TokenCursor): Expression {
  const token = cursor.peek();
  if (token.kind === "string" || token.kind === "bytes" || token.kind === "fstring-start" || token.kind === "tstring-start") return readStringExpression(cursor, readExpression);
  if (token.text === "(" || token.text === "[" || token.text === "{") return readDisplay(cursor, readExpression);
  if (token.kind === "integer" || token.kind === "float" || token.kind === "imaginary") {
    cursor.take();
    cursor.meter?.checkpoint(0,80);
    return { kind: "literal", literalKind: token.kind, value: token.value, start: token.start, end: token.end };
  }
  if (token.text === "True" || token.text === "False" || token.text === "None" || token.text === "...") {
    cursor.take();
    cursor.meter?.checkpoint(0,80);
    return {
      kind: "literal", literalKind: token.text === "None" ? "none" : token.text === "..." ? "ellipsis" : "boolean",
      value: token.text === "None" || token.text === "..." ? null : token.text === "True", start: token.start, end: token.end
    };
  }
  if (token.kind === "name" && !reservedWords.has(token.text)) {
    cursor.take();
    cursor.meter?.checkpoint(0,80);
    return { kind: "name", spelling: token.text, name: normalizeNfkc(token.text,cursor.meter), start: token.start, end: token.end };
  }
  if (token.kind === "newline") throw cursor.newlineError();
  throw cursor.error("expected expression");
}
