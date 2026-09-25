import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { decoder, define, input, output, UsageError } from "../internal.js";
import { collectSourceBytes } from "./sponge.js";
import { PublicDiagnostic } from "../../diagnostics.js";
import { yieldTurn } from "../../contracts/yield.js";

export interface BcCommandOptions {
  readonly maxSteps?: number;
  readonly maxScale?: number;
  readonly maxInputBytes?: number;
  readonly replace?: boolean;
}

interface DecimalValue {
  readonly coeff: bigint;
  readonly scale: number;
}

const ZERO: DecimalValue = { coeff: 0n, scale: 0 };
const ONE: DecimalValue = { coeff: 1n, scale: 0 };

function pow10(n: number): bigint {
  if (n <= 0) return 1n;
  return 10n ** BigInt(n);
}

function alignDecimals(a: DecimalValue, b: DecimalValue): { aCoeff: bigint; bCoeff: bigint; scale: number } {
  if (a.scale === b.scale) return { aCoeff: a.coeff, bCoeff: b.coeff, scale: a.scale };
  if (a.scale > b.scale) {
    return { aCoeff: a.coeff, bCoeff: b.coeff * pow10(a.scale - b.scale), scale: a.scale };
  }
  return { aCoeff: a.coeff * pow10(b.scale - a.scale), bCoeff: b.coeff, scale: b.scale };
}

function addDec(a: DecimalValue, b: DecimalValue): DecimalValue {
  const { aCoeff, bCoeff, scale } = alignDecimals(a, b);
  return { coeff: aCoeff + bCoeff, scale };
}

function subDec(a: DecimalValue, b: DecimalValue): DecimalValue {
  const { aCoeff, bCoeff, scale } = alignDecimals(a, b);
  return { coeff: aCoeff - bCoeff, scale };
}

function mulDec(a: DecimalValue, b: DecimalValue, currentScale: number): DecimalValue {
  // GNU bc mul(a, b): result scale is min(a.scale + b.scale, max(scale, a.scale, b.scale))
  const fullScale = a.scale + b.scale;
  const resScale = Math.min(fullScale, Math.max(currentScale, a.scale, b.scale));
  const prod = a.coeff * b.coeff;
  const drop = fullScale - resScale;
  const coeff = drop > 0 ? prod / pow10(drop) : prod;
  return { coeff, scale: resScale };
}

function divDec(a: DecimalValue, b: DecimalValue, currentScale: number): DecimalValue {
  if (b.coeff === 0n) throw new PublicDiagnostic("Runtime error (func=(main), adr=0): Divide by zero");
  const shift = currentScale + b.scale - a.scale;
  const num = shift >= 0 ? a.coeff * pow10(shift) : a.coeff / pow10(-shift);
  return { coeff: num / b.coeff, scale: currentScale };
}

function modDec(a: DecimalValue, b: DecimalValue, currentScale: number): DecimalValue {
  // GNU bc: a % b is a - (a / b) * b at max(scale + b.scale, a.scale)
  const q = divDec(a, b, currentScale);
  const targetScale = Math.max(currentScale + b.scale, a.scale);
  const prod: DecimalValue = { coeff: q.coeff * b.coeff, scale: q.scale + b.scale };
  const { aCoeff, bCoeff, scale } = alignDecimals(a, prod);
  const diff = aCoeff - bCoeff;
  if (scale > targetScale) {
    return { coeff: diff / pow10(scale - targetScale), scale: targetScale };
  }
  if (scale < targetScale) {
    return { coeff: diff * pow10(targetScale - scale), scale: targetScale };
  }
  return { coeff: diff, scale: targetScale };
}

function truncToInt(d: DecimalValue): bigint {
  return d.scale > 0 ? d.coeff / pow10(d.scale) : d.coeff;
}

function powDec(base: DecimalValue, exp: DecimalValue, currentScale: number): DecimalValue {
  let n = truncToInt(exp);
  if (n === 0n) return ONE;
  const neg = n < 0n;
  if (neg) n = -n;
  if (n > 10000n) throw new PublicDiagnostic("exponent exceeds maximum limit (10000)");
  let result: DecimalValue = ONE;
  let cur: DecimalValue = base;
  const workScale = neg ? currentScale : Math.min(base.scale * Number(n), Math.max(currentScale, base.scale));
  let e = n;
  while (e > 0n) {
    if ((e & 1n) === 1n) {
      result = mulDec(result, cur, workScale);
    }
    e >>= 1n;
    if (e > 0n) cur = mulDec(cur, cur, workScale);
  }
  if (neg) {
    return divDec(ONE, result, currentScale);
  }
  return result;
}

function cmpDec(a: DecimalValue, b: DecimalValue): number {
  const { aCoeff, bCoeff } = alignDecimals(a, b);
  return aCoeff < bCoeff ? -1 : aCoeff > bCoeff ? 1 : 0;
}

function isNonZero(d: DecimalValue): boolean {
  return d.coeff !== 0n;
}

function sqrtDec(x: DecimalValue, currentScale: number): DecimalValue {
  if (x.coeff < 0n) throw new PublicDiagnostic("Runtime error: Square root of a negative number");
  if (x.coeff === 0n) return { coeff: 0n, scale: 0 };
  const resScale = Math.max(currentScale, x.scale);
  const shift = 2 * resScale - x.scale;
  const target = shift >= 0 ? x.coeff * pow10(shift) : x.coeff / pow10(-shift);
  if (target === 0n) return { coeff: 0n, scale: resScale };
  const low = 1n;
  const high = target;
  let guess = 1n << BigInt(Math.ceil(target.toString(2).length / 2));
  while (true) {
    const next = (guess + target / guess) >> 1n;
    if (next === guess || next === guess + 1n) {
      guess = ( guess + 1n ) * ( guess + 1n ) <= target ? guess + 1n : guess;
      break;
    }
    guess = next;
  }
  void low;
  void high;
  return { coeff: guess, scale: resScale };
}

function lengthDec(x: DecimalValue): DecimalValue {
  const absCoeff = x.coeff < 0n ? -x.coeff : x.coeff;
  if (absCoeff === 0n) return { coeff: BigInt(Math.max(1, x.scale)), scale: 0 };
  const digits = absCoeff.toString(10).length;
  return { coeff: BigInt(Math.max(digits, x.scale)), scale: 0 };
}

function parseLiteralInBase(raw: string, ibase: number): DecimalValue {
  const dot = raw.indexOf(".");
  const intPart = dot >= 0 ? raw.slice(0, dot) : raw;
  const fracPart = dot >= 0 ? raw.slice(dot + 1) : "";
  const scale = fracPart.length;
  const baseBig = BigInt(ibase);
  const digitVal = (ch: string): bigint => {
    const code = ch.charCodeAt(0);
    if (code >= 48 && code <= 57) return BigInt(code - 48);
    if (code >= 65 && code <= 70) return BigInt(code - 55);
    return 0n;
  };
  if (ibase === 10) {
    const combined = (intPart + fracPart) || "0";
    return { coeff: BigInt(combined), scale };
  }
  let intVal = 0n;
  for (const ch of intPart) {
    const d = digitVal(ch);
    intVal = intVal * baseBig + (d >= baseBig ? baseBig - 1n : d);
  }
  if (scale === 0) return { coeff: intVal, scale: 0 };
  let fracNum = 0n;
  let fracDen = 1n;
  for (const ch of fracPart) {
    const d = digitVal(ch);
    fracNum = fracNum * baseBig + (d >= baseBig ? baseBig - 1n : d);
    fracDen *= baseBig;
  }
  const scaledFrac = (fracNum * pow10(scale)) / fracDen;
  return { coeff: intVal * pow10(scale) + scaledFrac, scale };
}

function formatDecimalInBase(val: DecimalValue, obase: number): string {
  const neg = val.coeff < 0n;
  const absCoeff = neg ? -val.coeff : val.coeff;
  if (obase === 10) {
    if (val.scale <= 0) {
      return (neg && absCoeff !== 0n ? "-" : "") + absCoeff.toString(10);
    }
    const str = absCoeff.toString(10).padStart(val.scale + 1, "0");
    const intStr = str.slice(0, str.length - val.scale);
    const fracStr = str.slice(str.length - val.scale);
    const prefix = intStr === "0" ? "" : intStr;
    return (neg && absCoeff !== 0n ? "-" : "") + (prefix || (fracStr.length > 0 ? "" : "0")) + "." + fracStr;
  }
  const baseBig = BigInt(obase);
  const scaleFactor = pow10(val.scale);
  let intPart = absCoeff / scaleFactor;
  let rem = absCoeff % scaleFactor;
  const digits = "0123456789ABCDEF";
  let intOut = "";
  if (intPart === 0n) intOut = "0";
  else {
    while (intPart > 0n) {
      const d = Number(intPart % baseBig);
      intOut = (obase <= 16 ? digits[d]! : ` ${d.toString(10).padStart(2, "0")}`) + intOut;
      intPart /= baseBig;
    }
  }
  if (val.scale <= 0) {
    return (neg && absCoeff !== 0n ? "-" : "") + intOut.trimStart();
  }
  let fracOut = "";
  for (let i = 0; i < val.scale; i++) {
    rem *= baseBig;
    const d = Number(rem / scaleFactor);
    rem %= scaleFactor;
    fracOut += obase <= 16 ? digits[d]! : ` ${d.toString(10).padStart(2, "0")}`;
  }
  return (neg && absCoeff !== 0n ? "-" : "") + (intOut === "0" ? "" : intOut) + "." + fracOut;
}

function fromNumber(num: number, scale: number): DecimalValue {
  if (!Number.isFinite(num)) throw new PublicDiagnostic("math domain/range error");
  const clampedScale = Math.min(scale, 30);
  const fixed = num.toFixed(Math.min(clampedScale + 4, 20));
  const dot = fixed.indexOf(".");
  const neg = fixed.startsWith("-");
  const clean = neg ? fixed.slice(1) : fixed;
  const cleanDot = clean.indexOf(".");
  const intPart = cleanDot >= 0 ? clean.slice(0, cleanDot) : clean;
  let fracPart = cleanDot >= 0 ? clean.slice(cleanDot + 1) : "";
  if (fracPart.length < scale) fracPart = fracPart.padEnd(scale, "0");
  else if (fracPart.length > scale) fracPart = fracPart.slice(0, scale);
  void dot;
  const coeff = BigInt((intPart + fracPart) || "0");
  return { coeff: neg ? -coeff : coeff, scale };
}

function toNumber(val: DecimalValue): number {
  return Number(formatDecimalInBase(val, 10));
}

type Token =
  | { type: "number"; raw: string }
  | { type: "string"; value: string }
  | { type: "id"; name: string }
  | { type: "op"; value: string }
  | { type: "punct"; value: string };

function tokenizeBc(source: string): Token[] {
  const clean = source.replace(/\\\r?\n/gu, "");
  const tokens: Token[] = [];
  let i = 0;
  while (i < clean.length) {
    const ch = clean[i]!;
    if (ch === " " || ch === "\t" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "/" && clean[i + 1] === "*") {
      const end = clean.indexOf("*/", i + 2);
      if (end < 0) throw new PublicDiagnostic("unterminated comment");
      i = end + 2;
      continue;
    }
    if (ch === "#") {
      const end = clean.indexOf("\n", i + 1);
      i = end < 0 ? clean.length : end;
      continue;
    }
    if (ch === "\n" || ch === ";") {
      tokens.push({ type: "punct", value: ";" });
      i++;
      continue;
    }
    if (ch === '"') {
      let str = "";
      i++;
      while (i < clean.length && clean[i] !== '"') {
        if (clean[i] === "\\" && i + 1 < clean.length) {
          const esc = clean[i + 1]!;
          if (esc === "n") { str += "\n"; i += 2; continue; }
          if (esc === "t") { str += "\t"; i += 2; continue; }
          if (esc === '"') { str += '"'; i += 2; continue; }
          if (esc === "\\") { str += "\\"; i += 2; continue; }
        }
        str += clean[i++]!;
      }
      if (clean[i] === '"') i++;
      tokens.push({ type: "string", value: str });
      continue;
    }
    if ((ch >= "0" && ch <= "9") || (ch >= "A" && ch <= "F") || (ch === "." && i + 1 < clean.length && ((clean[i + 1]! >= "0" && clean[i + 1]! <= "9") || (clean[i + 1]! >= "A" && clean[i + 1]! <= "F")))) {
      let raw = "";
      let seenDot = false;
      while (i < clean.length) {
        const c = clean[i]!;
        if ((c >= "0" && c <= "9") || (c >= "A" && c <= "F")) {
          raw += c;
          i++;
        } else if (c === "." && !seenDot) {
          seenDot = true;
          raw += c;
          i++;
        } else {
          break;
        }
      }
      tokens.push({ type: "number", raw });
      continue;
    }
    if ((ch >= "a" && ch <= "z") || ch === "_") {
      let name = "";
      while (i < clean.length && ((clean[i]! >= "a" && clean[i]! <= "z") || (clean[i]! >= "0" && clean[i]! <= "9") || clean[i] === "_")) {
        name += clean[i++]!;
      }
      tokens.push({ type: "id", name });
      continue;
    }
    const two = clean.slice(i, i + 2);
    if (["++", "--", "+=", "-=", "*=", "/=", "%=", "^=", "==", "!=", "<=", ">=", "&&", "||"].includes(two)) {
      tokens.push({ type: "op", value: two });
      i += 2;
      continue;
    }
    if ("+-*/%^=<>!".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }
    if ("(){}[],.".includes(ch)) {
      tokens.push({ type: "punct", value: ch });
      i++;
      continue;
    }
    throw new PublicDiagnostic(`syntax error near '${ch}'`);
  }
  return tokens;
}

type Expr =
  | { kind: "num"; raw: string }
  | { kind: "str"; value: string }
  | { kind: "var"; name: string; index?: Expr }
  | { kind: "unary"; op: string; arg: Expr; prefix: boolean }
  | { kind: "binary"; op: string; left: Expr; right: Expr }
  | { kind: "assign"; op: string; target: { name: string; index?: Expr }; right: Expr }
  | { kind: "call"; name: string; args: Expr[] };

type Stmt =
  | { kind: "expr"; expr: Expr }
  | { kind: "print"; items: Expr[] }
  | { kind: "block"; stmts: Stmt[] }
  | { kind: "if"; cond: Expr; thenBranch: Stmt; elseBranch?: Stmt }
  | { kind: "while"; cond: Expr; body: Stmt }
  | { kind: "for"; init?: Expr; cond?: Expr; update?: Expr; body: Stmt }
  | { kind: "return"; value?: Expr }
  | { kind: "break" }
  | { kind: "continue" }
  | { kind: "halt" }
  | { kind: "auto"; names: string[] }
  | { kind: "define"; name: string; params: string[]; body: Stmt };

class BcParser {
  private pos = 0;
  constructor(private readonly tokens: readonly Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token | undefined {
    return this.tokens[this.pos++];
  }

  private matchPunct(v: string): boolean {
    const t = this.peek();
    if (t?.type === "punct" && t.value === v) {
      this.pos++;
      return true;
    }
    return false;
  }

  private matchId(name: string): boolean {
    const t = this.peek();
    if (t?.type === "id" && t.name === name) {
      this.pos++;
      return true;
    }
    return false;
  }

  parseProgram(): Stmt[] {
    const stmts: Stmt[] = [];
    while (this.pos < this.tokens.length) {
      while (this.matchPunct(";")) { /* Consume statement separators. */ }
      if (this.pos >= this.tokens.length) break;
      stmts.push(this.parseStmt());
      while (this.matchPunct(";")) { /* Consume statement separators. */ }
    }
    return stmts;
  }

  private parseStmt(): Stmt {
    if (this.matchPunct("{")) {
      const stmts: Stmt[] = [];
      while (this.pos < this.tokens.length && !this.matchPunct("}")) {
        while (this.matchPunct(";")) { /* Consume statement separators. */ }
        if (this.matchPunct("}")) break;
        stmts.push(this.parseStmt());
        while (this.matchPunct(";")) { /* Consume statement separators. */ }
      }
      return { kind: "block", stmts };
    }
    if (this.matchId("define")) {
      const nameTok = this.next();
      if (nameTok?.type !== "id") throw new PublicDiagnostic("expected function name after define");
      if (!this.matchPunct("(")) throw new PublicDiagnostic("expected '(' after function name");
      const params: string[] = [];
      if (!this.matchPunct(")")) {
        while (true) {
          const p = this.next();
          if (p?.type !== "id") throw new PublicDiagnostic("expected parameter name");
          params.push(p.name);
          if (this.matchPunct(")")) break;
          if (!this.matchPunct(",")) throw new PublicDiagnostic("expected ',' or ')' in parameter list");
        }
      }
      while (this.matchPunct(";")) { /* Consume statement separators. */ }
      const body = this.parseStmt();
      return { kind: "define", name: nameTok.name, params, body };
    }
    if (this.matchId("auto")) {
      const names: string[] = [];
      while (true) {
        const p = this.next();
        if (p?.type !== "id") throw new PublicDiagnostic("expected variable name in auto");
        if (this.matchPunct("[")) {
          this.matchPunct("]");
        }
        names.push(p.name);
        if (!this.matchPunct(",")) break;
      }
      return { kind: "auto", names };
    }
    if (this.matchId("if")) {
      if (!this.matchPunct("(")) throw new PublicDiagnostic("expected '(' after if");
      const cond = this.parseExpr();
      if (!this.matchPunct(")")) throw new PublicDiagnostic("expected ')' after if condition");
      while (this.matchPunct(";")) { /* Consume statement separators. */ }
      const thenBranch = this.parseStmt();
      while (this.matchPunct(";")) { /* Consume statement separators. */ }
      let elseBranch: Stmt | undefined;
      if (this.matchId("else")) {
        while (this.matchPunct(";")) { /* Consume statement separators. */ }
        elseBranch = this.parseStmt();
      }
      return { kind: "if", cond, thenBranch, ...(elseBranch ? { elseBranch } : {}) };
    }
    if (this.matchId("while")) {
      if (!this.matchPunct("(")) throw new PublicDiagnostic("expected '(' after while");
      const cond = this.parseExpr();
      if (!this.matchPunct(")")) throw new PublicDiagnostic("expected ')' after while condition");
      while (this.matchPunct(";")) { /* Consume statement separators. */ }
      const body = this.parseStmt();
      return { kind: "while", cond, body };
    }
    if (this.matchId("for")) {
      if (!this.matchPunct("(")) throw new PublicDiagnostic("expected '(' after for");
      const initToken = this.peek();
      const init = initToken?.type === "punct" && initToken.value === ";" ? undefined : this.parseExpr();
      if (!this.matchPunct(";")) throw new PublicDiagnostic("expected ';' in for");
      const condToken = this.peek();
      const cond = condToken?.type === "punct" && condToken.value === ";" ? undefined : this.parseExpr();
      if (!this.matchPunct(";")) throw new PublicDiagnostic("expected ';' in for");
      const updateToken = this.peek();
      const update = updateToken?.type === "punct" && updateToken.value === ")" ? undefined : this.parseExpr();
      if (!this.matchPunct(")")) throw new PublicDiagnostic("expected ')' after for clauses");
      while (this.matchPunct(";")) { /* Consume statement separators. */ }
      const body = this.parseStmt();
      return {
        kind: "for",
        ...(init ? { init } : {}),
        ...(cond ? { cond } : {}),
        ...(update ? { update } : {}),
        body,
      };
    }
    if (this.matchId("return")) {
      const next = this.peek();
      if (!next || (next.type === "punct" && (next.value === ";" || next.value === "}"))) {
        return { kind: "return" };
      }
      return { kind: "return", value: this.parseExpr() };
    }
    if (this.matchId("break")) return { kind: "break" };
    if (this.matchId("continue")) return { kind: "continue" };
    if (this.matchId("halt") || this.matchId("quit")) return { kind: "halt" };
    if (this.matchId("print")) {
      const items: Expr[] = [this.parseExpr()];
      while (this.matchPunct(",")) {
        items.push(this.parseExpr());
      }
      return { kind: "print", items };
    }
    return { kind: "expr", expr: this.parseExpr() };
  }

  private parseExpr(): Expr {
    return this.parseAssign();
  }

  private parseAssign(): Expr {
    const left = this.parseOr();
    const t = this.peek();
    if (t?.type === "op" && ["=", "+=", "-=", "*=", "/=", "%=", "^="].includes(t.value)) {
      if (left.kind !== "var") throw new PublicDiagnostic("invalid assignment target");
      this.pos++;
      const right = this.parseAssign();
      return { kind: "assign", op: t.value, target: { name: left.name, ...(left.index ? { index: left.index } : {}) }, right };
    }
    return left;
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (true) {
      const token = this.peek();
      if (!(token?.type === "op" && token.value === "||")) break;
      this.pos++;
      const op = token.value;
      left = { kind: "binary", op, left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseRel();
    while (true) {
      const token = this.peek();
      if (!(token?.type === "op" && token.value === "&&")) break;
      this.pos++;
      const op = token.value;
      left = { kind: "binary", op, left, right: this.parseRel() };
    }
    return left;
  }

  private parseRel(): Expr {
    let left = this.parseAdd();
    const t = this.peek();
    if (t?.type === "op" && ["==", "!=", "<=", ">=", "<", ">"].includes(t.value)) {
      this.pos++;
      left = { kind: "binary", op: t.value, left, right: this.parseAdd() };
    }
    return left;
  }

  private parseAdd(): Expr {
    let left = this.parseMul();
    while (true) {
      const token = this.peek();
      if (!(token?.type === "op" && (token.value === "+" || token.value === "-"))) break;
      this.pos++;
      const op = token.value;
      left = { kind: "binary", op, left, right: this.parseMul() };
    }
    return left;
  }

  private parseMul(): Expr {
    let left = this.parsePow();
    while (true) {
      const token = this.peek();
      if (!(token?.type === "op" && ["*", "/", "%"].includes(token.value ?? ""))) break;
      this.pos++;
      const op = token.value;
      left = { kind: "binary", op, left, right: this.parsePow() };
    }
    return left;
  }

  private parsePow(): Expr {
    const left = this.parseUnary();
    const token = this.peek();
    if (token?.type === "op" && token.value === "^") {
      this.pos++;
      return { kind: "binary", op: "^", left, right: this.parsePow() };
    }
    return left;
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (t?.type === "op" && ["-", "+", "!", "++", "--"].includes(t.value)) {
      this.pos++;
      return { kind: "unary", op: t.value, arg: this.parseUnary(), prefix: true };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();
    const t = this.peek();
    if (t?.type === "op" && (t.value === "++" || t.value === "--")) {
      this.pos++;
      expr = { kind: "unary", op: t.value, arg: expr, prefix: false };
    }
    return expr;
  }

  private parsePrimary(): Expr {
    const t = this.next();
    if (!t) throw new PublicDiagnostic("unexpected end of expression");
    if (t.type === "number") return { kind: "num", raw: t.raw };
    if (t.type === "string") return { kind: "str", value: t.value };
    if (t.type === "punct" && t.value === ".") return { kind: "var", name: "last" };
    if (t.type === "punct" && t.value === "(") {
      const expr = this.parseExpr();
      if (!this.matchPunct(")")) throw new PublicDiagnostic("expected ')'");
      return expr;
    }
    if (t.type === "id") {
      if (this.matchPunct("(")) {
        const args: Expr[] = [];
        if (!this.matchPunct(")")) {
          while (true) {
            args.push(this.parseExpr());
            if (this.matchPunct(")")) break;
            if (!this.matchPunct(",")) throw new PublicDiagnostic("expected ',' or ')' in function call");
          }
        }
        return { kind: "call", name: t.name, args };
      }
      if (this.matchPunct("[")) {
        const index = this.parseExpr();
        if (!this.matchPunct("]")) throw new PublicDiagnostic("expected ']'");
        return { kind: "var", name: t.name, index };
      }
      return { kind: "var", name: t.name };
    }
    throw new PublicDiagnostic(`unexpected token '${t.value}'`);
  }
}

class FlowSignal {
  constructor(readonly kind: "break" | "continue" | "return" | "halt", readonly value?: DecimalValue) {}
}

export function createBcCommand(options: BcCommandOptions = {}): CommandDefinition {
  const maxSteps = options.maxSteps ?? 250_000;
  const maxScale = options.maxScale ?? 2_000;
  const maxInputBytes = options.maxInputBytes ?? 8 * 1024 * 1024;

  return define("bc", async context => {
    let mathlib = false;
    const files: string[] = [];
    let ended = false;
    for (const arg of context.args) {
      if (ended) {
        files.push(arg);
        continue;
      }
      if (arg === "--") {
        ended = true;
        continue;
      }
      if (arg === "--mathlib") {
        mathlib = true;
        continue;
      }
      if (arg === "--quiet" || arg === "--interactive" || arg === "--warn" || arg === "--standard") {
        continue;
      }
      if (arg.startsWith("-") && arg.length > 1) {
        for (let i = 1; i < arg.length; i++) {
          const f = arg[i]!;
          if (f === "l") mathlib = true;
          else if (f === "q" || f === "i" || f === "w" || f === "s") continue;
          else throw new UsageError(`invalid option -- '${f}'`);
        }
        continue;
      }
      files.push(arg);
    }

    const sources: string[] = [];
    if (files.length === 0) {
      sources.push(decoder.decode(await collectSourceBytes(input(context, "-"), context.signal, maxInputBytes)));
    } else {
      for (const file of files) {
        sources.push(decoder.decode(await collectSourceBytes(input(context, file), context.signal, maxInputBytes)));
      }
    }
    const fullProgram = sources.join("\n");
    if (Buffer.byteLength(fullProgram) > maxInputBytes) {
      throw new PublicDiagnostic(`bc program exceeds maximum input size (${maxInputBytes} bytes)`);
    }

    const stmts = new BcParser(tokenizeBc(fullProgram)).parseProgram();
    let scale = mathlib ? 20 : 0;
    let ibase = 10;
    let obase = 10;
    let last: DecimalValue = ZERO;
    const globals = new Map<string, DecimalValue>();
    const arrays = new Map<string, Map<string, DecimalValue>>();
    const funcs = new Map<string, { params: string[]; body: Stmt }>();
    const callStack: Map<string, DecimalValue>[] = [];
    let steps = 0;
    let outBuffer = "";

    const tick = async (): Promise<void> => {
      if (++steps > maxSteps) throw new PublicDiagnostic(`bc execution exceeded maximum step limit (${maxSteps})`);
      if ((steps & 1023) === 0) {
        await yieldTurn();
        context.signal.throwIfAborted();
      }
    };

    const getVar = async (name: string, indexExpr?: Expr): Promise<DecimalValue> => {
      if (indexExpr) {
        const idxVal = await evalExpr(indexExpr);
        const key = truncToInt(idxVal).toString(10);
        return arrays.get(name)?.get(key) ?? ZERO;
      }
      if (name === "scale") return { coeff: BigInt(scale), scale: 0 };
      if (name === "ibase") return { coeff: BigInt(ibase), scale: 0 };
      if (name === "obase") return { coeff: BigInt(obase), scale: 0 };
      if (name === "last") return last;
      for (let i = callStack.length - 1; i >= 0; i--) {
        const frame = callStack[i]!;
        if (frame.has(name)) return frame.get(name)!;
      }
      return globals.get(name) ?? ZERO;
    };

    const setVar = async (name: string, indexExpr: Expr | undefined, val: DecimalValue): Promise<DecimalValue> => {
      if (indexExpr) {
        const idxVal = await evalExpr(indexExpr);
        const key = truncToInt(idxVal).toString(10);
        let map = arrays.get(name);
        if (!map) {
          map = new Map();
          arrays.set(name, map);
        }
        map.set(key, val);
        return val;
      }
      if (name === "scale") {
        const s = Number(truncToInt(val));
        if (s < 0 || s > maxScale) throw new PublicDiagnostic(`scale (${s}) out of bounds [0, ${maxScale}]`);
        scale = s;
        return { coeff: BigInt(scale), scale: 0 };
      }
      if (name === "ibase") {
        const b = Number(truncToInt(val));
        if (b < 2 || b > 16) throw new PublicDiagnostic(`ibase (${b}) must be between 2 and 16`);
        ibase = b;
        return { coeff: BigInt(ibase), scale: 0 };
      }
      if (name === "obase") {
        const b = Number(truncToInt(val));
        if (b < 2 || b > 1000) throw new PublicDiagnostic(`obase (${b}) out of bounds`);
        obase = b;
        return { coeff: BigInt(obase), scale: 0 };
      }
      if (name === "last") {
        last = val;
        return val;
      }
      for (let i = callStack.length - 1; i >= 0; i--) {
        const frame = callStack[i]!;
        if (frame.has(name)) {
          frame.set(name, val);
          return val;
        }
      }
      globals.set(name, val);
      return val;
    };

    const evalExpr = async (expr: Expr): Promise<DecimalValue> => {
      await tick();
      switch (expr.kind) {
        case "num":
          return parseLiteralInBase(expr.raw, ibase);
        case "str":
          outBuffer += expr.value;
          return ZERO;
        case "var":
          return getVar(expr.name, expr.index);
        case "assign": {
          const r = await evalExpr(expr.right);
          if (expr.op === "=") return setVar(expr.target.name, expr.target.index, r);
          const cur = await getVar(expr.target.name, expr.target.index);
          let next: DecimalValue;
          if (expr.op === "+=") next = addDec(cur, r);
          else if (expr.op === "-=") next = subDec(cur, r);
          else if (expr.op === "*=") next = mulDec(cur, r, scale);
          else if (expr.op === "/=") next = divDec(cur, r, scale);
          else if (expr.op === "%=") next = modDec(cur, r, scale);
          else next = powDec(cur, r, scale);
          return setVar(expr.target.name, expr.target.index, next);
        }
        case "unary": {
          if (expr.op === "++" || expr.op === "--") {
            if (expr.arg.kind !== "var") throw new PublicDiagnostic("invalid increment/decrement target");
            const cur = await getVar(expr.arg.name, expr.arg.index);
            const next = expr.op === "++" ? addDec(cur, ONE) : subDec(cur, ONE);
            await setVar(expr.arg.name, expr.arg.index, next);
            return expr.prefix ? next : cur;
          }
          const v = await evalExpr(expr.arg);
          if (expr.op === "-") return { coeff: -v.coeff, scale: v.scale };
          if (expr.op === "+") return v;
          if (expr.op === "!") return isNonZero(v) ? ZERO : ONE;
          return v;
        }
        case "binary": {
          if (expr.op === "&&") {
            const l = await evalExpr(expr.left);
            if (!isNonZero(l)) return ZERO;
            const r = await evalExpr(expr.right);
            return isNonZero(r) ? ONE : ZERO;
          }
          if (expr.op === "||") {
            const l = await evalExpr(expr.left);
            if (isNonZero(l)) return ONE;
            const r = await evalExpr(expr.right);
            return isNonZero(r) ? ONE : ZERO;
          }
          const l = await evalExpr(expr.left);
          const r = await evalExpr(expr.right);
          switch (expr.op) {
            case "+": return addDec(l, r);
            case "-": return subDec(l, r);
            case "*": return mulDec(l, r, scale);
            case "/": return divDec(l, r, scale);
            case "%": return modDec(l, r, scale);
            case "^": return powDec(l, r, scale);
            case "==": return cmpDec(l, r) === 0 ? ONE : ZERO;
            case "!=": return cmpDec(l, r) !== 0 ? ONE : ZERO;
            case "<": return cmpDec(l, r) < 0 ? ONE : ZERO;
            case "<=": return cmpDec(l, r) <= 0 ? ONE : ZERO;
            case ">": return cmpDec(l, r) > 0 ? ONE : ZERO;
            case ">=": return cmpDec(l, r) >= 0 ? ONE : ZERO;
          }
          return ZERO;
        }
        case "call": {
          const args: DecimalValue[] = [];
          for (const a of expr.args) args.push(await evalExpr(a));
          const arg0 = args[0] ?? ZERO;
          if (expr.name === "sqrt") return sqrtDec(arg0, scale);
          if (expr.name === "scale") return { coeff: BigInt(arg0.scale), scale: 0 };
          if (expr.name === "length") return lengthDec(arg0);
          if (expr.name === "abs") return { coeff: arg0.coeff < 0n ? -arg0.coeff : arg0.coeff, scale: arg0.scale };
          if (mathlib) {
            if (expr.name === "s") return fromNumber(Math.sin(toNumber(arg0)), scale);
            if (expr.name === "c") return fromNumber(Math.cos(toNumber(arg0)), scale);
            if (expr.name === "a") return fromNumber(Math.atan(toNumber(arg0)), scale);
            if (expr.name === "l") {
              const x = toNumber(arg0);
              if (x <= 0) throw new PublicDiagnostic("Runtime error: l(x) domain error");
              return fromNumber(Math.log(x), scale);
            }
            if (expr.name === "e") return fromNumber(Math.exp(toNumber(arg0)), scale);
          }
          const fn = funcs.get(expr.name);
          if (!fn) throw new PublicDiagnostic(`Function ${expr.name} not defined.`);
          if (callStack.length >= 64) throw new PublicDiagnostic("bc function recursion depth exceeded (64)");
          const frame = new Map<string, DecimalValue>();
          for (let i = 0; i < fn.params.length; i++) {
            frame.set(fn.params[i]!, args[i] ?? ZERO);
          }
          callStack.push(frame);
          try {
            await execStmt(fn.body);
            return ZERO;
          } catch (sig) {
            if (sig instanceof FlowSignal && sig.kind === "return") {
              return sig.value ?? ZERO;
            }
            throw sig;
          } finally {
            callStack.pop();
          }
        }
      }
    };

    const execStmt = async (stmt: Stmt): Promise<void> => {
      await tick();
      switch (stmt.kind) {
        case "define":
          funcs.set(stmt.name, { params: stmt.params, body: stmt.body });
          return;
        case "auto": {
          const frame = callStack.at(-1);
          if (frame) {
            for (const name of stmt.names) {
              if (!frame.has(name)) frame.set(name, ZERO);
            }
          }
          return;
        }
        case "block":
          for (const s of stmt.stmts) await execStmt(s);
          return;
        case "if":
          if (isNonZero(await evalExpr(stmt.cond))) {
            await execStmt(stmt.thenBranch);
          } else if (stmt.elseBranch) {
            await execStmt(stmt.elseBranch);
          }
          return;
        case "while":
          while (isNonZero(await evalExpr(stmt.cond))) {
            try {
              await execStmt(stmt.body);
            } catch (sig) {
              if (sig instanceof FlowSignal) {
                if (sig.kind === "break") break;
                if (sig.kind === "continue") continue;
              }
              throw sig;
            }
          }
          return;
        case "for":
          if (stmt.init) await evalExpr(stmt.init);
          while (!stmt.cond || isNonZero(await evalExpr(stmt.cond))) {
            try {
              await execStmt(stmt.body);
            } catch (sig) {
              if (sig instanceof FlowSignal) {
                if (sig.kind === "break") break;
                if (sig.kind === "continue") {
                  if (stmt.update) await evalExpr(stmt.update);
                  continue;
                }
              }
              throw sig;
            }
            if (stmt.update) await evalExpr(stmt.update);
          }
          return;
        case "print":
          for (const item of stmt.items) {
            if (item.kind === "str") {
              outBuffer += item.value;
            } else {
              const v = await evalExpr(item);
              last = v;
              outBuffer += formatDecimalInBase(v, obase);
            }
          }
          return;
        case "return":
          throw new FlowSignal("return", stmt.value ? await evalExpr(stmt.value) : ZERO);
        case "break":
          throw new FlowSignal("break");
        case "continue":
          throw new FlowSignal("continue");
        case "halt":
          throw new FlowSignal("halt");
        case "expr": {
          if (stmt.expr.kind === "str") {
            outBuffer += stmt.expr.value;
            return;
          }
          const val = await evalExpr(stmt.expr);
          if (stmt.expr.kind !== "assign") {
            last = val;
            outBuffer += formatDecimalInBase(val, obase) + "\n";
          }
          return;
        }
      }
    };

    try {
      for (const s of stmts) {
        await execStmt(s);
      }
    } catch (sig) {
      if (!(sig instanceof FlowSignal && sig.kind === "halt")) {
        throw sig;
      }
    }

    if (outBuffer.length > 0) {
      await output(context, outBuffer);
    }
    return { exitCode: 0 };
  });
}

export function bcCommands(options: BcCommandOptions = {}): VirtualShellPlugin {
  const command = createBcCommand(options);
  return {
    name: "bc-commands",
    setup(host) {
      if (!options.replace && host.commands.has(command.name)) {
        throw new Error(`Command already registered: ${command.name}`);
      }
      host.commands.register(command, { replace: options.replace ?? false });
    },
  };
}
