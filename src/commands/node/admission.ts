import { NodeProfileError, NodeUsageError, nodeLimits } from "./types.js";
import { text } from "./values.js";

export type NodeToken = { value: string; kind: "word" | "string" | "number" | "operator" | "end"; line: boolean };
type Token = NodeToken;
type Expression = { assignable: boolean; name?: string; literal?: string; member?: boolean };
const forbidden = new Set(["eval", "Function", "Buffer", "global", "globalThis", "Worker", "SharedArrayBuffer", "Atomics", "Symbol", "BigInt", "setTimeout", "setInterval", "setImmediate", "queueMicrotask", "fetch", "WebAssembly", "module", "exports", "import", "export", "class", "super", "this", "yield"]);
const prototypeKeys = new Set(["__proto__", "prototype", "constructor"]);
const words = new Set(["let", "const", "var", "if", "else", "while", "do", "for", "break", "continue", "function", "async", "return", "throw", "try", "catch", "finally", "await", "new", "delete", "typeof", "void", "true", "false", "null", "in", "of", "instanceof", "switch", "case", "default", "with", "debugger"]);
const precedence = new Map([["=", 1], ["+=", 1], ["-=", 1], ["*=", 1], ["/=", 1], ["%=", 1], ["**=", 1], ["??", 3], ["||", 3], ["&&", 4], ["==", 5], ["!=", 5], ["===", 5], ["!==", 5], ["<", 6], [">", 6], ["<=", 6], [">=", 6], ["+", 7], ["-", 7], ["*", 8], ["/", 8], ["%", 8], ["**", 9]]);
const simple = (): Expression => ({ assignable: false });
function refusal(): never { throw new NodeUsageError("source is outside the restricted Node grammar"); }
function moduleAllowed(value: string): boolean {
  return ["fs", "path", "process", "node:fs", "node:path", "node:process"].includes(value) || (value.startsWith("./") || value.startsWith("../") || value.startsWith("/")) && value.endsWith(".json") && !value.includes("\0");
}
export function tokenizeNodeSource(source: string): NodeToken[] {
  const tokens: Token[] = [];
  let offset = 0;
  let line = false;
  const scalar = (): string => String.fromCodePoint(source.codePointAt(offset) ?? 0);
  const hexadecimal = (count: number): number => {
    const value = source.slice(offset, offset + count);
    if (value.length !== count || !/^[0-9a-f]+$/iu.test(value)) refusal();
    offset += count;
    return Number.parseInt(value, 16);
  };
  const unicode = (): string => {
    if (source[offset] !== "{") return String.fromCharCode(hexadecimal(4));
    offset += 1;
    const start = offset;
    while (offset < source.length && source[offset] !== "}") offset += 1;
    const digits = source.slice(start, offset);
    if (source[offset] !== "}" || !/^[0-9a-f]{1,6}$/iu.test(digits)) refusal();
    offset += 1;
    const point = Number.parseInt(digits, 16);
    if (point > 0x10ffff) refusal();
    return String.fromCodePoint(point);
  };
  while (offset < source.length) {
    const start = offset;
    const current = scalar();
    if (/\s/u.test(current)) { if (/[\r\n\u2028\u2029]/u.test(current)) line = true; offset += current.length; continue; }
    if (source.startsWith("//", offset)) { offset += 2; while (offset < source.length && !/[\r\n\u2028\u2029]/u.test(source[offset]!)) offset += 1; continue; }
    if (source.startsWith("/*", offset)) {
      offset += 2;
      while (offset < source.length && !source.startsWith("*/", offset)) { if (/[\r\n\u2028\u2029]/u.test(source[offset]!)) line = true; offset += 1; }
      if (offset >= source.length) refusal(); offset += 2; continue;
    }
    let kind: Token["kind"] = "operator";
    let value = "";
    if (current === "'" || current === '"') {
      kind = "string"; offset += 1;
      while (offset < source.length && source[offset] !== current) {
        let next = scalar(); offset += next.length;
        if (/[\r\n\u2028\u2029]/u.test(next)) refusal();
        if (next === "\\") {
          next = source[offset++] ?? "";
          if (next === "u") next = unicode();
          else if (next === "x") next = String.fromCharCode(hexadecimal(2));
          else if (next === "\r" || next === "\n") { if (next === "\r" && source[offset] === "\n") offset += 1; next = ""; }
          else { const escaped: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0" }; if (/[1-9]/u.test(next) || next === "0" && /[0-9]/u.test(source[offset] ?? "")) refusal(); next = escaped[next] ?? next; }
        }
        value += next;
      }
      if (source[offset++] !== current) refusal();
    } else if (/[\p{ID_Start}_$]/u.test(current) || current === "\\") {
      kind = "word";
      while (offset < source.length) {
        let part = scalar();
        if (part === "\\") { offset += 1; if (source[offset++] !== "u") refusal(); part = unicode(); }
        else { if (!(value.length === 0 ? /[\p{ID_Start}_$]/u : /[\p{ID_Continue}$\u200c\u200d]/u).test(part)) break; offset += part.length; }
        if (!(value.length === 0 ? /^[\p{ID_Start}_$]$/u : /^[\p{ID_Continue}$\u200c\u200d]$/u).test(part)) refusal();
        value += part;
      }
      if (value.startsWith("__vnode") || forbidden.has(value)) refusal();
    } else if (/[0-9]/u.test(current) || current === "." && /[0-9]/u.test(source[offset + 1] ?? "")) {
      kind = "number";
      const match = /^(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)/u.exec(source.slice(offset));
      if (!match) refusal(); value = match[0]; offset += value.length;
      if (/[\p{ID_Continue}$\\]/u.test(source[offset] ?? "")) refusal();
    } else {
      const operator = ["===", "!==", "**=", "=>", "==", "!=", "<=", ">=", "++", "--", "+=", "-=", "*=", "/=", "%=", "**", "&&", "||", "??"].find(candidate => source.startsWith(candidate, offset));
      value = operator ?? current;
      if (!operator && !"{}[]().,;:?+-*/%<>=!".includes(current)) refusal();
      offset += value.length;
    }
    if (offset <= start) refusal();
    tokens.push({ kind, value, line }); line = false;
  }
  tokens.push({ kind: "end", value: "", line });
  return tokens;
}
class Parser {
  #index = 0;
  #depth = 0;
  #functions = 0;
  #async = false;
  #loops = 0;
  constructor(readonly tokens: readonly Token[]) {}
  current(): Token { return this.tokens[this.#index]!; }
  at(value: string): boolean { return this.current().value === value && this.current().kind !== "string"; }
  take(value: string): boolean { if (!this.at(value)) return false; this.#index += 1; return true; }
  expect(value: string): void { if (!this.take(value)) refusal(); }
  word(): string { const token = this.current(); if (token.kind !== "word" || words.has(token.value)) refusal(); this.#index += 1; return token.value; }
  nested<Value>(body: () => Value): Value {
    this.#depth += 1;
    if (this.#depth > nodeLimits.callDepth) throw new NodeProfileError("source nesting");
    try { return body(); } finally { this.#depth -= 1; }
  }
  endStatement(): void { if (!this.take(";") && !this.at("}") && this.current().kind !== "end" && !this.current().line) refusal(); }
  block(): void { this.expect("{"); while (!this.take("}")) { if (this.current().kind === "end") refusal(); this.statement(); } }
  declarations(): void {
    const constant = this.take("const"); if (!constant && !this.take("let") && !this.take("var")) refusal();
    do { this.word(); if (this.take("=")) this.expression(); else if (constant) refusal(); } while (this.take(","));
  }
  functionBody(asynchronous: boolean, expression: boolean): void {
    const previous = { functions: this.#functions, asynchronous: this.#async, loops: this.#loops };
    this.#functions += 1; this.#async = asynchronous; this.#loops = 0;
    try { if (expression && !this.at("{")) this.expression(); else this.block(); }
    finally { this.#functions = previous.functions; this.#async = previous.asynchronous; this.#loops = previous.loops; }
  }
  parameters(): void {
    this.expect("("); const names = new Set<string>();
    if (!this.at(")")) do { const name = this.word(); if (names.has(name) || names.size >= 16) refusal(); names.add(name); } while (this.take(","));
    this.expect(")");
  }
  functionExpression(declaration: boolean, asynchronous = false): Expression {
    this.expect("function"); if (declaration || this.current().kind === "word") this.word();
    this.parameters(); this.functionBody(asynchronous, false); return simple();
  }
  statement(): void {
    this.nested(() => {
      if (this.take(";")) return;
      if (this.at("{")) { this.block(); return; }
      if (this.at("function")) { this.functionExpression(true); return; }
      if (this.at("async") && this.tokens[this.#index + 1]?.value === "function" && !this.tokens[this.#index + 1]?.line) { this.#index += 1; this.functionExpression(true, true); return; }
      if (this.at("let") || this.at("const") || this.at("var")) { this.declarations(); this.endStatement(); return; }
      if (this.take("if")) { this.expect("("); this.expression(); this.expect(")"); this.statement(); if (this.take("else")) this.statement(); return; }
      if (this.take("while")) { this.expect("("); this.expression(); this.expect(")"); this.#loops += 1; try { this.statement(); } finally { this.#loops -= 1; } return; }
      if (this.take("do")) { this.#loops += 1; try { this.statement(); } finally { this.#loops -= 1; } this.expect("while"); this.expect("("); this.expression(); this.expect(")"); this.take(";"); return; }
      if (this.take("for")) {
        this.expect("("); if (!this.at(";")) { if (this.at("let") || this.at("var") || this.at("const")) this.declarations(); else this.expression(); }
        this.expect(";"); if (!this.at(";")) this.expression(); this.expect(";"); if (!this.at(")")) this.expression(); this.expect(")");
        this.#loops += 1; try { this.statement(); } finally { this.#loops -= 1; } return;
      }
      if (this.take("break") || this.take("continue")) { if (!this.#loops) refusal(); this.endStatement(); return; }
      if (this.take("return")) { if (!this.#functions) refusal(); if (!this.current().line && !this.at(";") && !this.at("}") && this.current().kind !== "end") this.expression(); this.endStatement(); return; }
      if (this.take("throw")) { if (this.current().line) refusal(); this.expression(); this.endStatement(); return; }
      if (this.take("try")) { this.block(); let handled = false; if (this.take("catch")) { handled = true; if (this.take("(")) { this.word(); this.expect(")"); } this.block(); } if (this.take("finally")) { handled = true; this.block(); } if (!handled) refusal(); return; }
      this.expression(); this.endStatement();
    });
  }
  expression(minimum = 1): Expression {
    return this.nested(() => {
      let left = this.primary();
      while (true) {
        if (this.take(".")) { const token = this.current(); if (token.kind !== "word" || prototypeKeys.has(token.value)) refusal(); this.#index += 1; left = { assignable: true, member: true }; continue; }
        if (this.take("[")) { const key = this.expression(); this.expect("]"); if (key.literal !== undefined && prototypeKeys.has(key.literal)) refusal(); left = { assignable: true, member: true }; continue; }
        if (this.at("(")) {
          this.#index += 1; let count = 0; let first: Expression | undefined;
          if (!this.at(")")) do { if (++count > 16) refusal(); const argument = this.expression(); first ??= argument; } while (this.take(","));
          this.expect(")"); if (left.name === "require" && first?.literal !== undefined && !moduleAllowed(first.literal)) refusal(); left = simple(); continue;
        }
        if ((this.at("++") || this.at("--")) && !this.current().line) { if (!left.assignable) refusal(); this.#index += 1; left = simple(); continue; }
        if (minimum <= 2 && this.take("?")) { this.expression(); this.expect(":"); this.expression(2); left = simple(); continue; }
        const operator = this.current().value;
        const power = precedence.get(operator);
        if (power === undefined || power < minimum || this.current().kind !== "operator") break;
        this.#index += 1; if (power === 1 && !left.assignable) refusal();
        this.expression(operator === "**" || power === 1 ? power : power + 1); left = simple();
      }
      return left;
    });
  }
  arrowAhead(): boolean {
    let position = this.#index;
    if (this.tokens[position]?.value === "async") { position += 1; if (this.tokens[position]?.line) return false; }
    if (this.tokens[position]?.kind === "word" && this.tokens[position + 1]?.value === "=>") return true;
    if (this.tokens[position]?.value !== "(") return false;
    position += 1;
    if (this.tokens[position]?.value !== ")") {
      while (this.tokens[position]?.kind === "word" && !words.has(this.tokens[position]!.value)) {
        position += 1; if (this.tokens[position]?.value !== ",") break; position += 1;
      }
    }
    return this.tokens[position]?.value === ")" && this.tokens[position + 1]?.value === "=>";
  }
  primary(): Expression {
    if (this.arrowAhead()) {
      const asynchronous = this.take("async"); if (this.at("(")) this.parameters(); else this.word();
      if (this.current().line) refusal(); this.expect("=>"); this.functionBody(asynchronous, true); return simple();
    }
    if (this.at("function")) return this.functionExpression(false);
    if (this.take("async")) return this.functionExpression(false, true);
    if (this.take("new")) { const name = this.word(); if (!["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError"].includes(name)) refusal(); if (this.take("(")) { if (!this.at(")")) this.expression(); this.expect(")"); } return simple(); }
    if (["!", "+", "-", "typeof", "void", "delete", "await", "++", "--"].some(operator => this.at(operator))) {
      const operator = this.current().value; this.#index += 1;
      if (operator === "await" && !this.#async) refusal();
      const operand = this.expression(10);
      if ((operator === "++" || operator === "--") && !operand.assignable || operator === "delete" && !operand.member) refusal();
      return simple();
    }
    const token = this.current();
    if (token.kind === "string") { this.#index += 1; return { assignable: false, literal: token.value }; }
    if (token.kind === "number" || this.take("true") || this.take("false") || this.take("null")) { if (token.kind === "number") this.#index += 1; return simple(); }
    if (this.take("(")) { const inner = this.expression(); this.expect(")"); return inner; }
    if (this.take("[")) { if (!this.at("]")) { this.expression(); while (this.take(",")) { if (this.at("]")) break; this.expression(); } } this.expect("]"); return simple(); }
    if (this.take("{")) {
      if (!this.at("}")) do {
        if (this.at("}")) break;
        if (this.take("[")) { const key = this.expression(); if (key.literal !== undefined && prototypeKeys.has(key.literal)) refusal(); this.expect("]"); this.expect(":"); this.expression(); }
        else { const key = this.current(); if (!["word", "number", "string"].includes(key.kind) || prototypeKeys.has(key.value)) refusal(); this.#index += 1; if (this.take(":")) this.expression(); else if (key.kind !== "word" || words.has(key.value)) refusal(); }
      } while (this.take(","));
      this.expect("}"); return simple();
    }
    const name = this.word(); return { assignable: true, name };
  }
  parse(print: boolean): void {
    if (print) { if (this.current().kind === "end") refusal(); this.expression(); }
    else while (this.current().kind !== "end") this.statement();
    if (this.current().kind !== "end") refusal();
  }
}
export function admitSource(source: string, print: boolean): void {
  text(source, nodeLimits.sourceBytes, "source bytes");
  new Parser(tokenizeNodeSource(source)).parse(print);
}
