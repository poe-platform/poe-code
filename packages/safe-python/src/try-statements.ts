import type { Expression } from "./ast.js";
import type { DeclaredName, ExceptionHandler, Statement } from "./statement-ast.js";
import type { TokenCursor } from "./token-cursor.js";
import { readExpression } from "./expression.js";
import { reservedWords } from "./keywords.js";
import { normalizeNfkc } from "./normalization.js";

export function readTry(cursor: TokenCursor, readSuite: (cursor: TokenCursor) => Statement[]): Statement {
  try {
  cursor.meter?.checkpoint(1,224);
  const start = cursor.expect("try").start;
  const body = readSuite(cursor);
  const handlers: ExceptionHandler[] = [];
  let group = false;
  let bare = false;
  while (cursor.peek().text === "except") {
    if (bare) throw cursor.error("default 'except:' must be last");
    const start = cursor.take().start;
    const starred = cursor.peek().text === "*";
    if (starred) cursor.take();
    if (handlers.length && starred !== group) throw cursor.error("cannot mix 'except' and 'except*'");
    group = starred;
    let exception: Expression | null = null;
    let alias: DeclaredName | null = null;
    if (cursor.peek().text === ":") {
      if (group) throw cursor.error("expected one or more exception types");
      bare = true;
    } else {
      exception = readExpression(cursor);
      if (cursor.peek().text === ",") {
        cursor.meter?.checkpoint(0,104);
        const items = [exception];
        let end = exception.end;
        while (cursor.peek().text === ",") {
          end = cursor.take().end;
          if (cursor.peek().text === ":") break;
          cursor.meter?.checkpoint(0,8);
          items.push(readExpression(cursor));
          end = items[items.length - 1]!.end;
        }
        exception = { kind: "tuple", items, start: exception.start, end };
        if (cursor.peek().text === "as") throw cursor.error("multiple exception types must be parenthesized when using 'as'");
      }
      if (cursor.peek().text === "as") {
        cursor.take();
        const token = cursor.peek();
        if (token.kind !== "name" || reservedWords.has(token.text)) throw cursor.error("expected exception alias");
        const name = normalizeNfkc(token.text,cursor.meter);
        if (name === "__debug__") throw cursor.error("cannot assign to __debug__");
        cursor.take();
        cursor.meter?.checkpoint(0,64);
        alias = { name, spelling: token.text, start: token.start, end: token.end };
      }
    }
    const handlerBody = readSuite(cursor);
    cursor.meter?.checkpoint(1,88);
    handlers.push({ exception, alias, body: handlerBody, start, end: handlerBody[handlerBody.length - 1]!.end });
  }
  let otherwise: Statement[] = [];
  let finalizer: Statement[] = [];
  if (handlers.length && cursor.peek().text === "else") { cursor.take(); otherwise = readSuite(cursor); }
  if (cursor.peek().text === "finally") { cursor.take(); finalizer = readSuite(cursor); }
  if (!handlers.length && !finalizer.length) throw cursor.error("expected 'except' or 'finally'");
  const lastBody = finalizer.length ? finalizer : otherwise.length ? otherwise : handlers[handlers.length - 1]!.body;
  return { kind: "try", group, body, handlers, otherwise, finalizer, start, end: lastBody[lastBody.length - 1]!.end };
  } finally {cursor.meter?.checkpoint();}
}
