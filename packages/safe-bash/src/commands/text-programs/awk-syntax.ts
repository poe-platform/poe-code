import { Pattern } from "./regex.js";
import { ProgramError } from "./shared.js";
import { validateFormat } from "./awk-values.js";

export type Expression = { kind: "number"; value: number } | { kind: "string"; value: string }
  | { kind: "regex"; pattern: Pattern } | { kind: "variable"; name: string }
  | { kind: "field"; index: Expression } | { kind: "array"; name: string; indexes: Expression[] }
  | { kind: "tuple"; items: Expression[] }
  | { kind: "unary"; operator: string; operand: Expression; postfix: boolean }
  | { kind: "binary"; operator: string; left: Expression; right: Expression }
  | { kind: "conditional"; condition: Expression; yes: Expression; no: Expression }
  | { kind: "getline"; target?: Expression; file: Expression }
  | { kind: "call"; name: string; args: Expression[] };

export type Statement = { kind: "block"; body: Statement[] } | { kind: "expression"; expression: Expression }
  | { kind: "print"; formatted: boolean; args: Expression[]; redirect?: { append: boolean; destination: Expression } }
  | { kind: "if"; condition: Expression; yes: Statement; no?: Statement }
  | { kind: "while"; condition: Expression; body: Statement }
  | { kind: "do"; condition: Expression; body: Statement }
  | { kind: "for"; initial?: Expression; condition?: Expression; update?: Expression; body: Statement }
  | { kind: "foreach"; variable: string; array: string; body: Statement }
  | { kind: "flow"; flow: "break" | "continue" | "next" | "nextfile" | "return" | "exit"; value?: Expression }
  | { kind: "delete"; target: Extract<Expression, { kind: "array" | "variable" }> };

export interface Rule { readonly pattern?: Expression; readonly end?: Expression; readonly action: Statement }
export interface AwkFunction { readonly parameters: string[]; readonly arrays: Set<string>; readonly body: Statement }
export interface AwkProgram { readonly begin: Statement[]; readonly end: Statement[]; readonly rules: Rule[]; readonly functions: Map<string, AwkFunction> }

interface Token { readonly kind: "name" | "number" | "string" | "operator" | "end"; readonly text: string; readonly offset: number }

export function decodeString(source: string): string {
  let result = "";
  const controls: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", a: "\x07", "\\": "\\", '"': '"' };
  for (let offset = 0; offset < source.length; offset++) {
    const character = source[offset]!;
    if (character !== "\\") { result += character; continue; }
    const next = source[++offset];
    if (next === undefined) throw new ProgramError("trailing string escape");
    if (next === "\n") continue;
    if (/^[0-7]$/u.test(next)) {
      const following = /^[0-7]{0,2}/u.exec(source.slice(offset + 1))![0];
      result += String.fromCharCode(parseInt(next + following, 8) & 255); offset += following.length;
    } else result += controls[next] ?? next;
  }
  return result;
}

class Lexer {
  private offset = 0;
  constructor(private readonly source: string) {
    if (source.length > 1024 * 1024) throw new ProgramError("awk source exceeds 1 MiB");
  }
  next(): Token {
    while (this.offset < this.source.length) {
      const character = this.source[this.offset]!;
      if (/[ \t\r]/u.test(character)) { this.offset++; continue; }
      if (character === "\\" && this.source[this.offset + 1] === "\n") { this.offset += 2; continue; }
      if (character === "#") { while (this.offset < this.source.length && this.source[this.offset] !== "\n") this.offset++; continue; }
      break;
    }
    const offset = this.offset;
    if (offset === this.source.length) return { kind: "end", text: "", offset };
    const rest = this.source.slice(offset);
    const name = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(rest)?.[0];
    if (name) { this.offset += name.length; return { kind: "name", text: name, offset }; }
    const number = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/u.exec(rest)?.[0];
    if (number) {
      if (!Number.isFinite(Number(number))) throw new ProgramError("non-finite numeric literal");
      this.offset += number.length; return { kind: "number", text: number, offset };
    }
    if (rest[0] === '"') {
      this.offset++;
      let text = "";
      while (this.offset < this.source.length && this.source[this.offset] !== '"') {
        const character = this.source[this.offset++]!;
        if (character === "\n") throw new ProgramError("newline in string literal");
        text += character;
        if (character === "\\") {
          if (this.offset === this.source.length) throw new ProgramError("unterminated string literal");
          text += this.source[this.offset++]!;
        }
      }
      if (this.source[this.offset++] !== '"') throw new ProgramError("unterminated string literal");
      return { kind: "string", text: decodeString(text), offset };
    }
    const operator = /^(?:\+\+|--|\+=|-=|\*=|\/=|%=|\^=|==|!=|<=|>=|&&|\|\||!~|>>|[{}()[\],;\n$+*\/%^=!<>~?:|\-])/u.exec(rest)?.[0];
    if (!operator) throw new ProgramError(`unsupported token '${rest[0]}' at byte ${offset}`);
    this.offset += operator.length;
    return { kind: "operator", text: operator, offset };
  }
  regex(source = ""): Pattern {
    let bracket = false;
    while (this.offset < this.source.length) {
      const character = this.source[this.offset++]!;
      if (character === "\\") {
        const next = this.source[this.offset++];
        if (next === undefined) break;
        source += next === "/" ? "/" : `\\${next}`;
      } else if (character === "/" && !bracket) return new Pattern(source);
      else {
        if (character === "\n") throw new ProgramError("newline in regular expression literal");
        if (character === "[") bracket = true;
        if (character === "]") bracket = false;
        source += character;
      }
    }
    throw new ProgramError("unterminated regular expression literal");
  }
}

export const builtinArities: Readonly<Record<string, readonly [number, number]>> = {
  length: [0, 1], substr: [2, 3], index: [2, 2], split: [2, 3], match: [2, 2],
  sub: [2, 3], gsub: [2, 3], sprintf: [1, Infinity], tolower: [1, 1], toupper: [1, 1],
  int: [1, 1], sqrt: [1, 1], exp: [1, 1], log: [1, 1], sin: [1, 1], cos: [1, 1], atan2: [2, 2], close: [1, 1],
};

const reserved = new Set(["BEGIN", "END", "function", "if", "else", "while", "do", "for", "break", "continue", "next", "nextfile", "return", "exit", "delete", "print", "printf", "getline"]);
const precedences: Readonly<Record<string, number>> = {
  "=": 1, "+=": 1, "-=": 1, "*=": 1, "/=": 1, "%=": 1, "^=": 1,
  "||": 3, "&&": 4, in: 5, "~": 6, "!~": 6, "==": 7, "!=": 7, "<": 7, "<=": 7, ">": 7, ">=": 7,
  "+": 9, "-": 9, "*": 10, "/": 10, "%": 10, "^": 12,
};

export function isLvalue(expression: Expression): boolean { return ["variable", "field", "array"].includes(expression.kind); }

export class AwkParser {
  private readonly lexer: Lexer;
  private token: Token;
  private depth = 0;
  private loopDepth = 0;
  private currentFunction: string | undefined;
  private phase = "record";
  private arrays = new Set<string>();
  private readonly calls: { expression: Extract<Expression, { kind: "call" }>; owner: string | undefined }[] = [];
  constructor(source: string) { this.lexer = new Lexer(source); this.token = this.lexer.next(); }
  private advance(): Token { const previous = this.token; this.token = this.lexer.next(); return previous; }
  private at(text: string): boolean { return this.token.text === text && (this.token.kind === "operator" || this.token.kind === "name"); }
  private ended(): boolean { return this.token.kind === "end"; }
  private accept(text: string): boolean { if (!this.at(text)) return false; this.advance(); return true; }
  private expect(text: string): void { if (!this.accept(text)) throw new ProgramError(`expected '${text}' at byte ${this.token.offset}`); }
  private newlines(): void { while (this.at("\n")) this.advance(); }
  private separators(): void { while (this.at("\n") || this.at(";")) this.advance(); }
  private name(): string {
    if (this.token.kind !== "name" || reserved.has(this.token.text)) throw new ProgramError(`expected an identifier at byte ${this.token.offset}`);
    return this.advance().text;
  }

  parse(): AwkProgram {
    const program: AwkProgram = { begin: [], end: [], rules: [], functions: new Map() };
    this.separators();
    while (this.token.kind !== "end") {
      if (this.accept("function")) {
        const name = this.name();
        if (program.functions.has(name) || Object.hasOwn(builtinArities, name)) throw new ProgramError(`duplicate or reserved function '${name}'`);
        this.expect("(");
        const parameters: string[] = [];
        if (!this.at(")")) do { parameters.push(this.name()); } while (this.accept(","));
        this.expect(")"); this.newlines();
        if (new Set(parameters).size !== parameters.length) throw new ProgramError("duplicate function parameter");
        if (parameters.some(parameter => Object.hasOwn(builtinArities, parameter))) throw new ProgramError("reserved function parameter");
        const oldArrays = this.arrays;
        this.arrays = new Set(); this.currentFunction = name;
        const body = this.block();
        program.functions.set(name, { parameters, arrays: this.arrays, body });
        this.arrays = oldArrays; this.currentFunction = undefined;
      } else if (this.at("BEGIN") || this.at("END")) {
        this.phase = this.advance().text; this.newlines();
        program[this.phase === "BEGIN" ? "begin" : "end"].push(this.block());
        this.phase = "record";
      } else {
        let pattern: Expression | undefined;
        let end: Expression | undefined;
        if (!this.at("{")) {
          pattern = this.expression();
          if (this.accept(",")) end = this.expression();
        }
        const action: Statement = this.at("{") ? this.block() : { kind: "print", formatted: false, args: [] };
        program.rules.push({ ...(pattern ? { pattern } : {}), ...(end ? { end } : {}), action });
      }
      if (!this.at("\n") && !this.at(";") && !this.ended() && !this.at("{") && !this.at("BEGIN") && !this.at("END") && !this.at("function")) throw new ProgramError(`expected rule separator at byte ${this.token.offset}`);
      this.separators();
    }
    for (const call of this.calls) {
      const definition = program.functions.get(call.expression.name);
      const arity = Object.hasOwn(builtinArities, call.expression.name) ? builtinArities[call.expression.name] : definition ? [0, definition.parameters.length] : undefined;
      if (!arity) throw new ProgramError(`unsupported function '${call.expression.name}'`);
      if (call.expression.args.length < arity[0]! || call.expression.args.length > arity[1]!) throw new ProgramError(`invalid argument count for '${call.expression.name}'`);
      if (call.expression.name === "split" && call.expression.args[1]?.kind !== "variable") throw new ProgramError("split requires an array variable as its second argument");
      if ((call.expression.name === "sub" || call.expression.name === "gsub") && call.expression.args[2] && !isLvalue(call.expression.args[2])) throw new ProgramError("sub/gsub target must be assignable");
      if (call.expression.name === "sprintf" && call.expression.args[0]?.kind === "string") validateFormat(call.expression.args[0].value);
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const call of this.calls) {
        const callee = program.functions.get(call.expression.name);
        const owner = call.owner ? program.functions.get(call.owner) : undefined;
        if (!callee || !owner) continue;
        callee.parameters.forEach((parameter, index) => {
          const argument = call.expression.args[index];
          if (callee.arrays.has(parameter) && argument?.kind === "variable" && !owner.arrays.has(argument.name)) { owner.arrays.add(argument.name); changed = true; }
        });
      }
    }
    return program;
  }

  private block(): Statement {
    this.expect("{");
    if (++this.depth > 128) throw new ProgramError("awk nesting limit exceeded");
    const body: Statement[] = [];
    this.separators();
    while (!this.at("}")) {
      if (this.token.kind === "end") throw new ProgramError("unterminated action block");
      const statement = this.statement(); body.push(statement);
      if (["expression", "print", "flow", "delete"].includes(statement.kind) && !this.at(";") && !this.at("\n") && !this.at("}")) throw new ProgramError(`expected statement separator at byte ${this.token.offset}`);
      this.separators();
    }
    this.expect("}"); this.depth--;
    return { kind: "block", body };
  }

  private body(): Statement { this.newlines(); return this.statement(); }
  private condition(): Expression { this.expect("("); this.newlines(); const expression = this.expression(); this.newlines(); this.expect(")"); return expression; }

  private statement(): Statement {
    if (this.at("{")) return this.block();
    if (this.at(";") || this.at("\n")) { this.advance(); return { kind: "block", body: [] }; }
    if (this.accept("if")) {
      const condition = this.condition(); const yes = this.body();
      this.separators();
      const no = this.accept("else") ? this.body() : undefined;
      return { kind: "if", condition, yes, ...(no ? { no } : {}) };
    }
    if (this.accept("while")) {
      const condition = this.condition(); this.loopDepth++;
      const body = this.body(); this.loopDepth--;
      return { kind: "while", condition, body };
    }
    if (this.accept("do")) {
      this.loopDepth++; const body = this.body(); this.loopDepth--;
      this.separators(); this.expect("while"); const condition = this.condition();
      return { kind: "do", condition, body };
    }
    if (this.accept("for")) {
      this.expect("("); this.newlines();
      const initial = this.at(";") ? undefined : this.expression();
      if (initial?.kind === "binary" && initial.operator === "in" && this.accept(")")) {
        if (initial.left.kind !== "variable" || initial.right.kind !== "variable") throw new ProgramError("for-in requires variable and array names");
        this.arrays.add(initial.right.name); this.loopDepth++;
        const body = this.body(); this.loopDepth--;
        return { kind: "foreach", variable: initial.left.name, array: initial.right.name, body };
      }
      this.expect(";"); this.newlines();
      const condition = this.at(";") ? undefined : this.expression();
      this.expect(";"); this.newlines();
      const update = this.at(")") ? undefined : this.expression();
      this.expect(")"); this.loopDepth++; const body = this.body(); this.loopDepth--;
      return { kind: "for", ...(initial ? { initial } : {}), ...(condition ? { condition } : {}), ...(update ? { update } : {}), body };
    }
    if (this.token.kind === "name" && ["break", "continue", "next", "nextfile", "return", "exit"].includes(this.token.text)) {
      const flow = this.advance().text as Extract<Statement, { kind: "flow" }>["flow"];
      if ((flow === "break" || flow === "continue") && !this.loopDepth) throw new ProgramError(`${flow} outside a loop`);
      if (flow === "return" && !this.currentFunction) throw new ProgramError("return outside a function");
      if ((flow === "next" || flow === "nextfile") && this.phase !== "record") throw new ProgramError(`${flow} is not allowed in BEGIN/END`);
      const argument = (flow === "return" || flow === "exit") && ![";", "\n", "}"].some(token => this.at(token)) && !this.ended() ? this.expression() : undefined;
      return { kind: "flow", flow, ...(argument ? { value: argument } : {}) };
    }
    if (this.accept("delete")) {
      const target = this.expression(16);
      if (target.kind !== "variable" && target.kind !== "array") throw new ProgramError("delete requires an array or array element");
      this.arrays.add(target.name); return { kind: "delete", target };
    }
    if (this.at("print") || this.at("printf")) {
      const formatted = this.advance().text === "printf";
      const args: Expression[] = [];
      if (![";", "\n", "}", ">", ">>"].some(token => this.at(token)) && this.token.kind !== "end") {
        do { args.push(this.expression(0, true)); } while (this.accept(",") && (this.newlines(), true));
      }
      if (args.length === 1 && args[0]?.kind === "tuple") args.splice(0, 1, ...args[0].items);
      if (formatted && !args.length) throw new ProgramError("printf requires a format");
      if (formatted && args[0]?.kind === "string") validateFormat(args[0].value);
      let redirect: Extract<Statement, { kind: "print" }>["redirect"];
      if (this.at(">") || this.at(">>")) { const append = this.advance().text === ">>"; redirect = { append, destination: this.expression() }; }
      if (this.at("|")) throw new ProgramError("command pipes are not supported in awk");
      return { kind: "print", formatted, args, ...(redirect ? { redirect } : {}) };
    }
    return { kind: "expression", expression: this.expression() };
  }

  private expression(minimum = 0, print = false): Expression {
    if (++this.depth > 128) throw new ProgramError("awk expression nesting limit exceeded");
    let left = this.prefix();
    while (true) {
      const token = this.token.kind === "operator" || this.token.kind === "name" ? this.token.text : "";
      if ((token === "++" || token === "--") && minimum <= 15) {
        this.advance(); if (!isLvalue(left)) throw new ProgramError("increment requires an assignable expression");
        left = { kind: "unary", operator: token, operand: left, postfix: true }; continue;
      }
      if (token === "?" && minimum <= 2) {
        this.advance(); const yes = this.expression(); this.expect(":"); const no = this.expression(2, print);
        left = { kind: "conditional", condition: left, yes, no }; continue;
      }
      if (print && (token === ">" || token === ">>" || token === "|")) break;
      const precedence = Object.hasOwn(precedences, token) ? precedences[token] : undefined;
      if (precedence !== undefined) {
        if (precedence < minimum) break;
        this.advance(); this.newlines();
        const right = this.expression(precedence === 1 || token === "^" ? precedence : precedence + 1, print);
        if (precedence === 1 && !isLvalue(left)) throw new ProgramError("assignment requires an assignable expression");
        if (token === "in") {
          if (right.kind !== "variable") throw new ProgramError("right operand of 'in' must be an array name");
          this.arrays.add(right.name);
        }
        left = { kind: "binary", operator: token, left, right }; continue;
      }
      const concatenates = this.token.kind === "number" || this.token.kind === "string" || this.token.kind === "name" && !reserved.has(token) && token !== "in" || token === "$" || token === "(";
      if (concatenates && minimum <= 8) {
        left = { kind: "binary", operator: "concat", left, right: this.expression(9, print) }; continue;
      }
      break;
    }
    this.depth--;
    return left;
  }

  private prefix(): Expression {
    const token = this.token;
    if (this.accept("getline")) {
      let target: Expression | undefined;
      if (this.token.kind === "name" || this.at("$")) {
        target = this.prefix();
        if (!isLvalue(target)) throw new ProgramError("getline requires an assignable target");
      }
      if (!this.accept("<")) throw new ProgramError("getline currently requires file redirection");
      return { kind: "getline", ...(target ? { target } : {}), file: this.expression(8) };
    }
    if (token.kind === "number") { this.advance(); return { kind: "number", value: Number(token.text) }; }
    if (token.kind === "string") { this.advance(); return { kind: "string", value: token.text }; }
    if (token.text === "/" || token.text === "/=") {
      const pattern = this.lexer.regex(token.text === "/=" ? "=" : ""); this.token = this.lexer.next(); return { kind: "regex", pattern };
    }
    if (["+", "-", "!", "++", "--"].includes(token.text)) {
      this.advance(); const operand = this.expression(token.text.length === 2 ? 13 : 11);
      if (token.text.length === 2 && !isLvalue(operand)) throw new ProgramError("increment requires an assignable expression");
      return { kind: "unary", operator: token.text, operand, postfix: false };
    }
    if (this.accept("$")) return { kind: "field", index: this.expression(16) };
    if (this.accept("(")) {
      this.newlines();
      const items = [this.expression()];
      while (this.accept(",")) { this.newlines(); items.push(this.expression()); }
      this.newlines(); this.expect(")");
      return items.length === 1 ? items[0]! : { kind: "tuple", items };
    }
    if (token.kind === "name") {
      const name = this.name();
      if (this.accept("(")) {
        this.newlines();
        const args: Expression[] = [];
        if (!this.at(")")) do { this.newlines(); args.push(this.expression()); } while (this.accept(","));
        this.newlines(); this.expect(")");
        const expression: Extract<Expression, { kind: "call" }> = { kind: "call", name, args };
        this.calls.push({ expression, owner: this.currentFunction });
        if (name === "split" && args[1]?.kind === "variable") this.arrays.add(args[1].name);
        return expression;
      }
      if (name !== "length" && Object.hasOwn(builtinArities, name)) throw new ProgramError(`reserved variable '${name}'`);
      if (this.accept("[")) {
        const indexes: Expression[] = [];
        do { this.newlines(); indexes.push(this.expression()); } while (this.accept(","));
        this.newlines(); this.expect("]"); this.arrays.add(name);
        return { kind: "array", name, indexes };
      }
      if (name === "length") {
        const expression: Extract<Expression, { kind: "call" }> = { kind: "call", name, args: [] };
        this.calls.push({ expression, owner: this.currentFunction }); return expression;
      }
      return { kind: "variable", name };
    }
    throw new ProgramError(`unsupported expression '${token.text}' at byte ${token.offset}`);
  }
}
