import type { DeclaredName, ImportItem, Statement } from "./statement-ast.js";
import type { TokenCursor } from "./token-cursor.js";
import { reservedWords } from "./keywords.js";
import { normalizeNfkc } from "./normalization.js";
import { isFutureImport } from "./future-imports.js";

/** Import parsing records requests only; module loading belongs to the runtime. */
export function readImportStatement(cursor: TokenCursor): Statement {
  try {
  cursor.meter?.checkpoint(1,128);
  const opening = cursor.take();
  const from = opening.text === "from";
  let level = 0;
  let module: DeclaredName[] = [];
  if (from) {
    while (cursor.peek().text === "." || cursor.peek().text === "...") level += cursor.take().text.length;
    if (level === 0 || cursor.peek().text !== "import") module = readPath(cursor);
    cursor.expect("import");
    if (cursor.peek().text === "*") {
      return { kind: "import-from", module, level, imports: "*", start: opening.start, end: cursor.take().end };
    }
  }
  const parenthesized = from && cursor.peek().text === "(";
  if (parenthesized) cursor.take();
  cursor.meter?.checkpoint(0,32);
  const imports: ImportItem[] = [];
  for (;;) {
    if(from)cursor.meter?.checkpoint(0,40);
    const path = from ? [readName(cursor)] : readPath(cursor);
    let alias: DeclaredName | null = null;
    if (cursor.peek().text === "as") { cursor.take(); alias = readName(cursor); }
    if ((alias ?? path[0]).name === "__debug__") throw cursor.error("cannot assign to __debug__");
    cursor.meter?.checkpoint(1,72);
    imports.push({ path, alias, start: path[0].start, end: alias?.end ?? path[path.length - 1].end });
    if (cursor.peek().text !== ",") break;
    cursor.take();
    if (parenthesized && cursor.peek().text === ")") break;
  }
  const end = parenthesized ? cursor.expect(")").end : imports[imports.length - 1].end;
  const statement: Statement = from
    ? { kind: "import-from", module, level, imports, start: opening.start, end }
    : { kind: "import", imports, start: opening.start, end };
  if (isFutureImport(statement)) for (const item of imports) {
    const name=item.path[0]!.name;
    cursor.meter?.checkpoint(1+name.length);
    if(!cursor.futureFeatures.has(name))cursor.meter?.checkpoint(0,32);
    cursor.futureFeatures.add(name);
  }
  return statement;
  } finally {cursor.meter?.checkpoint();}
}

function readPath(cursor: TokenCursor): DeclaredName[] {
  cursor.meter?.checkpoint(1,40);
  const path = [readName(cursor)];
  while (cursor.peek().text === ".") { cursor.take(); cursor.meter?.checkpoint(1,8);path.push(readName(cursor)); }
  return path;
}

function readName(cursor: TokenCursor): DeclaredName {
  cursor.meter?.checkpoint(1,64);
  const token = cursor.peek();
  if (token.kind !== "name" || reservedWords.has(token.text)) throw cursor.error("expected import name");
  cursor.take();
  return { spelling: token.text, name: normalizeNfkc(token.text,cursor.meter), start: token.start, end: token.end };
}
