import { NodeProfileError, NodeUsageError, nodeLimits, type NodeSelector } from "./types.js";
import { tokenizeNodeSource, type NodeToken } from "./admission.js";

type Scope = { parent?: Scope; functionScope: boolean; names: Set<string> };
type Reference = { name: string; scope: Scope; query?: boolean };
type VariableCode = { target: Reference; bound: Code; missing: Code };
type Code = string | Reference | VariableCode | Code[];
type Expression = { code: Code; name?: Reference; member?: { object: Code; key: Code } };
const powers = new Map([["=", 1], ["+=", 1], ["-=", 1], ["*=", 1], ["/=", 1], ["%=", 1], ["**=", 1], ["??", 3], ["||", 3], ["&&", 4], ["==", 5], ["!=", 5], ["===", 5], ["!==", 5], ["<", 6], [">", 6], ["<=", 6], [">=", 6], ["+", 7], ["-", 7], ["*", 8], ["/", 8], ["%", 8], ["**", 9]]);
const globals = new Set(["undefined", "NaN", "Infinity", "require", "process", "console", "JSON", "Object", "Array", "Promise", "Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "String"]);
const quote = (value: string): string => JSON.stringify(value);
const invoke = (name: string, ...args: Code[]): Code => ["__vnodeRules.", name, "(", join(args), ")"];
function join(values: Code[], delimiter = ","): Code { return values.flatMap((value, index) => index === 0 ? [value] : [delimiter, value]); }
function invalid(): never { throw new NodeUsageError("source lowering is outside the restricted Node grammar"); }
class Lowerer {
  #index = 0;
  #depth = 0;
  #asynchronous = false;
  #scope: Scope = { functionScope: true, names: new Set() };
  constructor(readonly tokens: readonly NodeToken[], readonly selector: NodeSelector) {}
  current(): NodeToken { return this.tokens[this.#index]!; }
  at(value: string): boolean { return this.current().value === value && this.current().kind !== "string"; }
  take(value: string): boolean { if (!this.at(value)) return false; this.#index += 1; return true; }
  expect(value: string): void { if (!this.take(value)) invalid(); }
  word(): string { const item = this.current(); if (item.kind !== "word") invalid(); this.#index += 1; return item.value; }
  reference(name: string): Reference { return { name, scope: this.#scope }; }
  declare(name: string, variable = false): void { let scope = this.#scope; if (variable) while (!scope.functionScope && scope.parent) scope = scope.parent; scope.names.add(name); }
  scoped<Value>(functionScope: boolean, names: string[], callback: () => Value): Value {
    const before = this.#scope; this.#scope = { parent: before, functionScope, names: new Set(names) };
    try { return callback(); } finally { this.#scope = before; }
  }
  block(names: string[] = []): Code {
    this.expect("{");
    return this.scoped(false, names, () => { const statements: Code[] = []; while (!this.take("}")) statements.push(this.statement()); return ["{", ...statements, "}"]; });
  }
  parameters(): string[] { this.expect("("); const names: string[] = []; if (!this.at(")")) do { names.push(this.word()); } while (this.take(",")); this.expect(")"); return names; }
  body(asynchronous: boolean, names: string[], expression: boolean): Code {
    const before = this.#asynchronous; this.#asynchronous = asynchronous;
    try { return this.scoped(true, names, () => expression && !this.at("{") ? asynchronous ? invoke("adopt", this.expression().code) : this.expression().code : this.block()); }
    finally { this.#asynchronous = before; }
  }
  declaration(): Code {
    const kind = this.word(); const clauses: Code[] = [];
    do { const name = this.word(); this.declare(name, kind === "var"); clauses.push(this.take("=") ? [name, "=", this.expression().code] : name); } while (this.take(","));
    return [kind, " ", join(clauses)];
  }
  functionCode(declaration: boolean, asynchronous: boolean): Code {
    this.expect("function"); const name = this.current().kind === "word" ? this.word() : "";
    if (declaration && !name) invalid(); if (declaration) this.declare(name);
    const names = this.parameters();
    const body = this.body(asynchronous, name ? [...names, name] : names, false);
    return [asynchronous ? "async function " : "function ", name, "(", names.join(","), ")", body];
  }
  statement(): Code {
    if (++this.#depth > nodeLimits.callDepth) throw new NodeProfileError("lowering nesting");
    try {
      if (this.take(";")) return ";";
      if (this.at("{")) return this.block();
      if (this.at("function")) return this.functionCode(true, false);
      if (this.at("async") && this.tokens[this.#index + 1]?.value === "function") { this.#index += 1; return this.functionCode(true, true); }
      if (["let", "const", "var"].some(value => this.at(value))) { const code = this.declaration(); this.take(";"); return [code, ";"]; }
      if (this.take("if")) { this.expect("("); const test = this.expression().code; this.expect(")"); const yes = this.statement(); return ["if(", test, ")", yes, this.take("else") ? ["else ", this.statement()] : ""]; }
      if (this.take("while")) { this.expect("("); const test = this.expression().code; this.expect(")"); return ["while(", test, ")", this.statement()]; }
      if (this.take("do")) { const body = this.statement(); this.expect("while"); this.expect("("); const test = this.expression().code; this.expect(")"); this.take(";"); return ["do ", body, "while(", test, ");"]; }
      if (this.take("for")) return this.scoped(false, [], () => {
        this.expect("("); const initial = this.at(";") ? "" : ["let", "const", "var"].some(value => this.at(value)) ? this.declaration() : this.expression().code;
        this.expect(";"); const test = this.at(";") ? "" : this.expression().code; this.expect(";"); const update = this.at(")") ? "" : this.expression().code; this.expect(")");
        return ["for(", initial, ";", test, ";", update, ")", this.statement()];
      });
      if (this.at("break") || this.at("continue")) { const keyword = this.word(); this.take(";"); return keyword + ";"; }
      if (this.take("return")) { const absent = this.current().line || this.at(";") || this.at("}") || this.current().kind === "end"; const value = absent ? "" : this.expression().code; this.take(";"); return ["return ", !absent && this.#asynchronous ? invoke("adopt", value) : value, ";"]; }
      if (this.take("throw")) { const value = this.expression().code; this.take(";"); return ["throw ", value, ";"]; }
      if (this.take("try")) {
        const body = this.block(); let caught: Code = ""; let final: Code = "";
        if (this.take("catch")) { let name = ""; if (this.take("(")) { name = this.word(); this.expect(")"); } caught = ["catch", name ? "(" + name + ")" : "", this.block(name ? [name] : [])]; }
        if (this.take("finally")) final = ["finally", this.block()]; return ["try", body, caught, final];
      }
      const result = this.expression().code; this.take(";"); return [result, ";"];
    } finally { this.#depth -= 1; }
  }
  arrowAhead(): boolean {
    let cursor = this.#index; if (this.tokens[cursor]?.value === "async") cursor += 1;
    if (this.tokens[cursor]?.kind === "word" && this.tokens[cursor + 1]?.value === "=>") return true;
    if (this.tokens[cursor]?.value !== "(") return false; cursor += 1;
    while (this.tokens[cursor]?.kind === "word") { cursor += 1; if (this.tokens[cursor]?.value !== ",") break; cursor += 1; }
    return this.tokens[cursor]?.value === ")" && this.tokens[cursor + 1]?.value === "=>";
  }
  referenceCode(value: Expression, read: boolean): Code {
    if (value.member) return invoke("reference", value.member.object, value.member.key, read ? "true" : "false");
    invalid();
  }
  update(value: Expression, operator: string, prefix: boolean): Code {
    const delta = operator === "++" ? "1" : "-1";
    if (value.member) return invoke("update", this.referenceCode(value, true), delta, prefix ? "true" : "false");
    if (!value.name) invalid();
    return { target: value.name, bound: invoke("updateVariable", ["()=>", value.name], ["(__vnodeValue)=>", value.name, "=__vnodeValue"], delta, prefix ? "true" : "false"), missing: invoke("unbound", quote(value.name.name)) };
  }
  expression(minimum = 1): Expression {
    if (++this.#depth > nodeLimits.callDepth) throw new NodeProfileError("lowering nesting");
    try {
      let left = this.primary();
      while (true) {
        if (this.take(".")) { const key = quote(this.word()); const object = left.code; left = { member: { object, key }, code: invoke("get", object, key) }; continue; }
        if (this.take("[")) { const key = this.expression().code; this.expect("]"); const object = left.code; left = { member: { object, key }, code: invoke("get", object, key) }; continue; }
        if (this.take("(")) {
          const args: Code[] = []; if (!this.at(")")) do { args.push(this.expression().code); } while (this.take(",")); this.expect(")");
          const list: Code = ["[", join(args), "]"];
          left = { code: left.member ? invoke("method", left.member.object, left.member.key, list) : invoke("call", left.code, list) }; continue;
        }
        if ((this.at("++") || this.at("--")) && !this.current().line) { const operator = this.current().value; this.#index += 1; left = { code: this.update(left, operator, false) }; continue; }
        if (minimum <= 2 && this.take("?")) { const yes = this.expression().code; this.expect(":"); const no = this.expression(2).code; left = { code: ["(", left.code, "?", yes, ":", no, ")"] }; continue; }
        const operator = this.current().value; const power = powers.get(operator);
        if (power === undefined || power < minimum || this.current().kind !== "operator") break; this.#index += 1;
        const right = this.expression(power === 1 || operator === "**" ? power : power + 1).code;
        if (power === 1) {
          if (left.member) left = { code: operator === "=" ? invoke("assign", this.referenceCode(left, false), right) : invoke("compound", this.referenceCode(left, true), quote(operator.slice(0, -1)), right) };
          else { if (!left.name) invalid(); left = { code: { target: left.name, bound: ["(", left.name, "=", operator === "=" ? right : invoke("binary", quote(operator.slice(0, -1)), left.name, right), ")"], missing: operator === "=" ? invoke("unbound", quote(left.name.name), right) : invoke("unbound", quote(left.name.name)) } }; }
        } else left = { code: ["&&", "||", "??", "===", "!=="].includes(operator) ? ["(", left.code, operator, right, ")"] : invoke("binary", quote(operator), left.code, right) };
      }
      return left;
    } finally { this.#depth -= 1; }
  }
  primary(): Expression {
    if (this.arrowAhead()) { const asynchronous = this.take("async"); const names = this.at("(") ? this.parameters() : [this.word()]; this.expect("=>"); return { code: [asynchronous ? "async " : "", "(", names.join(","), ")=>", this.body(asynchronous, names, true)] }; }
    if (this.at("function")) return { code: this.functionCode(false, false) };
    if (this.take("async")) return { code: this.functionCode(false, true) };
    if (this.take("new")) { const name = this.reference(this.word()); const args: Code[] = []; if (this.take("(")) { if (!this.at(")")) args.push(this.expression().code); this.expect(")"); } return { code: invoke("call", name, ["[", join(args), "]"]) }; }
    if (["!", "+", "-", "typeof", "void", "delete", "await", "++", "--"].some(operator => this.at(operator))) {
      const operator = this.current().value; this.#index += 1; const value = this.expression(10);
      if (operator === "++" || operator === "--") return { code: this.update(value, operator, true) };
      if (operator === "delete") { if (!value.member) invalid(); return { code: invoke("remove", value.member.object, value.member.key) }; }
      if (operator === "typeof" && value.name) return { code: ["typeof ", { ...value.name, query: true }] };
      if (operator === "+" || operator === "-") return { code: invoke("unary", quote(operator), value.code) };
      if (operator === "await") return { code: ["(await ", invoke("adopt", value.code), ")"] };
      return { code: ["(", operator, " ", value.code, ")"] };
    }
    const token = this.current();
    if (token.kind === "string") { this.#index += 1; return { code: quote(token.value) }; }
    if (token.kind === "number" || ["true", "false", "null"].some(value => this.at(value))) { this.#index += 1; return { code: token.value }; }
    if (this.take("(")) { const value = this.expression(); this.expect(")"); return { ...value, code: ["(", value.code, ")"] }; }
    if (this.take("[")) { const values: Code[] = []; if (!this.at("]")) do { if (this.at("]")) break; values.push(this.expression().code); } while (this.take(",")); this.expect("]"); return { code: invoke("array", ["[", join(values), "]"]) }; }
    if (this.take("{")) {
      const entries: Code[] = []; if (!this.at("}")) do {
        if (this.at("}")) break;
        if (this.take("[")) { const key = this.expression().code; this.expect("]"); this.expect(":"); entries.push(["[", invoke("key", key), "]:", this.expression().code]); }
        else { const key = this.current(); this.#index += 1; const value = this.take(":") ? this.expression().code : this.reference(key.value); entries.push([key.kind === "number" ? key.value : quote(key.value), ":", value]); }
      } while (this.take(",")); this.expect("}"); return { code: invoke("object", ["{", join(entries), "}"]) };
    }
    const name = this.reference(this.word()); return { code: name, name };
  }
  available(item: Reference): boolean {
    let scope: Scope | undefined = item.scope;
    while (scope && !scope.names.has(item.name)) scope = scope.parent;
    return scope !== undefined || globals.has(item.name) || this.selector === "file" && ["__filename", "__dirname"].includes(item.name);
  }
  render(code: Code): string {
    const stack: Code[] = [code]; const chunks: string[] = []; let bytes = 0;
    while (stack.length) {
      const item = stack.pop()!;
      if (Array.isArray(item)) { for (let index = item.length - 1; index >= 0; index -= 1) stack.push(item[index]!); continue; }
      if (typeof item !== "string" && "target" in item) { stack.push(this.available(item.target) ? item.bound : item.missing); continue; }
      let fragment: string;
      if (typeof item === "string") fragment = item;
      else fragment = this.available(item) ? item.name : item.query ? "undefined" : "__vnodeRules.unbound(" + quote(item.name) + ")";
      bytes += Buffer.byteLength(fragment); if (bytes > nodeLimits.sourceBytes) throw new NodeProfileError("lowered source bytes"); chunks.push(fragment);
    }
    return chunks.join("");
  }
  lower(): string {
    const body: Code[] = [];
    if (this.selector === "print") body.push(this.expression().code);
    else while (this.current().kind !== "end") body.push(this.statement());
    if (this.current().kind !== "end") invalid(); return this.render(body);
  }
}
export function lowerNodeSource(source: string, selector: NodeSelector): string { return new Lowerer(tokenizeNodeSource(source), selector).lower(); }
