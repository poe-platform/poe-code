import type { ConditionalBranch, Statement } from "./statement-ast.js";
import type { TokenCursor } from "./token-cursor.js";
import { readExpression } from "./expression.js";
import { readNamedExpression } from "./named-expression.js";
import { readSimpleStatement } from "./simple-statements.js";

/** A block owns its statements; its caller owns the terminating dedent. */
export function readStatements(cursor: TokenCursor): Statement[] {
  const body: Statement[] = [];
  while (cursor.peek().kind !== "end" && cursor.peek().kind !== "dedent") {
    if (cursor.peek().kind === "newline") { cursor.take(); continue; }
    if (cursor.peek().text === "if" || cursor.peek().text === "while") body.push(readConditional(cursor));
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
