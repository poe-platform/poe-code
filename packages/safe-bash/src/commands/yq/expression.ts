import { MikeError } from "./native-work.js";

export type Expression =
  | { kind: "identity" | "iterate" | "recursive" }
  | { kind: "literal"; value: string | boolean | bigint | number | null }
  | { kind: "group"; body: Expression }
  | { kind: "field"; base: Expression; key: Expression }
  | { kind: "slice"; base: Expression; start: Expression; end: Expression }
  | { kind: "pipe" | "binary"; operator: string; left: Expression; right: Expression }
  | { kind: "call"; name: string; args: Expression[] }
  | { kind: "array"; body?: Expression }
  | { kind: "object"; fields: { key: Expression; value: Expression }[] };

interface Token { text: string; offset: number; kind: "symbol" | "string" | "number" | "name" | "end" }
const priorities: Readonly<Record<string, number>> = { "|": 1, ",": 2, "=": 3, "=c": 3, "|=": 3, "+=": 3, "-=": 3, "*=": 3, "/=": 3, "//": 4, or: 5, and: 6, "==": 7, "!=": 7, ">": 7, "<": 7, ">=": 7, "<=": 7, "+": 8, "-": 8, "*": 9, "/": 9, "%": 9 };
const functions = new Set(["select", "map", "has", "length", "keys", "tag", "type", "kind", "style", "documentIndex", "di", "fileIndex", "fi", "filename", "env", "strenv", "del", "not"]);

export function compileExpression(source: string): Expression {
  if (Buffer.byteLength(source) > 8192) throw new MikeError("yq limit exceeded: expression bytes");
  const tokens: Token[] = [];
  let offset = 0;
  while (offset < source.length) {
    const character = source[offset]!;
    if (/\s/u.test(character)) { offset++; continue; }
    const start = offset;
    if (character === "#") { while (offset < source.length && source[offset] !== "\n") offset++; continue; }
    if (character === '"') {
      offset++;
      let escaped = false;
      while (offset < source.length) { const next = source[offset++]!; if (!escaped && next === '"') break; if (!escaped && next === "\\") escaped = true; else escaped = false; }
      const text = source.slice(start, offset);
      try { JSON.parse(text); } catch { throw new MikeError("bad expression, please check expression syntax"); }
      tokens.push({ text, offset: start, kind: "string" });
      continue;
    }
    const number = /^(?:[0-9]+(?:\.[0-9]+)?)(?:[eE][+-]?[0-9]+)?/u.exec(source.slice(offset));
    if (number) { tokens.push({ text: number[0], offset, kind: "number" }); offset += number[0].length; continue; }
    const name = /^[A-Za-z_][A-Za-z_0-9-]*/u.exec(source.slice(offset));
    if (name) { tokens.push({ text: name[0], offset, kind: "name" }); offset += name[0].length; continue; }
    const symbol = /^(?:\|=|=c|\+=|-=|\*=|\/=|==|!=|>=|<=|\/\/|\.\.|[.\[\]{}(),:|+*/%<>=-])/u.exec(source.slice(offset));
    if (!symbol) throw new MikeError(`1:${offset + 1}: lexer: invalid input text ${JSON.stringify(source.slice(offset))}`);
    tokens.push({ text: symbol[0], offset, kind: "symbol" }); offset += symbol[0].length;
  }
  tokens.push({ text: "", offset, kind: "end" });
  let position = 0;
  let nesting = 0;
  const peek = () => tokens[position]!;
  const take = () => tokens[position++]!;
  const expect = (text: string) => { if (take().text !== text) throw new MikeError("bad expression, please check expression syntax"); };
  const literal = (value: string | boolean | bigint | number | null): Expression => ({ kind: "literal", value });
  const parse = (minimum = 0): Expression => {
    if (++nesting > 64) throw new MikeError("yq limit exceeded: expression depth");
    const token = take();
    let result: Expression;
    if (token.text === ".") {
      result = { kind: "identity" };
      if (peek().kind === "name" || peek().kind === "string") { const key = take(); result = { kind: "field", base: result, key: literal(key.kind === "string" ? JSON.parse(key.text) as string : key.text) }; }
    } else if (token.text === "..") result = { kind: "recursive" };
    else if (token.text === "(") { result = { kind: "group", body: parse() }; expect(")"); }
    else if (token.text === "[") { result = peek().text === "]" ? { kind: "array" } : { kind: "array", body: parse() }; expect("]"); }
    else if (token.text === "{") {
      const fields: { key: Expression; value: Expression }[] = [];
      while (peek().text !== "}") {
        const key = take();
        if (key.kind === "name") throw new MikeError(`1:${key.offset + 1}: lexer: invalid input text ${JSON.stringify(source.slice(key.offset))}`);
        if (key.kind !== "string") throw new MikeError("bad expression, please check expression syntax");
        expect(":"); fields.push({ key: literal(key.kind === "string" ? JSON.parse(key.text) as string : key.text), value: parse(3) });
        if (peek().text !== ",") break;
        take();
      }
      expect("}"); result = { kind: "object", fields };
    } else if (token.text === "-") result = { kind: "binary", operator: "*", left: literal(-1n), right: parse(10) };
    else if (token.kind === "number") result = literal(/[.eE]/u.test(token.text) ? Number(token.text) : BigInt(token.text));
    else if (token.kind === "string") result = literal(JSON.parse(token.text) as string);
    else if (["true", "false", "null"].includes(token.text)) result = literal(JSON.parse(token.text) as boolean | null);
    else if (functions.has(token.text)) {
      const args: Expression[] = [];
      if (peek().text === "(") {
        take();
        if (token.text === "env" || token.text === "strenv") args.push(literal(take().text));
        else if (peek().text !== ")") args.push(parse());
        expect(")");
      }
      const needsArgument = ["select", "map", "has", "env", "strenv", "del"].includes(token.text);
      if (needsArgument && args.length === 0) throw new MikeError(`'${token.text}' expects 1 arg but received none`);
      if (!needsArgument && args.length) throw new MikeError("bad expression, please check expression syntax");
      result = { kind: "call", name: token.text, args };
    } else if (token.kind === "end" && tokens.some(item => item.text === "[")) throw new MikeError("bad expression, could not find matching `]`");
    else throw new MikeError(`1:${token.offset + 1}: lexer: invalid input text ${JSON.stringify(source.slice(token.offset))}`);
    while (true) {
      if (peek().text === ".") { take(); const key = take(); result = { kind: "field", base: result, key: literal(key.kind === "string" ? JSON.parse(key.text) as string : key.text) }; continue; }
      if (peek().text === "[") {
        take();
        if (peek().text === "]") result = { kind: "pipe", operator: "|", left: result, right: { kind: "iterate" } };
        else {
          const start = peek().text === ":" ? literal(0n) : parse();
          if (peek().text === ":") {
            take();
            const end: Expression = peek().text === "]" ? { kind: "call", name: "length", args: [] } : parse();
            result = { kind: "slice", base: result, start, end };
          } else result = { kind: "field", base: result, key: start };
        }
        expect("]"); continue;
      }
      if ((peek().text === "tag" || peek().text === "style") && minimum <= 3) {
        result = { kind: "pipe", operator: "|", left: result, right: { kind: "call", name: take().text, args: [] } }; continue;
      }
      const operator = peek().text;
      const priority = priorities[operator];
      if (priority === undefined || priority < minimum) break;
      take();
      if (operator === "//" && peek().text === "=") throw new MikeError("'//' expects 2 args but there is 1");
      result = { kind: operator === "|" ? "pipe" : "binary", operator, left: result, right: parse(priority + (priority === 3 ? 0 : 1)) };
    }
    nesting--;
    return result;
  };
  if (!source.trim()) return { kind: "identity" };
  const result = parse();
  if (peek().kind !== "end") throw new MikeError("bad expression, please check expression syntax");
  return result;
}
