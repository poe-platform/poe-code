import type { ConditionalBranch, Statement } from "./statement-ast.js";
import type { TokenCursor } from "./token-cursor.js";
import { readExpression } from "./expression.js";
import { readNamedExpression } from "./named-expression.js";
import { readSimpleStatement } from "./simple-statements.js";
import { readLoopTarget } from "./targets.js";
import { readStatementValue } from "./assignment-statements.js";
import { readTry } from "./try-statements.js";
import { readWith } from "./with-statements.js";
import { readFunction } from "./function-statements.js";
import { readClass } from "./class-statements.js";

/** A block owns its statements; its caller owns the terminating dedent. */
export function readStatements(cursor: TokenCursor): Statement[] {
  const body: Statement[] = [];
  while (cursor.peek().kind !== "end" && cursor.peek().kind !== "dedent") {
    if (cursor.peek().kind === "newline") { cursor.take(); continue; }
    if (cursor.peek().text === "if" || cursor.peek().text === "while") body.push(readConditional(cursor));
    else if (cursor.peek().text === "async") {
      const start = cursor.take().start;
      if (cursor.peek().text === "with") body.push(readWith(cursor, readSuite, start));
      else if (cursor.peek().text === "def") body.push(readFunction(cursor, readSuite, start));
      else body.push(readFor(cursor, start));
    }
    else if (cursor.peek().text === "for") body.push(readFor(cursor));
    else if (cursor.peek().text === "with") body.push(readWith(cursor, readSuite));
    else if (cursor.peek().text === "try") body.push(readTry(cursor, readSuite));
    else if (cursor.peek().text === "def") body.push(readFunction(cursor, readSuite));
    else if (cursor.peek().text === "class") body.push(readClass(cursor, readSuite));
    else if (cursor.peek().text === "@") {
      const decorators = [];
      while (cursor.peek().text === "@") {
        cursor.take();
        decorators.push(readNamedExpression(cursor, readExpression));
        if (cursor.peek().kind !== "newline") throw cursor.error("expected newline after decorator");
        cursor.take();
      }
      if (cursor.peek().text === "class") body.push(readClass(cursor, readSuite, decorators));
      else {
        const asyncStart = cursor.peek().text === "async" ? cursor.take().start : undefined;
        body.push(readFunction(cursor, readSuite, asyncStart, decorators));
      }
    }
    else for (const statement of readSimpleLine(cursor)) body.push(statement);
  }
  return body;
}

function readSimpleLine(cursor: TokenCursor): Statement[] {
  const body = [readSimpleStatement(cursor)];
  while (cursor.peek().text === ";") {
    cursor.take();
    if (cursor.peek().kind === "newline" || cursor.peek().kind === "end") break;
    body.push(readSimpleStatement(cursor));
  }
  if (cursor.peek().kind === "newline") cursor.take();
  else if (cursor.peek().kind !== "end") throw cursor.error("expected newline or ';'");
  return body;
}

function readSuite(cursor: TokenCursor): Statement[] {
  cursor.expect(":");
  if (cursor.peek().kind !== "newline") return readSimpleLine(cursor);
  cursor.take();
  if (cursor.peek().kind !== "indent") throw cursor.error("expected an indented block");
  cursor.take();
  const body = readStatements(cursor);
  if (body.length === 0 || cursor.peek().kind !== "dedent") throw cursor.error("expected an indented block");
  cursor.take();
  return body;
}

function readConditional(cursor: TokenCursor): Statement {
  const opening = cursor.take();
  const condition = readNamedExpression(cursor, readExpression);
  const body = readSuite(cursor);
  const branches: ConditionalBranch[] = [{ condition, body }];
  if (opening.text === "if") {
    while (cursor.peek().text === "elif") {
      cursor.take();
      const condition = readNamedExpression(cursor, readExpression);
      branches.push({ condition, body: readSuite(cursor) });
    }
  }
  let otherwise: Statement[] = [];
  if (cursor.peek().text === "else") { cursor.take(); otherwise = readSuite(cursor); }
  const finalBody = otherwise.length ? otherwise : branches[branches.length - 1]!.body;
  const span = { start: opening.start, end: finalBody[finalBody.length - 1]!.end };
  return opening.text === "if"
    ? { kind: "if", branches, otherwise, ...span }
    : { kind: "while", condition, body, otherwise, ...span };
}

function readFor(cursor: TokenCursor, asyncStart?: Statement["start"]): Statement {
  const start = asyncStart ?? cursor.peek().start;
  const async = asyncStart !== undefined;
  cursor.expect("for");
  const target = readLoopTarget(cursor, readExpression);
  cursor.expect("in");
  if (cursor.peek().text === "yield") throw cursor.error("expected iterable expression");
  const iterable = readStatementValue(cursor);
  const body = readSuite(cursor);
  let otherwise: Statement[] = [];
  if (cursor.peek().text === "else") { cursor.take(); otherwise = readSuite(cursor); }
  const finalBody = otherwise.length ? otherwise : body;
  return { kind: "for", async, target, iterable, body, otherwise, start, end: finalBody[finalBody.length - 1]!.end };
}
