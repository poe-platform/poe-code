import { JqError, JqLimitError, wellFormed, type JqLimits, type Json } from "./limits.js";

export type Ast =
  | { kind: "identity" }
  | { kind: "literal"; value: Json }
  | { kind: "variable"; name: string }
  | { kind: "binary"; operator: string; left: Ast; right: Ast }
  | { kind: "unary"; operand: Ast }
  | { kind: "optional"; operand: Ast }
  | { kind: "index"; base: Ast; index: Ast }
  | { kind: "slice"; base: Ast; start: Ast | undefined; end: Ast | undefined }
  | { kind: "iterate"; base: Ast }
  | { kind: "array"; body: Ast | undefined }
  | { kind: "object"; fields: { key: Ast; value: Ast }[] }
  | { kind: "call"; name: string; args: Ast[] }
  | { kind: "if"; condition: Ast; yes: Ast; no: Ast };
interface Token { text: string; offset: number; kind: "symbol" | "name" | "number" | "string" | "end" }
const precedence: Readonly<Record<string, number>> = Object.freeze({
  "|": 1, ",": 2, "=": 3, "|=": 3, "+=": 3, "-=": 3, "*=": 3, "/=": 3, "%=": 3, "//=": 3,
  "//": 4, or: 5, and: 6, "==": 7, "!=": 7, "<": 7, ">": 7, "<=": 7, ">=": 7,
  "+": 8, "-": 8, "*": 9, "/": 9, "%": 9,
});
export const functions: Readonly<Record<string, readonly number[]>> = Object.freeze({
  empty: [0], select: [1], map: [1], map_values: [1], length: [0], keys: [0], keys_unsorted: [0], values: [0],
  type: [0], has: [1], contains: [1], sort: [0], sort_by: [1], unique: [0], unique_by: [1], group_by: [1], add: [0],
  not: [0], reverse: [0], first: [0, 1], last: [0, 1], limit: [2], range: [1, 2, 3], join: [1],
  tostring: [0], tonumber: [0], tojson: [0], fromjson: [0], to_entries: [0], from_entries: [0], with_entries: [1],
  min: [0], max: [0], min_by: [1], max_by: [1], any: [0, 1], all: [0, 1],
  strings: [0], numbers: [0], booleans: [0], arrays: [0], objects: [0], nulls: [0], scalars: [0], iterables: [0],
});
function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let offset = 0;
  while (offset < source.length) {
    const character = source[offset]!;
    if (/\s/u.test(character)) { offset++; continue; }
    if (character === "#") { while (offset < source.length && source[offset] !== "\n") offset++; continue; }
    const start = offset;
    if (character === '"') {
      offset++;
      let escaped = false;
      while (offset < source.length) {
        const current = source[offset++]!;
        if (!escaped && current === '"') break;
        if (!escaped && current === "\\") escaped = true;
        else escaped = false;
      }
      const text = source.slice(start, offset);
      try { if (!wellFormed(JSON.parse(text) as string)) throw new Error(); } catch { throw new JqError(`invalid string at offset ${start}`, 3); }
      tokens.push({ text, offset: start, kind: "string" });
      continue;
    }
    const number = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(source.slice(offset));
    if (number) {
      tokens.push({ text: number[0], offset, kind: "number" }); offset += number[0].length; continue;
    }
    const name = /^[A-Za-z_][A-Za-z_0-9]*/u.exec(source.slice(offset));
    if (name) { tokens.push({ text: name[0], offset, kind: "name" }); offset += name[0].length; continue; }
    const symbol = /^(?:\/\/=|\|=|\+=|-=|\*=|\/=|%=|==|!=|<=|>=|\/\/|[.\[\]{}(),:;?$|+*/%<>=-])/u.exec(source.slice(offset));
    if (!symbol) throw new JqError(`unexpected character at offset ${offset}`, 3);
    tokens.push({ text: symbol[0], offset, kind: "symbol" }); offset += symbol[0].length;
  }
  tokens.push({ text: "", offset, kind: "end" });
  return tokens;
}
function isPath(ast: Ast): boolean {
  const pending = [ast];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.kind === "identity") continue;
    if (node.kind === "index" || node.kind === "iterate") pending.push(node.base);
    else if (node.kind === "binary" && node.operator === ",") pending.push(node.left, node.right);
    else return false;
  }
  return true;
}
export function parse(source: string, variables: ReadonlyMap<string, Json>, limits: JqLimits): Ast {
  if (Buffer.byteLength(source) > limits.maxSourceBytes) throw new JqLimitError("maxSourceBytes");
  const tokens = tokenize(source);
  let position = 0;
  let nesting = 0;
  const peek = (): Token => tokens[Math.min(position, tokens.length - 1)]!;
  const take = (): Token => { const token = peek(); if (token.kind !== "end") position++; return token; };
  const accept = (text: string): boolean => { if (peek().text !== text) return false; take(); return true; };
  const fail = (message: string): never => { throw new JqError(`${message} at offset ${peek().offset}`, 3); };
  const expect = (text: string): void => { if (!accept(text)) fail(`expected '${text}'`); };
  const literal = (value: Json): Ast => ({ kind: "literal", value });
  const conditional = (): Ast => {
    const condition = expression(); expect("then");
    const yes = expression();
    if (accept("elif")) return { kind: "if", condition, yes, no: guardedConditional() };
    expect("else"); const no = expression(); expect("end");
    return { kind: "if", condition, yes, no };
  };
  const guardedConditional = (): Ast => {
    if (++nesting > limits.maxAstDepth) throw new JqLimitError("maxAstDepth");
    try { return conditional(); } finally { nesting--; }
  };
  const expression = (minimum = 0, stopComma = false): Ast => {
    if (++nesting > limits.maxAstDepth) throw new JqLimitError("maxAstDepth");
    try {
      let left = primary();
      while (true) {
        const operator = peek().text;
        const priority = Object.hasOwn(precedence, operator) ? precedence[operator]! : -1;
        if (priority < minimum || (stopComma && operator === ",")) break;
        take();
        const assignment = priority === 3;
        if (assignment && !isPath(left)) fail("unsupported assignment path");
        const right = expression(priority + (assignment ? 0 : 1), stopComma);
        left = { kind: "binary", operator, left, right };
      }
      return left;
    } finally { nesting--; }
  };
  const primary = (): Ast => {
    const token = take();
    let result: Ast;
    if (token.text === ".") {
      result = { kind: "identity" };
      if ((peek().kind === "name" && peek().offset === token.offset + 1) || peek().kind === "string") {
        const key = take(); result = { kind: "index", base: result, index: literal(key.kind === "string" ? JSON.parse(key.text) as string : key.text) };
      }
    } else if (token.text === "(") { result = expression(); expect(")"); }
    else if (token.text === "[") {
      result = { kind: "array", body: peek().text === "]" ? undefined : expression() }; expect("]");
    } else if (token.text === "{") {
      const fields: { key: Ast; value: Ast }[] = [];
      if (peek().text !== "}") do {
        const keyToken = take();
        let key: Ast;
        if (keyToken.text === "(") { key = expression(); expect(")"); }
        else if (keyToken.kind === "string" || keyToken.kind === "name") key = literal(keyToken.kind === "string" ? JSON.parse(keyToken.text) as string : keyToken.text);
        else fail("expected object key");
        const value = accept(":") ? expression(0, true) : key!.kind === "literal" ? { kind: "index" as const, base: { kind: "identity" as const }, index: key! } : fail("expected ':'");
        fields.push({ key: key!, value });
      } while (accept(","));
      expect("}"); result = { kind: "object", fields };
    } else if (token.text === "$") {
      const name = take(); if (name.kind !== "name") fail("expected variable name");
      if (!variables.has(name.text)) fail(`undefined variable $${name.text}`);
      result = { kind: "variable", name: name.text };
    } else if (token.text === "-") result = { kind: "unary", operand: expression(10) };
    else if (token.text === "if") result = guardedConditional();
    else if (token.kind === "string") result = literal(JSON.parse(token.text) as string);
    else if (token.kind === "number") {
      const value = Number(token.text); if (!Number.isFinite(value)) fail("nonfinite numeric literal"); result = literal(value);
    } else if (["true", "false", "null"].includes(token.text)) result = literal(JSON.parse(token.text) as Json);
    else if (token.kind === "name") {
      const args: Ast[] = [];
      if (accept("(")) { if (peek().text !== ")") do { args.push(expression()); } while (accept(";")); expect(")"); }
      if (!Object.hasOwn(functions, token.text) || !functions[token.text]!.includes(args.length)) fail(`unsupported function ${token.text}/${args.length}`);
      result = { kind: "call", name: token.text, args };
    } else fail("expected filter");
    while (true) {
      if (accept("?")) result = { kind: "optional", operand: result! };
      else if (accept(".")) {
        const key = take(); if (key.kind !== "name" && key.kind !== "string") fail("expected property name");
        result = { kind: "index", base: result!, index: literal(key.kind === "string" ? JSON.parse(key.text) as string : key.text) };
      } else if (accept("[")) {
        if (accept("]")) result = { kind: "iterate", base: result! };
        else {
          const start = peek().text === ":" ? undefined : expression();
          if (accept(":")) {
            const end = peek().text === "]" ? undefined : expression(); expect("]");
            result = { kind: "slice", base: result!, start, end };
          } else { expect("]"); result = { kind: "index", base: result!, index: start! }; }
        }
      } else break;
    }
    return result!;
  };
  const ast = expression();
  if (peek().kind !== "end") fail("unexpected token");
  const pending: { node: Ast; depth: number }[] = [{ node: ast, depth: 1 }];
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (depth > limits.maxAstDepth) throw new JqLimitError("maxAstDepth");
    const children: Ast[] = [];
    if (node.kind === "binary") children.push(node.left, node.right);
    else if (node.kind === "unary" || node.kind === "optional") children.push(node.operand);
    else if (node.kind === "index") children.push(node.base, node.index);
    else if (node.kind === "iterate") children.push(node.base);
    else if (node.kind === "slice") { children.push(node.base); if (node.start) children.push(node.start); if (node.end) children.push(node.end); }
    else if (node.kind === "array" && node.body) children.push(node.body);
    else if (node.kind === "object") for (const field of node.fields) children.push(field.key, field.value);
    else if (node.kind === "call") children.push(...node.args);
    else if (node.kind === "if") children.push(node.condition, node.yes, node.no);
    for (const child of children) pending.push({ node: child, depth: depth + 1 });
  }
  return ast;
}
