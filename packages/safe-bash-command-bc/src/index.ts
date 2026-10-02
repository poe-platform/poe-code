import { mathValue } from "./math.js";
import {
  commandRuntimeIdentity,
  readBytes,
  writeText,
  type ByteSource,
  type CommandContext,
  type CommandDefinition,
  type CommandResult,
  type VirtualShellPlugin,
} from "safe-bash-contracts";

const decoder = new TextDecoder("utf-8", { fatal: false });
const encoder = new TextEncoder();
async function yieldTurn(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  signal.throwIfAborted();
}

const pathPosix = {
  resolve(cwd: string, target: string): string {
    const raw = target.startsWith("/") ? target : (cwd.endsWith("/") ? cwd + target : cwd + "/" + target);
    const parts = raw.split("/");
    const stack: string[] = [];
    for (const part of parts) {
      if (!part || part === ".") continue;
      if (part === "..") stack.pop();
      else stack.push(part);
    }
    return "/" + stack.join("/");
  },
};

class UsageError extends Error {
  constructor(message: string) {
    super(message);
  }
}

async function collectSourceBytes(source: ByteSource, signal: AbortSignal, maxBytes: number, admit: (bytes: number) => void): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of readBytes(source, signal)) {
    total += chunk.byteLength;
    admit(chunk.byteLength);
    if (total > maxBytes) throw new Error(`input exceeds maximum size (${maxBytes} bytes)`);
    chunks.push(chunk);
  }
  if (chunks.length === 1) return chunks[0]!;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export interface BcLimits {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxSteps: number;
  readonly maxScale: number;
  readonly maxExponent: number;
  readonly maxRecursionDepth: number;
  readonly maxObase: number;
}

export interface BcCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<BcLimits>;
  readonly maxInputBytes?: number;
  readonly maxOutputBytes?: number;
  readonly maxSteps?: number;
  readonly maxScale?: number;
  readonly maxExponent?: number;
  readonly maxRecursionDepth?: number;
  readonly maxObase?: number;
}

export type BcCommandOptions = BcCommandsOptions;
export type BcOptions = BcCommandsOptions;

export function settings(options: BcCommandsOptions = {}): BcLimits {
  const limits: BcLimits = {
    maxInputBytes: options.limits?.maxInputBytes ?? options.maxInputBytes ?? Infinity,
    maxOutputBytes: options.limits?.maxOutputBytes ?? options.maxOutputBytes ?? Infinity,
    maxSteps: options.limits?.maxSteps ?? options.maxSteps ?? Infinity,
    maxScale: options.limits?.maxScale ?? options.maxScale ?? Infinity,
    maxExponent: options.limits?.maxExponent ?? options.maxExponent ?? Infinity,
    maxRecursionDepth: options.limits?.maxRecursionDepth ?? options.maxRecursionDepth ?? Infinity,
    maxObase: options.limits?.maxObase ?? options.maxObase ?? Infinity,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) throw new RangeError(`Invalid bc limit: ${name}`);
  }
  return Object.freeze(limits);
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
  if (b.coeff === 0n) throw new Error("Runtime error (func=(main), adr=0): Divide by zero");
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

async function powDec(base: DecimalValue, exp: DecimalValue, currentScale: number, maxExponent: number, tick: () => Promise<void> | undefined): Promise<DecimalValue> {
  let n = truncToInt(exp);
  if (n === 0n) return ONE;
  const neg = n < 0n;
  if (neg) n = -n;
  if (maxExponent !== Infinity && n > BigInt(maxExponent)) throw new Error(`exponent exceeds maximum limit (${maxExponent})`);
  // Keep the coefficient exact; rounding intermediate squares loses carries.
  let coeff = 1n;
  let factor = base.coeff;
  for (let remaining = n; remaining > 0n; remaining >>= 1n) {
    const pending = tick(); if (pending) await pending;
    if (remaining & 1n) coeff *= factor;
    if (remaining > 1n) factor *= factor;
  }
  const fullScale = BigInt(base.scale) * n;
  if (neg) {
    if (coeff === 0n) throw new Error("Runtime error (func=(main), adr=0): Divide by zero");
    return { coeff: 10n ** (BigInt(currentScale) + fullScale) / coeff, scale: currentScale };
  }
  const scaleLimit = BigInt(Math.max(currentScale, base.scale));
  const resultScale = fullScale < scaleLimit ? fullScale : scaleLimit;
  return { coeff: coeff / (10n ** (fullScale - resultScale)), scale: Number(resultScale) };
}

function cmpDec(a: DecimalValue, b: DecimalValue): number {
  const { aCoeff, bCoeff } = alignDecimals(a, b);
  return aCoeff < bCoeff ? -1 : aCoeff > bCoeff ? 1 : 0;
}

function isNonZero(d: DecimalValue): boolean {
  return d.coeff !== 0n;
}

function sqrtDec(x: DecimalValue, currentScale: number): DecimalValue {
  if (x.coeff < 0n) throw new Error("Runtime error: Square root of a negative number");
  if (x.coeff === 0n) return { coeff: 0n, scale: 0 };
  const resScale = Math.max(currentScale, x.scale);
  const shift = 2 * resScale - x.scale;
  const target = shift >= 0 ? x.coeff * pow10(shift) : x.coeff / pow10(-shift);
  if (target === 0n) return { coeff: 0n, scale: resScale };
  let guess = 1n << BigInt(Math.ceil(target.toString(2).length / 2));
  while (true) {
    const next = (guess + target / guess) >> 1n;
    if (next === guess || next === guess + 1n) {
      guess = ( guess + 1n ) * ( guess + 1n ) <= target ? guess + 1n : guess;
      break;
    }
    guess = next;
  }
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
  // POSIX single-digit integers retain their value regardless of ibase.
  if (raw.length === 1 && dot < 0) return { coeff: digitVal(raw), scale: 0 };
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

function formatDecimalInBase(val: DecimalValue, obase: bigint): string {
  const neg = val.coeff < 0n;
  const absCoeff = neg ? -val.coeff : val.coeff;
  if (absCoeff === 0n) return "0";
  if (obase === 10n) {
    if (val.scale <= 0) {
      return (neg && absCoeff !== 0n ? "-" : "") + absCoeff.toString(10);
    }
    const str = absCoeff.toString(10).padStart(val.scale + 1, "0");
    const intStr = str.slice(0, str.length - val.scale);
    const fracStr = str.slice(str.length - val.scale);
    const prefix = intStr === "0" ? "" : intStr;
    return (neg && absCoeff !== 0n ? "-" : "") + (prefix || (fracStr.length > 0 ? "" : "0")) + "." + fracStr;
  }
  const scaleFactor = pow10(val.scale);
  let intPart = absCoeff / scaleFactor;
  let rem = absCoeff % scaleFactor;
  const digits = "0123456789ABCDEF";
  const digitWidth = (obase - 1n).toString(10).length;
  let intOut = "";
  if (intPart === 0n) intOut = "0";
  else {
    while (intPart > 0n) {
      const d = intPart % obase;
      intOut = (obase <= 16n ? digits[Number(d)]! : ` ${d.toString(10).padStart(digitWidth, "0")}`) + intOut;
      intPart /= obase;
    }
  }
  if (val.scale <= 0) {
    return (neg && absCoeff !== 0n ? "-" : "") + intOut;
  }
  let fracOut = "";
  for (let place = 1n; place < scaleFactor; place *= obase) {
    rem *= obase;
    const d = rem / scaleFactor;
    rem %= scaleFactor;
    fracOut += obase <= 16n ? digits[Number(d)]! : `${fracOut ? " " : ""}${d.toString(10).padStart(digitWidth, "0")}`;
  }
  return (neg && absCoeff !== 0n ? "-" : "") + (intOut === "0" ? "" : intOut) + "." + fracOut;
}

interface Token {
  type: "number" | "string" | "id" | "op" | "punct" | "semi" | "eof";
  raw?: string;
  value?: string;
  name?: string;
}

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
      if (end < 0) throw new Error("unterminated comment");
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
    throw new Error(`syntax error near '${ch}'`);
  }
  return tokens;
}

type Expr =
  | { kind: "num"; raw: string }
  | { kind: "str"; value: string }
  | { kind: "array"; name: string }
  | { kind: "var"; name: string; index?: Expr }
  | { kind: "unary"; op: string; arg: Expr; prefix: boolean }
  | { kind: "binary"; op: string; left: Expr; right: Expr }
  | { kind: "assign"; parenthesized?: boolean; op: string; target: { name: string; index?: Expr }; right: Expr }
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
  | { kind: "auto"; names: { name: string; array: boolean }[] }
  | { kind: "define"; name: string; params: { name: string; array: boolean }[]; body: Stmt };

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
    if (t?.type === "punct" && (t.value ?? "") === v) {
      this.pos++;
      return true;
    }
    return false;
  }

  private matchId(name: string): boolean {
    const t = this.peek();
    if (t?.type === "id" && (t.name ?? "") === name) {
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
      if (nameTok?.type !== "id") throw new Error("expected function name after define");
      if (!this.matchPunct("(")) throw new Error("expected '(' after function name");
      const params: { name: string; array: boolean }[] = [];
      if (!this.matchPunct(")")) {
        while (true) {
          const p = this.next();
          if (p?.type !== "id") throw new Error("expected parameter name");
          const array = this.matchPunct("[");
          if (array && !this.matchPunct("]")) throw new Error("expected ']' in parameter list");
          params.push({ name: p.name ?? "", array });
          if (this.matchPunct(")")) break;
          if (!this.matchPunct(",")) throw new Error("expected ',' or ')' in parameter list");
        }
      }
      while (this.matchPunct(";")) { /* Consume statement separators. */ }
      const body = this.parseStmt();
      return { kind: "define", name: nameTok.name ?? "", params, body };
    }
    if (this.matchId("auto")) {
      const names: { name: string; array: boolean }[] = [];
      while (true) {
        const p = this.next();
        if (p?.type !== "id") throw new Error("expected variable name in auto");
        const array = this.matchPunct("[");
        if (array && !this.matchPunct("]")) throw new Error("expected ']' in auto");
        names.push({ name: p.name ?? "", array });
        if (!this.matchPunct(",")) break;
      }
      return { kind: "auto", names };
    }
    if (this.matchId("if")) {
      if (!this.matchPunct("(")) throw new Error("expected '(' after if");
      const cond = this.parseExpr();
      if (!this.matchPunct(")")) throw new Error("expected ')' after if condition");
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
      if (!this.matchPunct("(")) throw new Error("expected '(' after while");
      const cond = this.parseExpr();
      if (!this.matchPunct(")")) throw new Error("expected ')' after while condition");
      while (this.matchPunct(";")) { /* Consume statement separators. */ }
      const body = this.parseStmt();
      return { kind: "while", cond, body };
    }
    if (this.matchId("for")) {
      if (!this.matchPunct("(")) throw new Error("expected '(' after for");
      const init = this.peek()?.type === "punct" && this.peek()?.value === ";" ? undefined : this.parseExpr();
      if (!this.matchPunct(";")) throw new Error("expected ';' in for");
      const cond = this.peek()?.type === "punct" && this.peek()?.value === ";" ? undefined : this.parseExpr();
      if (!this.matchPunct(";")) throw new Error("expected ';' in for");
      const update = this.peek()?.type === "punct" && this.peek()?.value === ")" ? undefined : this.parseExpr();
      if (!this.matchPunct(")")) throw new Error("expected ')' after for clauses");
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
      if (!next || (next.type === "punct" && ((next.value ?? "") === ";" || (next.value ?? "") === "}"))) {
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
    if (t?.type === "op" && ["=", "+=", "-=", "*=", "/=", "%=", "^="].includes((t.value ?? ""))) {
      if (left.kind !== "var") throw new Error("invalid assignment target");
      this.pos++;
      const right = this.parseAssign();
      return { kind: "assign", op: (t.value ?? ""), target: { name: ("name" in left ? left.name : ""), ...(left.index ? { index: left.index } : {}) }, right };
    }
    return left;
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.peek()?.type === "op" && this.peek()?.value === "||") {
      const op = this.next()!.value as string;
      left = { kind: "binary", op, left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseRel();
    while (this.peek()?.type === "op" && this.peek()?.value === "&&") {
      const op = this.next()!.value as string;
      left = { kind: "binary", op, left, right: this.parseRel() };
    }
    return left;
  }

  private parseRel(): Expr {
    let left = this.parseAdd();
    const t = this.peek();
    if (t?.type === "op" && ["==", "!=", "<=", ">=", "<", ">"].includes((t.value ?? ""))) {
      this.pos++;
      left = { kind: "binary", op: (t.value ?? ""), left, right: this.parseAdd() };
    }
    return left;
  }

  private parseAdd(): Expr {
    let left = this.parseMul();
    while (this.peek()?.type === "op" && (this.peek()?.value === "+" || this.peek()?.value === "-")) {
      const op = this.next()!.value as string;
      left = { kind: "binary", op, left, right: this.parseMul() };
    }
    return left;
  }

  private parseMul(): Expr {
    let left = this.parsePow();
    while (this.peek()?.type === "op" && ["*", "/", "%"].includes(this.peek()?.value ?? "")) {
      const op = this.next()!.value as string;
      left = { kind: "binary", op, left, right: this.parsePow() };
    }
    return left;
  }

  private parsePow(): Expr {
    const left = this.parseUnary();
    if (this.peek()?.type === "op" && this.peek()?.value === "^") {
      this.pos++;
      return { kind: "binary", op: "^", left, right: this.parsePow() };
    }
    return left;
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (t?.type === "op" && ["-", "+", "!", "++", "--"].includes((t.value ?? ""))) {
      this.pos++;
      return { kind: "unary", op: (t.value ?? ""), arg: this.parseUnary(), prefix: true };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();
    const t = this.peek();
    if (t?.type === "op" && ((t.value ?? "") === "++" || (t.value ?? "") === "--")) {
      this.pos++;
      expr = { kind: "unary", op: (t.value ?? ""), arg: expr, prefix: false };
    }
    return expr;
  }

  private parsePrimary(): Expr {
    const t = this.next();
    if (!t) throw new Error("unexpected end of expression");
    if (t.type === "number") return { kind: "num", raw: (t.raw ?? "") };
    if (t.type === "string") return { kind: "str", value: (t.value ?? "") };
    if (t.type === "punct" && (t.value ?? "") === ".") return { kind: "var", name: "last" };
    if (t.type === "punct" && (t.value ?? "") === "(") {
      const expr = this.parseExpr();
      if (!this.matchPunct(")")) throw new Error("expected ')'");
      return expr.kind === "assign" ? { ...expr, parenthesized: true } : expr;
    }
    if (t.type === "id") {
      if (this.matchPunct("(")) {
        const args: Expr[] = [];
        if (!this.matchPunct(")")) {
          while (true) {
            args.push(this.parseExpr());
            if (this.matchPunct(")")) break;
            if (!this.matchPunct(",")) throw new Error("expected ',' or ')' in function call");
          }
        }
        return { kind: "call", name: (t.name ?? ""), args };
      }
      if (this.matchPunct("[")) {
        if (this.matchPunct("]")) return { kind: "array", name: t.name ?? "" };
        const index = this.parseExpr();
        if (!this.matchPunct("]")) throw new Error("expected ']'");
        return { kind: "var", name: (t.name ?? ""), index };
      }
      return { kind: "var", name: (t.name ?? "") };
    }
    throw new Error(`unexpected token '${"value" in t ? (t.value ?? "") : "raw" in t ? (t.raw ?? "") : (t.name ?? "")}'`);
  }
}

class FlowSignal {
  constructor(readonly kind: "break" | "continue" | "return" | "halt", readonly value?: DecimalValue) {}
}

export function createBcCommand(options: BcCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  const maxSteps = limits.maxSteps;
  const maxScale = limits.maxScale;
  const maxInputBytes = limits.maxInputBytes;

  return {
    name: "bc",
    description: "Arbitrary-precision calculator language",
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context: CommandContext): Promise<CommandResult> {
      let inputBytes = 0;
      const admit = (bytes: number): void => {
        context.signal.throwIfAborted();
        context.inputBudget?.check(inputBytes += bytes);
      };
      context.signal.throwIfAborted();
      try {
    let mathlib = false;
    const files: string[] = [];
    const expressions: string[] = [];
    let ended = false;
    for (let idx = 0; idx < context.args.length; idx++) {
      const arg = context.args[idx]!;
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
      if (arg === "--expression") {
        expressions.push(context.args[++idx] ?? "");
        continue;
      }
      if (arg.startsWith("--expression=")) {
        expressions.push(arg.slice("--expression=".length));
        continue;
      }
      if (arg === "--quiet" || arg === "--interactive" || arg === "--warn" || arg === "--standard") {
        continue;
      }
      if (arg.startsWith("-") && arg.length > 1) {
        for (let i = 1; i < arg.length; i++) {
          const f = arg[i]!;
          if (f === "l") mathlib = true;
          else if (f === "e") {
            const rest = i < arg.length - 1 ? arg.slice(i + 1) : (context.args[++idx] ?? "");
            expressions.push(rest);
            break;
          } else if (f === "q" || f === "i" || f === "w" || f === "s") continue;
          else throw new UsageError(`invalid option -- '${f}'`);
        }
        continue;
      }
      files.push(arg);
    }

    const sources: string[] = [...expressions];
    if (files.length === 0 && expressions.length === 0) {
      sources.push(decoder.decode(await collectSourceBytes(context.stdin, context.signal, maxInputBytes, admit)));
    } else if (files.length > 0) {
      for (const file of files) {
        if (file === "-") {
          sources.push(decoder.decode(await collectSourceBytes(context.stdin, context.signal, maxInputBytes, admit)));
        } else {
          const raw = await context.fs.readFile(pathPosix.resolve(context.cwd, file), { signal: context.signal });
          context.signal.throwIfAborted();
          admit(raw.byteLength);
          if (raw.byteLength > maxInputBytes) throw new Error(`bc program exceeds maximum input size (${maxInputBytes} bytes)`);
          sources.push(decoder.decode(raw));
        }
      }
    }
    const fullProgram = sources.join("\n");
    if (encoder.encode(fullProgram).byteLength > maxInputBytes) {
      throw new Error(`bc program exceeds maximum input size (${maxInputBytes} bytes)`);
    }

    const stmts = new BcParser(tokenizeBc(fullProgram)).parseProgram();
    let scale = mathlib ? 20 : 0;
    let ibase = 10;
    let obase = 10n;
    let last: DecimalValue = ZERO;
    const globals = new Map<string, DecimalValue>();
    const arrays = new Map<string, Map<string, DecimalValue>>();
    const funcs = new Map<string, { params: { name: string; array: boolean }[]; body: Stmt }>();
    const callStack: { scalars: Map<string, DecimalValue>; arrays: Map<string, Map<string, DecimalValue>> }[] = [];
    let steps = 0;
    let outBuffer = "";
    let outputBytes = 0;
    const configuredWidth = Number(context.env.BC_LINE_LENGTH ?? 70);
    const lineLength = Number.isSafeInteger(configuredWidth) && (configuredWidth === 0 || configuredWidth > 1) ? configuredWidth : 70;
    let outputColumn = 0;

    const appendOutput = (text: string): void => {
      if (limits.maxOutputBytes !== Infinity) {
        outputBytes += encoder.encode(text).byteLength;
        if (outputBytes > limits.maxOutputBytes) {
          throw new Error(`output exceeds maximum size (${limits.maxOutputBytes} bytes)`);
        }
      }
      outBuffer += text;
      const newline = text.lastIndexOf("\n");
      outputColumn = newline < 0 ? outputColumn + text.length : text.length - newline - 1;
    };

    const appendNumber = (value: DecimalValue): void => {
      let text = formatDecimalInBase(value, obase);
      if (lineLength !== 0) {
        while (outputColumn + text.length >= lineLength) {
          const count = Math.max(0, lineLength - outputColumn - 1);
          appendOutput(text.slice(0, count) + "\\\n");
          text = text.slice(count);
        }
      }
      appendOutput(text);
    };

    const tick = (): Promise<void> | undefined => {
      context.signal.throwIfAborted();
      if (++steps > maxSteps) throw new Error(`bc execution exceeded maximum step limit (${maxSteps})`);
      if ((steps & 4095) === 0) {
        return yieldTurn(context.signal);
      }
      return undefined;
    };

    const getArray = (name: string): Map<string, DecimalValue> => {
      for (let i = callStack.length - 1; i >= 0; i--) {
        const local = callStack[i]!.arrays.get(name);
        if (local) return local;
      }
      let array = arrays.get(name);
      if (!array) {
        array = new Map();
        arrays.set(name, array);
      }
      return array;
    };

    const getVar = async (name: string, indexExpr?: Expr): Promise<DecimalValue> => {
      if (indexExpr) {
        const idxVal = await evalExpr(indexExpr);
        const key = truncToInt(idxVal).toString(10);
        return getArray(name).get(key) ?? ZERO;
      }
      if (name === "scale") return { coeff: BigInt(scale), scale: 0 };
      if (name === "ibase") return { coeff: BigInt(ibase), scale: 0 };
      if (name === "obase") return { coeff: obase, scale: 0 };
      if (name === "last") return last;
      for (let i = callStack.length - 1; i >= 0; i--) {
        const frame = callStack[i]!.scalars;
        if (frame.has(name)) return frame.get(name)!;
      }
      return globals.get(name) ?? ZERO;
    };

    const setVar = async (name: string, indexExpr: Expr | undefined, val: DecimalValue): Promise<DecimalValue> => {
      if (indexExpr) {
        const idxVal = await evalExpr(indexExpr);
        const key = truncToInt(idxVal).toString(10);
        getArray(name).set(key, val);
        return val;
      }
      if (name === "scale") {
        const s = Number(truncToInt(val));
        if (s < 0 || s > maxScale) throw new Error(`scale (${s}) out of bounds [0, ${maxScale}]`);
        scale = s;
        return { coeff: BigInt(scale), scale: 0 };
      }
      if (name === "ibase") {
        const b = Number(truncToInt(val));
        if (b < 2 || b > 16) throw new Error(`ibase (${b}) must be between 2 and 16`);
        ibase = b;
        return { coeff: BigInt(ibase), scale: 0 };
      }
      if (name === "obase") {
        const b = truncToInt(val);
        if (b < 2n || (limits.maxObase !== Infinity && b > BigInt(limits.maxObase))) {
          throw new Error(`obase (${b}) out of bounds [2, ${limits.maxObase}]`);
        }
        obase = b;
        return { coeff: obase, scale: 0 };
      }
      if (name === "last") {
        last = val;
        return val;
      }
      for (let i = callStack.length - 1; i >= 0; i--) {
        const frame = callStack[i]!.scalars;
        if (frame.has(name)) {
          frame.set(name, val);
          return val;
        }
      }
      globals.set(name, val);
      return val;
    };

    const evalExpr = async (expr: Expr): Promise<DecimalValue> => {
      { const p = tick(); if (p) await p; }
      switch (expr.kind) {
        case "num":
          return parseLiteralInBase(expr.raw, ibase);
        case "str":
          appendOutput(expr.value);
          return ZERO;
        case "array":
          throw new Error("array argument requires an array parameter");
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
          else next = await powDec(cur, r, scale, limits.maxExponent, tick);
          return setVar(expr.target.name, expr.target.index, next);
        }
        case "unary": {
          if (expr.op === "++" || expr.op === "--") {
            if (expr.arg.kind !== "var") throw new Error("invalid increment/decrement target");
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
            case "^": return await powDec(l, r, scale, limits.maxExponent, tick);
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
          const args: (DecimalValue | Map<string, DecimalValue>)[] = [];
          for (const a of expr.args) {
            args.push(a.kind === "array" ? getArray(a.name) : await evalExpr(a));
          }
          if (args.every((arg): arg is DecimalValue => !(arg instanceof Map))) {
            const arg0 = args[0] ?? ZERO;
            if (expr.name === "sqrt") return sqrtDec(arg0, scale);
            if (expr.name === "scale") return { coeff: BigInt(arg0.scale), scale: 0 };
            if (expr.name === "length") return lengthDec(arg0);
            if (expr.name === "abs") return { coeff: arg0.coeff < 0n ? -arg0.coeff : arg0.coeff, scale: arg0.scale };
            if (mathlib) {
              const result = await mathValue(expr.name, args, scale, tick);
              if (result) return result;
            }
          }
          const fn = funcs.get(expr.name);
          if (!fn) throw new Error(`Function ${expr.name} not defined.`);
          if (callStack.length >= limits.maxRecursionDepth) throw new Error(`bc function recursion depth exceeded (${limits.maxRecursionDepth})`);
          const frame = { scalars: new Map<string, DecimalValue>(), arrays: new Map<string, Map<string, DecimalValue>>() };
          if (args.length !== fn.params.length) throw new Error(`Function ${expr.name} argument count mismatch.`);
          for (let i = 0; i < fn.params.length; i++) {
            const param = fn.params[i]!;
            const arg = args[i]!;
            if (param.array !== (arg instanceof Map)) throw new Error(`Function ${expr.name} argument type mismatch.`);
            if (arg instanceof Map) {
              const copy = new Map<string, DecimalValue>();
              for (const [key, value] of arg) {
                const pending = tick();
                if (pending) await pending;
                copy.set(key, value);
              }
              frame.arrays.set(param.name, copy);
            } else {
              frame.scalars.set(param.name, arg);
            }
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
      { const p = tick(); if (p) await p; }
      switch (stmt.kind) {
        case "define":
          funcs.set(stmt.name, { params: stmt.params, body: stmt.body });
          return;
        case "auto": {
          const frame = callStack.at(-1);
          if (frame) {
            for (const { name, array } of stmt.names) {
              if (array) {
                if (!frame.arrays.has(name)) frame.arrays.set(name, new Map());
              } else if (!frame.scalars.has(name)) frame.scalars.set(name, ZERO);
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
              appendOutput(item.value);
            } else {
              const v = await evalExpr(item);
              last = v;
              appendNumber(v);
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
            appendOutput(stmt.expr.value);
            return;
          }
          const val = await evalExpr(stmt.expr);
          if (stmt.expr.kind !== "assign" || stmt.expr.parenthesized) {
            last = val;
            appendNumber(val);
            appendOutput("\n");
          }
          return;
        }
      }
    };

    let executionFailure: { error: unknown } | undefined;
    try {
      for (const s of stmts) {
        await execStmt(s);
      }
    } catch (sig) {
      if (!(sig instanceof FlowSignal && sig.kind === "halt")) {
        if (sig instanceof Error && (sig.name === "AbortError" || sig.name === "BudgetExceededError")) throw sig;
        executionFailure = { error: sig };
      }
    }

    context.signal.throwIfAborted();
    if (outBuffer.length > 0) {
      await writeText(context.stdout, outBuffer);
      context.signal.throwIfAborted();
    }
    if (executionFailure) throw executionFailure.error;
    return { exitCode: 0 };
      } catch (err) {
        context.signal.throwIfAborted();
        if (err instanceof Error && (err.name === "AbortError" || err.name === "BudgetExceededError")) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        const code = err instanceof UsageError ? 2 : 1;
        await writeText(context.stderr, `bc: ${msg}\n`);
        context.signal.throwIfAborted();
        return { exitCode: code };
      }
    },
  };
}

export function createBcCommands(options: BcCommandsOptions = {}): readonly CommandDefinition[] {
  return [createBcCommand(options)];
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
