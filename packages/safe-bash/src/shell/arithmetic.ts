import { PublicDiagnostic } from "../diagnostics.js";
import { ShellSyntaxError } from "./types.js";
import { ParseBudget } from "./parse-budget.js";

export type Arithmetic = (
  | { kind: "literal"; value: bigint }
  | { kind: "name"; name: string; subscript?: string }
  | { kind: "unary"; operator: string; operand: Arithmetic; postfix: boolean }
  | { kind: "binary"; operator: string; left: Arithmetic; right: Arithmetic }
  | { kind: "conditional"; condition: Arithmetic; yes: Arithmetic; no: Arithmetic }
) & { start?: number };

export interface ArithmeticProgram {
  readonly source: string;
  readonly tree?: Arithmetic;
  readonly error?: ShellSyntaxError;
  readonly hasSubscript?: boolean;
  readonly hasMutation?: boolean;
}

class ArithmeticFailure extends Error {
  constructor(message: string, readonly offset: number) { super(message); }
}

const preparedArithmeticCache = new Map<string, { program: ArithmeticProgram; units: number }>();

let lastParsedHasSubscript = false;
let lastParsedHasMutation = false;

function fastDecimalLiteral(text: string | undefined, budget: ParseBudget): bigint | undefined {
  if (text === undefined || text === "0") { budget.admit(2); return 0n; }
  if (text === "") { budget.admit(1); return 0n; }
  const len = text.length;
  if (len > 16) return undefined;
  let start = 0;
  let negative = false;
  if (text.charCodeAt(0) === 45) {
    if (len === 1) return undefined;
    if (text === "-0") { budget.admit(4); return 0n; }
    negative = true;
    start = 1;
  }
  const first = text.charCodeAt(start);
  if (first < 49 || first > 57) return undefined;
  let num = first - 48;
  for (let i = start + 1; i < len; i++) {
    const code = text.charCodeAt(i);
    if (code < 48 || code > 57) return undefined;
    num = num * 10 + (code - 48);
  }
  budget.admit(negative ? 4 : 2);
  return BigInt(negative ? -num : num);
}

export function prepareArithmetic(source: string, budget = new ParseBudget()): ArithmeticProgram {
  if (source.length <= 256) {
    const cached = preparedArithmeticCache.get(source);
    if (cached) {
      budget.admit(cached.units);
      return cached.program;
    }
  }
  const startUnits = budget.admittedUnits;
  budget.admit();
  try {
    const tree = parseArithmetic(source, 0, budget);
    const units = budget.admittedUnits - startUnits;
    const program: ArithmeticProgram = { source, tree, hasSubscript: lastParsedHasSubscript, hasMutation: lastParsedHasMutation };
    if (source.length <= 256) {
      if (preparedArithmeticCache.size >= 64) {
        const oldest = preparedArithmeticCache.keys().next().value;
        if (oldest !== undefined) preparedArithmeticCache.delete(oldest);
      }
      preparedArithmeticCache.set(source, { program, units });
    }
    return program;
  }
  catch (error) {
    if (!(error instanceof ShellSyntaxError) || /nesting/u.test(error.reason)) throw error;
    budget.admit();
    const units = budget.admittedUnits - startUnits;
    const program: ArithmeticProgram = { source, error };
    if (source.length <= 256) {
      if (preparedArithmeticCache.size >= 64) {
        const oldest = preparedArithmeticCache.keys().next().value;
        if (oldest !== undefined) preparedArithmeticCache.delete(oldest);
      }
      preparedArithmeticCache.set(source, { program, units });
    }
    return program;
  }
}

const precedence: Record<string, number> = {
  ",": 1, "=": 2, "+=": 2, "-=": 2, "*=": 2, "/=": 2, "%=": 2,
  "<<=": 2, ">>=": 2, "&=": 2, "^=": 2, "|=": 2,
  "?": 3, "||": 4, "&&": 5, "|": 6, "^": 7, "&": 8,
  "==": 9, "!=": 9, "<": 10, "<=": 10, ">": 10, ">=": 10,
  "<<": 11, ">>": 11, "+": 12, "-": 12, "*": 13, "/": 13, "%": 13, "**": 14,
};

const PARSE_SMALL_BIGINTS: readonly bigint[] = Array.from({ length: 1025 }, (_, i) => BigInt(i));

function integer(text: string): bigint {
  const c0 = text.charCodeAt(0);
  if (c0 >= 49 && c0 <= 57 && text.length <= 18) {
    let allDec = true;
    let val = c0 - 48;
    for (let i = 1; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      if (ch < 48 || ch > 57) { allDec = false; break; }
      if (text.length <= 4) val = val * 10 + (ch - 48);
    }
    if (allDec) return text.length <= 4 && val <= 1024 ? PARSE_SMALL_BIGINTS[val]! : BigInt(text);
  }
  if (text === "0") return 0n;
  if (/^0[xX][\da-fA-F]+$/u.test(text)) return BigInt.asIntN(64, BigInt(text));
  if (/^0[0-7]+$/u.test(text)) return BigInt.asIntN(64, BigInt(`0o${text.slice(1)}`));
  if (/^0\d+$/u.test(text)) throw new PublicDiagnostic("Invalid octal constant");
  if (/^\d+$/u.test(text)) return BigInt.asIntN(64, BigInt(text));
  const match = /^(\d+)#([\da-zA-Z@_]+)$/u.exec(text);
  if (!match) throw new PublicDiagnostic("Invalid arithmetic constant");
  const base = Number(match[1]);
  if (base < 2 || base > 64) throw new PublicDiagnostic("Invalid arithmetic base");
  let value = 0n;
  for (const character of match[2]!) {
    const digit = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ@_".indexOf(base <= 36 ? character.toLowerCase() : character);
    if (digit >= base || digit < 0) throw new PublicDiagnostic("Digit exceeds arithmetic base");
    value = BigInt.asIntN(64, value * BigInt(base) + BigInt(digit));
  }
  return value;
}

const sharedTokenValues: string[] = [];
const sharedTokenOffsets: number[] = [];
let sharedTokensBusy = false;

function matchArithOperator(source: string, pos: number): string | undefined {
  const c0 = source.charCodeAt(pos);
  const c1 = source.charCodeAt(pos + 1);
  switch (c0) {
    case 40: return "(";
    case 41: return ")";
    case 126: return "~";
    case 63: return "?";
    case 58: return ":";
    case 44: return ",";
    case 43: return c1 === 43 ? "++" : c1 === 61 ? "+=" : "+";
    case 45: return c1 === 45 ? "--" : c1 === 61 ? "-=" : "-";
    case 42: return c1 === 42 ? "**" : c1 === 61 ? "*=" : "*";
    case 47: return c1 === 61 ? "/=" : "/";
    case 37: return c1 === 61 ? "%=" : "%";
    case 94: return c1 === 61 ? "^=" : "^";
    case 33: return c1 === 61 ? "!=" : "!";
    case 61: return c1 === 61 ? "==" : "=";
    case 38: return c1 === 38 ? "&&" : c1 === 61 ? "&=" : "&";
    case 124: return c1 === 124 ? "||" : c1 === 61 ? "|=" : "|";
    case 60:
      if (c1 === 60) return source.charCodeAt(pos + 2) === 61 ? "<<=" : "<<";
      return c1 === 61 ? "<=" : "<";
    case 62:
      if (c1 === 62) return source.charCodeAt(pos + 2) === 61 ? ">>=" : ">>";
      return c1 === 61 ? ">=" : ">";
    default: return undefined;
  }
}

export function parseArithmetic(source: string, offset = 0, budget = new ParseBudget()): Arithmetic {
  lastParsedHasSubscript = false;
  lastParsedHasMutation = false;
  if (source.includes("\\\n")) source = source.replace(/\\\n/gu, "");
  const useShared = !sharedTokensBusy;
  if (useShared) sharedTokensBusy = true;
  const tokenValues = useShared ? sharedTokenValues : [];
  const tokenOffsets = useShared ? sharedTokenOffsets : [];
  let tokenLen = 0;
  try {
  let position = 0;
  while (position < source.length) {
    const ws = source.charCodeAt(position);
    if (ws <= 32 && (ws === 32 || ws === 9 || ws === 10 || ws === 13 || ws === 11 || ws === 12)) { position++; continue; }
    if (source[position] === "[") {
      const start = position++;
      let depth = 1;
      let quote = "";
      while (position < source.length && depth) {
        const character = source[position++]!;
        if (character === "\\" && quote !== "'") { position++; continue; }
        if (quote) { if (character === quote) quote = ""; continue; }
        if (character === "'" || character === '"') quote = character;
        else if (character === "[") depth++;
        else if (character === "]") depth--;
        if (depth > budget.maxSyntaxDepth) throw new ShellSyntaxError(`Arithmetic nesting exceeds ${budget.maxSyntaxDepth}`, offset + start);
      }
      if (depth) throw new ShellSyntaxError("Unclosed arithmetic subscript", offset + start);
      budget.admit(position - start);
      tokenValues[tokenLen] = source.slice(start, position); tokenOffsets[tokenLen++] = offset + start;
      continue;
    }
    let value: string | undefined;
    const c0 = source.charCodeAt(position);
    if (c0 >= 48 && c0 <= 57) {
      let end = position + 1;
      if (c0 === 48 && (source.charCodeAt(end) === 120 || source.charCodeAt(end) === 88)) {
        end++;
        while (end < source.length) {
          const ch = source.charCodeAt(end);
          if ((ch >= 48 && ch <= 57) || (ch >= 65 && ch <= 70) || (ch >= 97 && ch <= 102)) end++;
          else break;
        }
        if (end > position + 2) value = source.slice(position, end);
      } else {
        while (end < source.length) {
          const ch = source.charCodeAt(end);
          if (ch >= 48 && ch <= 57) end++;
          else break;
        }
        if (source.charCodeAt(end) === 35) {
          let bEnd = end + 1;
          while (bEnd < source.length) {
            const ch = source.charCodeAt(bEnd);
            if ((ch >= 48 && ch <= 57) || (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || ch === 64 || ch === 95) bEnd++;
            else break;
          }
          if (bEnd > end + 1) value = source.slice(position, bEnd);
          else value = source.slice(position, end);
        } else {
          value = source.slice(position, end);
        }
      }
    } else if ((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) || c0 === 95) {
      let end = position + 1;
      while (end < source.length) {
        const ch = source.charCodeAt(end);
        if ((ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || (ch >= 48 && ch <= 57) || ch === 95) end++;
        else break;
      }
      value = source.slice(position, end);
    } else {
      value = matchArithOperator(source, position);
    }
    if (!value) {
      const previous = tokenLen > 0 ? tokenValues[tokenLen - 1] : undefined;
      const quoted = source[position] === "'" || source[position] === "\\";
      const operand = previous === undefined || previous === "(" || previous === ":" || previous === "!" || previous === "~" || precedence[previous] !== undefined;
      throw new ShellSyntaxError(quoted ? operand ? "Quoted arithmetic operand expected" : "Invalid quoted arithmetic operator" : "Unsupported arithmetic token", offset + position);
    }
    budget.admit();
    tokenValues[tokenLen] = value;
    tokenOffsets[tokenLen++] = offset + position;
    position += value.length;
  }
  if (tokenLen === 0) { budget.admit(); return { kind: "literal", value: 0n }; }
  let cursor = 0;
  let depth = 0;
  const current = () => cursor < tokenLen ? tokenValues[cursor]! : "";
  const error = (message: string): never => { throw new ShellSyntaxError(message, cursor < tokenLen ? tokenOffsets[cursor]! : offset + source.length); };
  const expression = (minimum = 1): Arithmetic => {
    if (++depth > budget.maxSyntaxDepth) error(`Arithmetic nesting exceeds ${budget.maxSyntaxDepth}`);
    let left: Arithmetic;
    const start = cursor < tokenLen ? tokenOffsets[cursor]! : offset + source.length;
    const token = current();
    cursor++;
    const tc0 = token.charCodeAt(0);
    if (token === "+" || token === "-" || token === "!" || token === "~" || token === "++" || token === "--") {
      budget.admit();
      const operand = expression(15);
      if (token === "++" || token === "--") {
        if (operand.kind !== "name") error("Arithmetic assignment requires a variable");
        lastParsedHasMutation = true;
      }
      left = { kind: "unary", operator: token, operand, postfix: false };
    } else if (token === "(") {
      left = expression();
      if (current() !== ")") error("Unclosed arithmetic parenthesis");
      cursor++;
    } else if ((tc0 >= 65 && tc0 <= 90) || (tc0 >= 97 && tc0 <= 122) || tc0 === 95) {
      budget.admit();
      left = { kind: "name", name: token };
      if (current().charCodeAt(0) === 91) {
        left.subscript = current().slice(1, -1);
        if (!left.subscript.trim()) error("Invalid arithmetic operand");
        lastParsedHasSubscript = true;
        cursor++;
      }
    }
    else {
      budget.admit();
      try { left = { kind: "literal", value: integer(token) }; }
      catch { error("Invalid arithmetic operand"); }
    }
    left!.start = start;
    while (true) {
      const operator = current();
      if (operator === "++" || operator === "--") {
        if (left!.kind !== "name") error("Arithmetic assignment requires a variable");
        lastParsedHasMutation = true;
        cursor++;
        budget.admit();
        left = { kind: "unary", operator, operand: left!, postfix: true, start };
        continue;
      }
      const priority = Object.hasOwn(precedence, operator) ? precedence[operator]! : 0;
      if (priority < minimum || priority === 0) break;
      cursor++;
      budget.admit();
      if (operator === "?") {
        const yes = expression();
        if (current() !== ":") error("Expected arithmetic colon");
        cursor++;
        left = { kind: "conditional", condition: left!, yes, no: expression(3), start };
      } else {
        const assignment = priority === 2;
        if (assignment) {
          if (left!.kind !== "name") error("Arithmetic assignment requires a variable");
          lastParsedHasMutation = true;
        }
        const right = expression(priority + (assignment || operator === "**" ? 0 : 1));
        left = { kind: "binary", operator, left: left!, right, start };
      }
    }
    depth--;
    return left!;
  };
  const tree = expression();
  if (cursor < tokenLen) error("Unexpected arithmetic token");
  return tree;
  } finally {
    if (useShared) sharedTokensBusy = false;
  }
}

export function arithmeticEnd(source: string, start: number, allowSubshell = false, maxSyntaxDepth = Infinity): number {
  let depth = 0;
  let quote = "";
  let ansiQuote = false;
  let quotedSubstitutions: number[] | undefined;
  for (let position = start; position < source.length; position++) {
    const character = source[position];
    if (allowSubshell) {
      if (character === "\\" && (quote !== "'" || ansiQuote)) { position++; continue; }
      if (quote === '"' && character === "$" && source[position + 1] === "(") {
        quotedSubstitutions ??= [];
        if (quotedSubstitutions.length >= maxSyntaxDepth) throw new ShellSyntaxError(`Syntax nesting exceeds ${maxSyntaxDepth}`, position);
        quotedSubstitutions.push(depth);
        depth++;
        position++;
        quote = "";
        continue;
      }
      if (quote) {
        if (character === quote) quote = "";
        continue;
      }
      if (character === "'" || character === '"' || character === "`") {
        quote = character;
        ansiQuote = character === "'" && source[position - 1] === "$";
        continue;
      }
    }
    if (character === "(") depth++;
    if (character === ")") {
      if (depth === 0) {
        let nextClose = position + 1;
        while (source.startsWith("\\\n", nextClose)) nextClose += 2;
        if (source[nextClose] === ")") return position;
      }
      if (--depth < 0) {
        if (allowSubshell) return -1;
        break;
      }
      if (quotedSubstitutions !== undefined && quotedSubstitutions.at(-1) === depth) {
        quotedSubstitutions.pop();
        quote = '"';
      }
    }
  }
  throw new ShellSyntaxError("Unterminated arithmetic expression", start);
}

export interface ArithmeticReferences {
  resolve(name: string, subscript?: string): string | Promise<string>;
  read(reference: string): string | undefined | Promise<string | undefined>;
  write(reference: string, value: string): void | Promise<void>;
  readonly isSync?: boolean;
}

function binaryArithmeticOp(operator: string, left: bigint, right: bigint, offset: number): bigint {
  switch (operator) {
    case "+": return left + right;
    case "-": return left - right;
    case "*": return left * right;
    case "/": if (right === 0n) throw new ArithmeticFailure("division by 0", offset); return left / right;
    case "%": if (right === 0n) throw new ArithmeticFailure("division by 0", offset); return left % right;
    case "**": {
      if (right < 0n) throw new ArithmeticFailure("exponent less than 0", offset);
      let result = 1n;
      let base = left;
      let exponent = right;
      while (exponent) {
        if (exponent & 1n) result = BigInt.asIntN(64, result * base);
        exponent >>= 1n;
        base = BigInt.asIntN(64, base * base);
      }
      return result;
    }
    case "<<": return left << (right & 63n);
    case ">>": return left >> (right & 63n);
    case "&": return left & right;
    case "|": return left | right;
    case "^": return left ^ right;
    case "==": return BigInt(left === right);
    case "!=": return BigInt(left !== right);
    case "<": return BigInt(left < right);
    case "<=": return BigInt(left <= right);
    case ">": return BigInt(left > right);
    case ">=": return BigInt(left >= right);
    default: throw new PublicDiagnostic(`Unsupported arithmetic operator ${operator}`);
  }
}

function formatArithmeticError(program: ArithmeticProgram, error: unknown): never {
  if (error instanceof ArithmeticFailure) throw new PublicDiagnostic(`${program.source.trimStart()}: ${error.message} (error token is "${program.source.slice(error.offset)}")`);
  if (error instanceof ShellSyntaxError) {
    const offset = error.offset >= program.source.trimEnd().length ? Math.max(0, program.source.trimEnd().length - 1) : error.offset;
    const reason = error.reason === "Quoted arithmetic operand expected" ? "syntax error: operand expected"
      : error.reason === "Invalid quoted arithmetic operator" ? "syntax error: invalid arithmetic operator"
      : error.reason === "Invalid arithmetic operand" ? "arithmetic syntax error: operand expected" : "arithmetic syntax error in expression";
    throw new PublicDiagnostic(`${program.source.trimStart()}: ${reason} (error token is "${program.source.slice(offset)}")`);
  }
  throw error;
}

const SMALL_INT_STRINGS: string[] = new Array(65537);
for (let i = 0; i <= 4096; i++) SMALL_INT_STRINGS[i] = String(i);
const SMALL_BIGINTS: bigint[] = Array.from({ length: 4097 }, (_, i) => BigInt(i));

function smallBigInt(n: number): bigint {
  return n >= 0 && n <= 4096 ? SMALL_BIGINTS[n]! : BigInt(n);
}

// Zero is served by SMALL_INT_STRINGS, so an empty large-cache slot cannot match.
const LARGE_INT_KEYS = new Float64Array(16);
const LARGE_INT_STRS = new Array<string>(16).fill("");

export function intToStr(n: number): string {
  if (n >= 0 && n <= 65536) {
    return SMALL_INT_STRINGS[n] ??= String(n);
  }
  const slot = ((n | 0) ^ ((n | 0) >>> 4)) & 15;
  if (LARGE_INT_KEYS[slot] === n) return LARGE_INT_STRS[slot]!;
  const s = String(n);
  LARGE_INT_KEYS[slot] = n;
  LARGE_INT_STRS[slot] = s;
  return s;
}

export function fastSafeInt(text: string | undefined, budget: ParseBudget): number | undefined {
  if (text === undefined || text === "0") { budget.admit(2); return 0; }
  if (text === "") { budget.admit(1); return 0; }
  const len = text.length;
  if (len > 8) return undefined;
  let start = 0;
  let negative = false;
  if (text.charCodeAt(0) === 45) {
    if (len === 1) return undefined;
    if (text === "-0") { budget.admit(4); return 0; }
    negative = true;
    start = 1;
  }
  const first = text.charCodeAt(start);
  if (first < 49 || first > 57) return undefined;
  let num = first - 48;
  for (let i = start + 1; i < len; i++) {
    const code = text.charCodeAt(i);
    if (code < 48 || code > 57) return undefined;
    num = num * 10 + (code - 48);
  }
  budget.admit(negative ? 4 : 2);
  return negative ? -num : num;
}

function canEvalSafeSmiTree(node: Arithmetic, depth = 0, allowMut = depth === 0, noSubscripts = false): boolean {
  if (depth > 32) return false;
  if (node.kind === "literal") return node.value >= -94906265n && node.value <= 94906265n;
  if (node.kind === "name") {
    if (noSubscripts) return node.subscript === undefined;
    return node.subscript === undefined || /^[0-9]{1,7}$/.test(node.subscript) || /^\$?[a-zA-Z_][a-zA-Z_0-9]*$/.test(node.subscript) || /^\s*[a-zA-Z_][a-zA-Z_0-9]*\s*(?:[-+*]\s*(?:0|[1-9][0-9]{0,6})|[/%]\s*[1-9][0-9]{0,6})\s*$/.test(node.subscript);
  }
  if (node.kind === "unary") {
    if (node.operator === "+" || node.operator === "-" || node.operator === "!" || node.operator === "~") return canEvalSafeSmiTree(node.operand, depth + 1, false, noSubscripts);
    if (node.operator === "++" || node.operator === "--") return allowMut && node.operand.kind === "name" && canEvalSafeSmiTree(node.operand, depth + 1, false, noSubscripts);
    return false;
  }
  if (node.kind === "binary") {
    if (node.operator === ",") {
      return allowMut && depth < 8 && canEvalSafeSmiTree(node.left, depth + 1, true, true) && canEvalSafeSmiTree(node.right, depth + 1, true, true);
    }
    if ((node.operator === "=" || node.operator === "+=" || node.operator === "-=" || node.operator === "*=" || node.operator === "&=" || node.operator === "|=" || node.operator === "^=" || node.operator === "<<=" || node.operator === ">>=") && allowMut) {
      if ((node.operator === "<<=" || node.operator === ">>=") && (node.right.kind !== "literal" || node.right.value < 0n || node.right.value > 30n)) return false;
      return node.left.kind === "name" && canEvalSafeSmiTree(node.left, depth + 1, false, noSubscripts) && canEvalSafeSmiTree(node.right, depth + 1, false, noSubscripts);
    }
    if (
      node.operator === "+" || node.operator === "-" || node.operator === "*" ||
      node.operator === "<" || node.operator === "<=" || node.operator === ">" ||
      node.operator === ">=" || node.operator === "==" || node.operator === "!=" ||
      node.operator === "&" || node.operator === "|" || node.operator === "^" ||
      node.operator === "<<" || node.operator === ">>" ||
      node.operator === "&&" || node.operator === "||"
    ) {
      if (
        allowMut &&
        node.left.kind === "unary" &&
        (node.left.operator === "++" || node.left.operator === "--") &&
        node.left.operand.kind === "name" &&
        node.left.operand.subscript === undefined &&
        node.right.kind === "literal" &&
        canEvalSafeSmiTree(node.right, depth + 1, false, noSubscripts)
      ) {
        return true;
      }
      return canEvalSafeSmiTree(node.left, depth + 1, false, noSubscripts) && canEvalSafeSmiTree(node.right, depth + 1, false, noSubscripts);
    }
    if (node.operator === "/" || node.operator === "%") {
      return node.right.kind === "literal" && node.right.value !== 0n && node.right.value >= -94906265n && node.right.value <= 94906265n && canEvalSafeSmiTree(node.left, depth + 1, false, noSubscripts);
    }
  }
  return false;
}

function readSafeSmiRef(ref: string, refs: ArithmeticReferences, budget: ParseBudget, tx?: Array<{ ref: string; val: number }>): number | undefined {
  if (tx !== undefined) {
    for (let i = tx.length - 1; i >= 0; i--) {
      if (tx[i]!.ref === ref) {
        const v = tx[i]!.val;
        budget.admit(v < 0 ? 4 : 2);
        return v;
      }
    }
  }
  return fastSafeInt(refs.read(ref) as string | undefined, budget);
}

function writeSafeSmiRef(ref: string, val: number, refs: ArithmeticReferences, tx?: Array<{ ref: string; val: number }>): void {
  if (tx !== undefined) {
    tx.push({ ref, val });
  } else {
    refs.write(ref, intToStr(val));
  }
}

function evalSafeSmiInner(node: Arithmetic, refs: ArithmeticReferences, budget: ParseBudget, tx?: Array<{ ref: string; val: number }>): number | undefined {
  budget.admit(0);
  if (node.kind === "literal") return Number(node.value);
  if (node.kind === "name") {
    const ref = refs.resolve(node.name, node.subscript) as string;
    return readSafeSmiRef(ref, refs, budget, tx);
  }
  if (node.kind === "unary") {
    if (node.operator === "++" || node.operator === "--") {
      const target = node.operand as Extract<Arithmetic, { kind: "name" }>;
      const ref = refs.resolve(target.name, target.subscript) as string;
      const cur = readSafeSmiRef(ref, refs, budget, tx);
      if (cur === undefined || cur < -94906264 || cur > 94906264) return undefined;
      const next = node.operator === "++" ? cur + 1 : cur - 1;
      writeSafeSmiRef(ref, next, refs, tx);
      return node.postfix ? cur : next;
    }
    const v = evalSafeSmiInner(node.operand, refs, budget, tx);
    if (v === undefined || v < -94906265 || v > 94906265) return undefined;
    if (node.operator === "+") return v;
    if (node.operator === "-") return v === 0 ? 0 : -v;
    if (node.operator === "!") return v === 0 ? 1 : 0;
    if (node.operator === "~") return ~v;
    return undefined;
  }
  if (node.kind === "binary") {
    if (node.operator === ",") {
      const lComma = evalSafeSmiInner(node.left, refs, budget, tx);
      if (lComma === undefined) return undefined;
      return evalSafeSmiInner(node.right, refs, budget, tx);
    }
    if (node.operator === "=") {
      const r = evalSafeSmiInner(node.right, refs, budget, tx);
      if (r === undefined || r < -94906265 || r > 94906265) return undefined;
      const target = node.left as Extract<Arithmetic, { kind: "name" }>;
      const ref = refs.resolve(target.name, target.subscript) as string;
      writeSafeSmiRef(ref, r, refs, tx);
      return r;
    }
    if (
      node.operator === "+=" || node.operator === "-=" || node.operator === "*=" ||
      node.operator === "&=" || node.operator === "|=" || node.operator === "^=" ||
      node.operator === "<<=" || node.operator === ">>="
    ) {
      const target = node.left as Extract<Arithmetic, { kind: "name" }>;
      const ref = refs.resolve(target.name, target.subscript) as string;
      const l = readSafeSmiRef(ref, refs, budget, tx);
      if (l === undefined || l < -94906265 || l > 94906265) return undefined;
      const r = evalSafeSmiInner(node.right, refs, budget, tx);
      if (r === undefined || r < -94906265 || r > 94906265) return undefined;
      let updated: number;
      if (node.operator === "+=") updated = l + r;
      else if (node.operator === "-=") updated = l - r;
      else if (node.operator === "*=") updated = l * r;
      else if (node.operator === "&=") updated = l & r;
      else if (node.operator === "|=") updated = l | r;
      else if (node.operator === "^=") updated = l ^ r;
      else if (node.operator === "<<=") {
        if (r < 0 || r > 30) return undefined;
        const shifted = l * (1 << r);
        if (shifted < -94906265 || shifted > 94906265) return undefined;
        updated = shifted | 0;
      } else {
        if (r < 0 || r > 30) return undefined;
        updated = l >> r;
      }
      if (updated < -94906265 || updated > 94906265) return undefined;
      writeSafeSmiRef(ref, updated, refs, tx);
      return updated;
    }
    const l = evalSafeSmiInner(node.left, refs, budget, tx);
    if (l === undefined || l < -94906265 || l > 94906265) return undefined;
    if (node.operator === "&&") {
      if (l === 0) return 0;
      const rAnd = evalSafeSmiInner(node.right, refs, budget, tx);
      if (rAnd === undefined || rAnd < -94906265 || rAnd > 94906265) return undefined;
      return rAnd !== 0 ? 1 : 0;
    }
    if (node.operator === "||") {
      if (l !== 0) return 1;
      const rOr = evalSafeSmiInner(node.right, refs, budget, tx);
      if (rOr === undefined || rOr < -94906265 || rOr > 94906265) return undefined;
      return rOr !== 0 ? 1 : 0;
    }
    const r = evalSafeSmiInner(node.right, refs, budget, tx);
    if (r === undefined || r < -94906265 || r > 94906265) return undefined;
    switch (node.operator) {
      case "+": return l + r;
      case "-": return l - r;
      case "*": return l * r;
      case "/": { const q = Math.trunc(l / r); return q === 0 ? 0 : q; }
      case "%": { const m = (l % r) | 0; return m === 0 ? 0 : m; }
      case "<": return l < r ? 1 : 0;
      case "<=": return l <= r ? 1 : 0;
      case ">": return l > r ? 1 : 0;
      case ">=": return l >= r ? 1 : 0;
      case "==": return l === r ? 1 : 0;
      case "!=": return l !== r ? 1 : 0;
      case "&": return l & r;
      case "|": return l | r;
      case "^": return l ^ r;
      case "<<": {
        if (r < 0 || r > 30) return undefined;
        const shifted = l * (1 << r);
        if (shifted < -94906265 || shifted > 94906265) return undefined;
        return shifted | 0;
      }
      case ">>": {
        if (r < 0 || r > 30) return undefined;
        return l >> r;
      }
    }
  }
  return undefined;
}

function evalSafeSmi(node: Arithmetic, refs: ArithmeticReferences, budget: ParseBudget): number | undefined {
  if (node.kind === "binary" && node.operator === ",") {
    const tx: Array<{ ref: string; val: number }> = [];
    const res = evalSafeSmiInner(node, refs, budget, tx);
    if (res === undefined) return undefined;
    for (let i = 0; i < tx.length; i++) {
      refs.write(tx[i]!.ref, intToStr(tx[i]!.val));
    }
    return res;
  }
  return evalSafeSmiInner(node, refs, budget);
}

const safeSmiSymbol = Symbol("safe-bash.safeSmiTree");

function collectPureSmiTreeNames(node: Arithmetic, names: Set<string>, depth = 1): boolean {
  if (depth > 32) return false;
  if (node.kind === "literal") return node.value >= -94906265n && node.value <= 94906265n;
  if (node.kind === "name") {
    if (node.subscript !== undefined) return false;
    names.add(node.name);
    return true;
  }
  if (node.kind === "unary") {
    if (node.operator === "+" || node.operator === "-" || node.operator === "!" || node.operator === "~") {
      return collectPureSmiTreeNames(node.operand, names, depth + 1);
    }
    return false;
  }
  if (node.kind === "binary") {
    if (
      node.operator === "+" || node.operator === "-" || node.operator === "*" ||
      node.operator === "<" || node.operator === "<=" || node.operator === ">" ||
      node.operator === ">=" || node.operator === "==" || node.operator === "!=" ||
      node.operator === "&" || node.operator === "|" || node.operator === "^" ||
      node.operator === "<<" || node.operator === ">>"
    ) {
      return collectPureSmiTreeNames(node.left, names, depth + 1) && collectPureSmiTreeNames(node.right, names, depth + 1);
    }
    if (node.operator === "/" || node.operator === "%") {
      return node.right.kind === "literal" && node.right.value !== 0n && node.right.value >= -94906265n && node.right.value <= 94906265n && collectPureSmiTreeNames(node.left, names, depth + 1);
    }
  }
  return false;
}

export function collectPureReadOnlySmiNames(program: ArithmeticProgram, names: Set<string>): boolean {
  if (program.error || program.hasSubscript || !program.tree) return false;
  return collectPureSmiTreeNames(program.tree, names, 1);
}

export function evalPureSmiWithInts(node: Arithmetic, intVars: Map<string, number>, budget: ParseBudget): number | undefined {
  budget.admit(0);
  if (node.kind === "literal") return Number(node.value) | 0;
  if (node.kind === "name") {
    const val = intVars.get(node.name);
    if (val === undefined) return undefined;
    budget.admit(val < 0 ? 4 : 2);
    return val;
  }
  if (node.kind === "unary") {
    const v = evalPureSmiWithInts(node.operand, intVars, budget);
    if (v === undefined || v < -94906265 || v > 94906265) return undefined;
    if (node.operator === "+") return v;
    if (node.operator === "-") return (-v) | 0;
    if (node.operator === "!") return v === 0 ? 1 : 0;
    if (node.operator === "~") return ~v;
    return undefined;
  }
  if (node.kind === "binary") {
    const l = evalPureSmiWithInts(node.left, intVars, budget);
    if (l === undefined || l < -94906265 || l > 94906265) return undefined;
    const r = evalPureSmiWithInts(node.right, intVars, budget);
    if (r === undefined || r < -94906265 || r > 94906265) return undefined;
    switch (node.operator) {
      case "+": return (l + r) | 0;
      case "-": return (l - r) | 0;
      case "*": return l >= -32767 && l <= 32767 && r >= -32767 && r <= 32767 ? Math.imul(l, r) | 0 : l * r;
      case "/": return (l / r) | 0;
      case "%": return (l % r) | 0;
      case "<": return l < r ? 1 : 0;
      case "<=": return l <= r ? 1 : 0;
      case ">": return l > r ? 1 : 0;
      case ">=": return l >= r ? 1 : 0;
      case "==": return l === r ? 1 : 0;
      case "!=": return l !== r ? 1 : 0;
      case "&": return l & r;
      case "|": return l | r;
      case "^": return l ^ r;
      case "<<": { if (r < 0 || r > 30) return undefined; const s = l * (1 << r); return s >= -94906265 && s <= 94906265 ? s | 0 : undefined; }
      case ">>": return r >= 0 && r <= 30 ? l >> r : undefined;
    }
  }
  return undefined;
}

export function isSafeSmiProgram(program: ArithmeticProgram): boolean {
  if (program.error || !program.tree || program.source.length > 256) return false;
  let cached = (program as unknown as Record<symbol, boolean | undefined>)[safeSmiSymbol];
  if (cached === undefined) {
    cached = canEvalSafeSmiTree(program.tree);
    if (Object.isExtensible(program)) {
      (program as unknown as Record<symbol, boolean>)[safeSmiSymbol] = cached;
    }
  }
  return cached;
}

export function evaluateArithmeticSyncNonZero(program: ArithmeticProgram, references: ArithmeticReferences, budget: ParseBudget): boolean {
  if (isSafeSmiProgram(program)) {
    const savedBudget = budget.snapshot();
    const smi = evalSafeSmi(program.tree!, references, budget);
    if (smi !== undefined) return smi !== 0;
    budget.restore(savedBudget);
  }
  return evaluateArithmeticSync(program, references, budget) !== 0n;
}

export function evaluateArithmeticSync(program: ArithmeticProgram, references: ArithmeticReferences, budget: ParseBudget): bigint {
  if (isSafeSmiProgram(program)) {
    const savedBudget = budget.snapshot();
    const smi = evalSafeSmi(program.tree!, references, budget);
    if (smi !== undefined) return smallBigInt(smi);
    budget.restore(savedBudget);
  }
  try {
    if (program.error) throw program.error;
    let visiting: Set<string> | undefined;
    const evalDeep = (root: Arithmetic): bigint => {
      const evaluation = arithmeticEvaluation({ source: program.source, tree: root }, references, budget);
      let step = evaluation.next();
      while (!step.done) step = evaluation.next(step.value as string | undefined);
      return step.value;
    };
    const evalNameValue = (node: Extract<Arithmetic, { kind: "name" }>, depth: number): bigint => {
      const reference = references.resolve(node.name, node.subscript) as string;
      if (visiting?.has(reference)) throw new PublicDiagnostic("Arithmetic variable recursion");
      const text = references.read(reference) as string | undefined;
      const fast = fastDecimalLiteral(text, budget);
      if (fast !== undefined) return fast;
      visiting ??= new Set();
      visiting.add(reference);
      try {
        return evalNode(parseArithmetic(text ?? "0", 0, budget), depth + 1);
      } finally {
        visiting.delete(reference);
      }
    };
    const evalName = (node: Extract<Arithmetic, { kind: "name" }>, depth: number): { reference: string; value: bigint } => {
      const reference = references.resolve(node.name, node.subscript) as string;
      if (visiting?.has(reference)) throw new PublicDiagnostic("Arithmetic variable recursion");
      const text = references.read(reference) as string | undefined;
      const fast = fastDecimalLiteral(text, budget);
      if (fast !== undefined) return { reference, value: fast };
      visiting ??= new Set();
      visiting.add(reference);
      try {
        return { reference, value: evalNode(parseArithmetic(text ?? "0", 0, budget), depth + 1) };
      } finally {
        visiting.delete(reference);
      }
    };
    const evalNode = (node: Arithmetic, depth: number): bigint => {
      if (depth >= 64) return evalDeep(node);
      budget.admit(0);
      switch (node.kind) {
        case "literal":
          return node.value;
        case "name":
          return evalNameValue(node, depth);
        case "conditional": {
          const cond = evalNode(node.condition, depth + 1);
          return evalNode(cond ? node.yes : node.no, depth + 1);
        }
        case "unary": {
          if (node.operator === "+") return BigInt.asIntN(64, evalNode(node.operand, depth + 1));
          if (node.operator === "-") return BigInt.asIntN(64, -evalNode(node.operand, depth + 1));
          if (node.operator === "!") return BigInt(!evalNode(node.operand, depth + 1));
          if (node.operator === "~") return BigInt.asIntN(64, ~evalNode(node.operand, depth + 1));
          const { reference, value: operand } = evalName(node.operand as Extract<Arithmetic, { kind: "name" }>, depth + 1);
          const updated = BigInt.asIntN(64, operand + (node.operator === "++" ? 1n : -1n));
          references.write(reference, String(updated));
          return node.postfix ? BigInt.asIntN(64, operand) : updated;
        }
        case "binary": {
          if (node.operator === "&&" || node.operator === "||") {
            const left = evalNode(node.left, depth + 1);
            if (node.operator === "&&" ? left === 0n : left !== 0n) return BigInt(left !== 0n);
            return BigInt(evalNode(node.right, depth + 1) !== 0n);
          }
          if (node.operator === ",") {
            evalNode(node.left, depth + 1);
            return evalNode(node.right, depth + 1);
          }
          if (node.operator === "=") {
            const right = evalNode(node.right, depth + 1);
            const operand = node.left as Extract<Arithmetic, { kind: "name" }>;
            const reference = references.resolve(operand.name, operand.subscript) as string;
            const updated = BigInt.asIntN(64, right);
            references.write(reference, String(updated));
            return updated;
          }
          if (precedence[node.operator] === 2) {
            const { reference, value: left } = evalName(node.left as Extract<Arithmetic, { kind: "name" }>, depth + 1);
            const right = evalNode(node.right, depth + 1);
            const updated = BigInt.asIntN(64, binaryArithmeticOp(node.operator.slice(0, -1), left, right, node.right.start ?? 0));
            references.write(reference, String(updated));
            return updated;
          }
          const left = evalNode(node.left, depth + 1);
          const right = evalNode(node.right, depth + 1);
          return BigInt.asIntN(64, binaryArithmeticOp(node.operator, left, right, node.right.start ?? 0));
        }
      }
    };
    return evalNode(program.tree!, 0);
  } catch (error) {
    formatArithmeticError(program, error);
  }
}

export function evaluateArithmeticSyncString(program: ArithmeticProgram, references: ArithmeticReferences, budget: ParseBudget): string {
  if (isSafeSmiProgram(program)) {
    const savedBudget = budget.snapshot();
    const smi = evalSafeSmi(program.tree!, references, budget);
    if (smi !== undefined) return intToStr(smi);
    budget.restore(savedBudget);
  }
  return String(evaluateArithmeticSync(program, references, budget));
}

export function evaluateArithmetic(program: ArithmeticProgram, variables: Record<string, string>, budget = new ParseBudget()): bigint {
  if (!program.hasSubscript) {
    return evaluateArithmeticSync(program, {
      isSync: true,
      resolve: name => name,
      read: name => variables[name],
      write: (name, value) => { variables[name] = value; },
    }, budget);
  }
  const evaluation = arithmeticEvaluation(program, {
    resolve(name, subscript) {
      if (subscript !== undefined) throw new PublicDiagnostic("Array arithmetic requires shell references");
      return name;
    },
    read: name => variables[name],
    write: (name, value) => { variables[name] = value; },
  }, budget);
  let step = evaluation.next();
  while (!step.done) step = evaluation.next(step.value as string | undefined);
  return step.value;
}

export async function evaluateArithmeticReferences(program: ArithmeticProgram, references: ArithmeticReferences, budget = new ParseBudget()): Promise<bigint> {
  if (references.isSync && !program.hasSubscript) {
    return evaluateArithmeticSync(program, references, budget);
  }
  const evaluation = arithmeticEvaluation(program, references, budget);
  let step = evaluation.next();
  while (!step.done) {
    try {
      const value = step.value;
      step = evaluation.next((value instanceof Promise ? await value : value) as string | undefined);
    }
    catch (error) { step = evaluation.throw(error); }
  }
  return step.value;
}

function* arithmeticEvaluation(program: ArithmeticProgram, references: ArithmeticReferences, budget: ParseBudget): Generator<string | undefined | void | Promise<string | undefined | void>, bigint, string | undefined> {
  const resolved = new WeakMap<Arithmetic, string>();
  const visiting = new Set<string>();
  const binary = binaryArithmeticOp;
  type Frame = { kind: "evaluate"; node: Arithmetic }
    | { kind: "variable"; name: string }
    | { kind: "conditional"; node: Extract<Arithmetic, { kind: "conditional" }> }
    | { kind: "unary"; node: Extract<Arithmetic, { kind: "unary" }> }
    | { kind: "left"; node: Extract<Arithmetic, { kind: "binary" }> }
    | { kind: "right"; node: Extract<Arithmetic, { kind: "binary" }>; left?: bigint }
    | { kind: "logical" };
  try {
    if (program.error) throw program.error;
    const pending: Frame[] = [{ kind: "evaluate", node: program.tree! }];
    let value = 0n;
    while (pending.length) {
      const frame = pending.pop()!;
      if (frame.kind === "evaluate") {
        budget.admit(0);
        const node = frame.node;
        if (node.kind === "literal") value = node.value;
        else if (node.kind === "name") {
          const reference = (yield references.resolve(node.name, node.subscript))!;
          resolved.set(node, reference);
          if (visiting.has(reference)) throw new PublicDiagnostic("Arithmetic variable recursion");
          const text = yield references.read(reference);
          const fast = fastDecimalLiteral(text, budget);
          if (fast !== undefined) {
            value = fast;
          } else {
            visiting.add(reference);
            pending.push({ kind: "variable", name: reference }, { kind: "evaluate", node: parseArithmetic(text ?? "0", 0, budget) });
          }
        } else if (node.kind === "conditional") {
          pending.push({ kind: "conditional", node }, { kind: "evaluate", node: node.condition });
        } else if (node.kind === "unary") {
          pending.push({ kind: "unary", node }, { kind: "evaluate", node: node.operand });
        } else if (node.operator === "=") {
          pending.push({ kind: "right", node }, { kind: "evaluate", node: node.right });
        } else {
          pending.push({ kind: "left", node }, { kind: "evaluate", node: node.left });
        }
      } else if (frame.kind === "variable") visiting.delete(frame.name);
      else if (frame.kind === "conditional") {
        pending.push({ kind: "evaluate", node: value ? frame.node.yes : frame.node.no });
      } else if (frame.kind === "unary") {
        const { node } = frame;
        const operand = value;
        if (node.operator === "+") value = operand;
        else if (node.operator === "-") value = -operand;
        else if (node.operator === "!") value = BigInt(!operand);
        else if (node.operator === "~") value = ~operand;
        else {
          value = BigInt.asIntN(64, operand + (node.operator === "++" ? 1n : -1n));
          yield references.write(resolved.get(node.operand)!, String(value));
          if (node.postfix) value = operand;
        }
        value = BigInt.asIntN(64, value);
      } else if (frame.kind === "left") {
        const { node } = frame;
        if (node.operator === "&&" || node.operator === "||") {
          if (node.operator === "&&" ? value === 0n : value !== 0n) value = BigInt(value !== 0n);
          else pending.push({ kind: "logical" }, { kind: "evaluate", node: node.right });
        } else {
          if (node.operator !== ",") pending.push({ kind: "right", node, left: value });
          pending.push({ kind: "evaluate", node: node.right });
        }
      } else if (frame.kind === "right") {
        const { node } = frame;
        if (node.operator === "=") {
          const operand = node.left as Extract<Arithmetic, { kind: "name" }>;
          resolved.set(operand, (yield references.resolve(operand.name, operand.subscript))!);
        }
        if (node.operator !== "=") value = binary(precedence[node.operator] === 2 ? node.operator.slice(0, -1) : node.operator, frame.left!, value, node.right.start ?? 0);
        if (precedence[node.operator] === 2) yield references.write(resolved.get(node.left)!, String(BigInt.asIntN(64, value)));
        value = BigInt.asIntN(64, value);
      } else value = BigInt(value !== 0n);
    }
    return value;
  } catch (error) {
    formatArithmeticError(program, error);
  }
}
export const sharedLoopIntRegs: number[] = new Array(32).fill(0);
const sharedRpnStack: number[] = new Array(32).fill(0);

export interface CompiledSmiExpr {
  readonly ops: readonly number[];
  readonly args: readonly number[];
  readonly varNames: readonly string[];
}

export function compilePureSmiProgram(program: ArithmeticProgram, namesOut: Set<string>): CompiledSmiExpr | undefined {
  if (program.error || program.hasSubscript || !program.tree) return undefined;
  const cached = (program as ArithmeticProgram & { _compiledSmi?: CompiledSmiExpr | null })._compiledSmi;
  if (cached !== undefined) {
    if (cached === null) return undefined;
    for (let i = 0; i < cached.varNames.length; i++) namesOut.add(cached.varNames[i]!);
    return cached;
  }
  const ops: number[] = [];
  const args: number[] = [];
  const varNames: string[] = [];
  const visit = (node: Arithmetic, depth: number): boolean => {
    if (depth > 32) return false;
    if (node.kind === "literal") {
      if (node.value < -94906265n || node.value > 94906265n) return false;
      ops.push(0);
      args.push(Number(node.value) | 0);
      return true;
    }
    if (node.kind === "name") {
      if (node.subscript !== undefined) return false;
      let idx = varNames.indexOf(node.name);
      if (idx === -1) {
        idx = varNames.length;
        varNames.push(node.name);
      }
      ops.push(1);
      args.push(idx);
      return true;
    }
    if (node.kind === "unary") {
      if (node.operator !== "+" && node.operator !== "-" && node.operator !== "!" && node.operator !== "~") return false;
      if (!visit(node.operand, depth + 1)) return false;
      ops.push(node.operator === "+" ? 2 : node.operator === "-" ? 3 : node.operator === "!" ? 4 : 19);
      args.push(0);
      return true;
    }
    if (node.kind === "binary") {
      let opCode = 0;
      switch (node.operator) {
        case "+": opCode = 5; break;
        case "-": opCode = 6; break;
        case "*": opCode = 7; break;
        case "/": opCode = 8; break;
        case "%": opCode = 9; break;
        case "<": opCode = 10; break;
        case "<=": opCode = 11; break;
        case ">": opCode = 12; break;
        case ">=": opCode = 13; break;
        case "==": opCode = 14; break;
        case "!=": opCode = 15; break;
        case "&": opCode = 16; break;
        case "|": opCode = 17; break;
        case "^": opCode = 18; break;
        case "<<": opCode = 20; break;
        case ">>": opCode = 21; break;
        default: return false;
      }
      if ((opCode === 8 || opCode === 9) && (node.right.kind !== "literal" || node.right.value === 0n || node.right.value < -94906265n || node.right.value > 94906265n)) {
        return false;
      }
      if (!visit(node.left, depth + 1) || !visit(node.right, depth + 1)) return false;
      ops.push(opCode);
      args.push(0);
      return true;
    }
    return false;
  };
  if (!visit(program.tree, 1)) {
    (program as ArithmeticProgram & { _compiledSmi?: CompiledSmiExpr | null })._compiledSmi = null;
    return undefined;
  }
  for (let i = 0; i < varNames.length; i++) namesOut.add(varNames[i]!);
  const compiled: CompiledSmiExpr = {
    ops,
    args,
    varNames,
  };
  (program as ArithmeticProgram & { _compiledSmi?: CompiledSmiExpr | null })._compiledSmi = compiled;
  return compiled;
}

let _lastCompiledSmiAdmitUnits = 0;

export function evalCompiledSmi(compiled: CompiledSmiExpr, varRegMap: readonly number[], budget?: ParseBudget): number {
  const ops = compiled.ops;
  const args = compiled.args;
  const len = ops.length;
  let sp = 0;
  let admitUnits = 0;
  for (let pc = 0; pc < len; pc++) {
    const op = ops[pc]!;
    if (op === 0) {
      sharedRpnStack[sp++] = args[pc]!;
    } else if (op === 1) {
      const val = sharedLoopIntRegs[varRegMap[args[pc]!]!]!;
      admitUnits = (admitUnits + (val < 0 ? 4 : 2)) | 0;
      sharedRpnStack[sp++] = val;
    } else if (op <= 4 || op === 19) {
      const v = sharedRpnStack[sp - 1]!;
      if (op === 3 && v === -1073741824) return 0x7fffffff;
      sharedRpnStack[sp - 1] = op === 2 ? v : op === 3 ? (-v | 0) : op === 4 ? (v === 0 ? 1 : 0) : ~v;
    } else {
      sp--;
      const r = sharedRpnStack[sp]!;
      const l = sharedRpnStack[sp - 1]!;
      let res = 0;
      switch (op) {
        case 5: res = l + r; break;
        case 6: res = l - r; break;
        case 7: res = l * r; break;
        case 8: res = Math.trunc(l / r); break;
        case 9: res = l % r; break;
        case 10: res = l < r ? 1 : 0; break;
        case 11: res = l <= r ? 1 : 0; break;
        case 12: res = l > r ? 1 : 0; break;
        case 13: res = l >= r ? 1 : 0; break;
        case 14: res = l === r ? 1 : 0; break;
        case 15: res = l !== r ? 1 : 0; break;
        case 16: res = l & r; break;
        case 17: res = l | r; break;
        case 18: res = l ^ r; break;
        case 20: {
          if (r < 0 || r > 30) return 0x7fffffff;
          res = l * (1 << r);
          break;
        }
        case 21: {
          if (r < 0 || r > 30) return 0x7fffffff;
          res = l >> r;
          break;
        }
      }
      if ((res | 0) !== res || res < -1073741824 || res > 1073741823) return 0x7fffffff;
      sharedRpnStack[sp - 1] = res | 0;
    }
  }
  _lastCompiledSmiAdmitUnits = admitUnits;
  if (budget !== undefined) budget.admit(admitUnits);
  return sharedRpnStack[0]!;
}

export interface FastIntStepDesc {
  readonly name: string;
  readonly compiled: CompiledSmiExpr;
  readonly varRegMap: number[];
  targetReg: number;
  readonly isSub: boolean;
  readonly extraNewlineByte: number;
  readonly padWidth?: number | undefined;
}
const sharedSavedLoopIntRegs: number[] = new Array(32).fill(0);
const sharedIntLoopResult = { ok: false, lastInductionInt: undefined as number | undefined, subBytes: 0, subCount: 0 };

const sharedDirectRegArgs = new Int32Array(64);

export function runIntArithForLoop(
  startVal: number,
  limitVal: number,
  isLe: boolean,
  stepCount: number,
  deferredMask: number,
  intSteps: readonly (FastIntStepDesc | undefined)[],
  parseBudget: ParseBudget,
): { ok: boolean; lastInductionInt: number | undefined; subBytes: number; subCount: number } {
  for (let r = 0; r < 32; r++) sharedSavedLoopIntRegs[r] = sharedLoopIntRegs[r]!;
  const savedBudget = parseBudget.snapshot();
  let iVal = startVal | 0;
  sharedLoopIntRegs[0] = iVal;
  parseBudget.admit(0);
  let lastInductionInt: number | undefined;
  let subBytes = 0;
  let subCount = 0;
  let totalAdmitUnits = 0;
  if (stepCount === 1 && deferredMask === 0 && !intSteps[0]!.isSub) {
    const intStep0 = intSteps[0]!;
    const ops = intStep0.compiled.ops;
    const args = intStep0.compiled.args;
    const varRegMap = intStep0.varRegMap;
    const targetReg = intStep0.targetReg;
    const len = ops.length;
    if (len <= 64) {
      for (let pc = 0; pc < len; pc++) {
        sharedDirectRegArgs[pc] = ops[pc] === 1 ? varRegMap[args[pc]!]! : args[pc]!;
      }
      const effLimit = isLe ? (limitVal + 1) | 0 : limitVal | 0;
      if (
        iVal >= 0 &&
        effLimit > iVal &&
        len === 9 &&
        ops[0] === 1 && sharedDirectRegArgs[0] === targetReg && sharedLoopIntRegs[targetReg]! >= 0 &&
        ops[1] === 1 && sharedDirectRegArgs[1] === 0 &&
        ops[2] === 1 && sharedDirectRegArgs[2] === 0 &&
        ops[3] === 0 && (sharedDirectRegArgs[3]! >>> 0) <= 30 &&
        ops[4] === 21 && ops[5] === 18 &&
        ((ops[6] === 5 && ops[7] === 0 && (sharedDirectRegArgs[7]! >>> 0) <= 0x3fffffff && ops[8] === 16) ||
         (ops[6] === 0 && (sharedDirectRegArgs[6]! >>> 0) <= 0xffff && ops[7] === 16 && ops[8] === 5 && effLimit <= 0x100000 && sharedLoopIntRegs[targetReg]! <= 0x10000000))
      ) {
        const rem = (effLimit - iVal) | 0;
        const shift = sharedDirectRegArgs[3]!;
        let acc = sharedLoopIntRegs[targetReg]! | 0;
        if (ops[8] === 16) {
          const mask = sharedDirectRegArgs[7]!;
          for (; iVal < effLimit; iVal = (iVal + 1) | 0) {
            acc = (acc + (iVal ^ (iVal >> shift))) & mask;
          }
        } else {
          const mask = sharedDirectRegArgs[6]!;
          const pBits = mask > 0 ? (32 - Math.clz32(mask)) + shift : 0;
          const period = pBits > 0 && pBits <= 12 ? (1 << pBits) : 0;
          if (period > 0 && (effLimit - iVal) >= (period << 1)) {
            const pMask = period - 1;
            while (iVal < effLimit && (iVal & pMask) !== 0) {
              acc = (acc + ((iVal ^ (iVal >> shift)) & mask)) | 0;
              iVal = (iVal + 1) | 0;
            }
            const fullPeriods = ((effLimit - iVal) / period) | 0;
            if (fullPeriods > 0) {
              let pSum = 0;
              for (let r = 0; r < period; r++) {
                pSum = (pSum + ((r ^ (r >> shift)) & mask)) | 0;
              }
              acc = (acc + Math.imul(fullPeriods, pSum)) | 0;
              iVal = (iVal + Math.imul(fullPeriods, period)) | 0;
            }
          }
          for (; iVal < effLimit; iVal = (iVal + 1) | 0) {
            acc = (acc + ((iVal ^ (iVal >> shift)) & mask)) | 0;
          }
        }
        sharedLoopIntRegs[targetReg] = acc;
        sharedLoopIntRegs[0] = effLimit;
        parseBudget.admit(rem * 10);
        sharedIntLoopResult.ok = true;
        sharedIntLoopResult.lastInductionInt = (effLimit - 1) | 0;
        sharedIntLoopResult.subBytes = 0;
        sharedIntLoopResult.subCount = 0;
        return sharedIntLoopResult;
      }
      while (iVal < effLimit) {
        totalAdmitUnits = (totalAdmitUnits + (iVal < 0 ? 8 : 4)) | 0;
        let sp = 0;
        for (let pc = 0; pc < len; pc++) {
          const op = ops[pc]!;
          if (op === 0) {
            sharedRpnStack[sp++] = sharedDirectRegArgs[pc]!;
          } else if (op === 1) {
            const val = sharedLoopIntRegs[sharedDirectRegArgs[pc]!]!;
            totalAdmitUnits = (totalAdmitUnits + (val < 0 ? 4 : 2)) | 0;
            sharedRpnStack[sp++] = val;
          } else if (op <= 4 || op === 19) {
            const v = sharedRpnStack[sp - 1]!;
            if (op === 3 && v === -1073741824) {
              for (let r = 0; r < 32; r++) sharedLoopIntRegs[r] = sharedSavedLoopIntRegs[r]!;
              parseBudget.restore(savedBudget);
              sharedIntLoopResult.ok = false;
              sharedIntLoopResult.lastInductionInt = undefined;
              sharedIntLoopResult.subBytes = 0;
              sharedIntLoopResult.subCount = 0;
              return sharedIntLoopResult;
            }
            sharedRpnStack[sp - 1] = op === 2 ? v : op === 3 ? (-v | 0) : op === 4 ? (v === 0 ? 1 : 0) : ~v;
          } else {
            sp--;
            const r = sharedRpnStack[sp]!;
            const l = sharedRpnStack[sp - 1]!;
            if (op >= 16 && op <= 18) {
              sharedRpnStack[sp - 1] = op === 16 ? (l & r) : op === 17 ? (l | r) : (l ^ r);
              continue;
            }
            if (op === 21 && (r >>> 0) <= 30) {
              sharedRpnStack[sp - 1] = l >> r;
              continue;
            }
            let res = 0;
            switch (op) {
              case 5: res = (l + r) | 0; break;
              case 6: res = (l - r) | 0; break;
              case 7: res = l * r; if ((res | 0) !== res) res = 0x7fffffff; break;
              case 8: res = Math.trunc(l / r); if ((res | 0) !== res) res = 0x7fffffff; break;
              case 9: res = (l % r) | 0; break;
              case 10: res = l < r ? 1 : 0; break;
              case 11: res = l <= r ? 1 : 0; break;
              case 12: res = l > r ? 1 : 0; break;
              case 13: res = l >= r ? 1 : 0; break;
              case 14: res = l === r ? 1 : 0; break;
              case 15: res = l !== r ? 1 : 0; break;
              case 20: res = (r >= 0 && r <= 30) ? l * (1 << r) : 0x7fffffff; if ((res | 0) !== res) res = 0x7fffffff; break;
              case 21: res = 0x7fffffff; break;
            }
            if (((res + 0x40000000) >>> 0) > 0x7fffffff) {
              for (let rIdx = 0; rIdx < 32; rIdx++) sharedLoopIntRegs[rIdx] = sharedSavedLoopIntRegs[rIdx]!;
              parseBudget.restore(savedBudget);
              sharedIntLoopResult.ok = false;
              sharedIntLoopResult.lastInductionInt = undefined;
              sharedIntLoopResult.subBytes = 0;
              sharedIntLoopResult.subCount = 0;
              return sharedIntLoopResult;
            }
            sharedRpnStack[sp - 1] = res | 0;
          }
        }
        sharedLoopIntRegs[targetReg] = sharedRpnStack[0]! | 0;
        lastInductionInt = iVal;
        iVal = (iVal + 1) | 0;
        sharedLoopIntRegs[0] = iVal;
      }
      parseBudget.admit(totalAdmitUnits);
      sharedIntLoopResult.ok = true;
      sharedIntLoopResult.lastInductionInt = lastInductionInt;
      sharedIntLoopResult.subBytes = 0;
      sharedIntLoopResult.subCount = 0;
      return sharedIntLoopResult;
    }
  }
  if (stepCount >= 1 && stepCount <= 8 && deferredMask === 0) {
    const effLimit = isLe ? (limitVal + 1) | 0 : limitVal | 0;
    if (iVal >= 0 && effLimit > iVal && effLimit <= 100000) {
      let allPureInd = true;
      for (let b = 0; b < stepCount; b++) {
        const st = intSteps[b]!;
        if (st.compiled.ops.length !== 1 || st.compiled.ops[0] !== 1 || st.varRegMap[st.compiled.args[0]!] !== 0 || st.targetReg === 0) {
          allPureInd = false;
          break;
        }
      }
      if (allPureInd) {
        const rem = (effLimit - iVal) | 0;
        const lastInd = (effLimit - 1) | 0;
        let baseDigits = 0;
        for (let d = 1, lo = 1, hi = 9; lo <= lastInd; d++, lo *= 10, hi = hi * 10 + 9) {
          const sK = iVal > lo ? iVal : lo;
          const eK = lastInd < hi ? lastInd : hi;
          if (sK <= eK) baseDigits += (eK - sK + 1) * d;
        }
        if (iVal === 0) baseDigits += 1;
        let totalSubB = 0;
        let totalSubC = 0;
        for (let b = 0; b < stepCount; b++) {
          const st = intSteps[b]!;
          sharedLoopIntRegs[st.targetReg] = lastInd;
          if (st.isSub) {
            totalSubC += rem;
            const pw = st.padWidth ?? 0;
            if (pw <= 1) {
              totalSubB += baseDigits + rem * st.extraNewlineByte;
            } else {
              let pDigits = 0;
              for (let d = 1, lo = 1, hi = 9; lo <= lastInd; d++, lo *= 10, hi = hi * 10 + 9) {
                const sK = iVal > lo ? iVal : lo;
                const eK = lastInd < hi ? lastInd : hi;
                if (sK <= eK) pDigits += (eK - sK + 1) * (d < pw ? pw : d);
              }
              if (iVal === 0) pDigits += (1 < pw ? pw : 1);
              totalSubB += pDigits + rem * st.extraNewlineByte;
            }
          }
        }
        sharedLoopIntRegs[0] = effLimit;
        parseBudget.admit(rem * (4 + stepCount * 2));
        sharedIntLoopResult.ok = true;
        sharedIntLoopResult.lastInductionInt = lastInd;
        sharedIntLoopResult.subBytes = totalSubB;
        sharedIntLoopResult.subCount = totalSubC;
        return sharedIntLoopResult;
      }
    }
  }
  if (stepCount <= 30 && deferredMask === ((1 << stepCount) - 1)) {
    const effLimit = isLe ? (limitVal + 1) | 0 : limitVal | 0;
    if (iVal >= 0 && effLimit > iVal) {
      const rem = (effLimit - iVal) | 0;
      sharedLoopIntRegs[0] = effLimit;
      parseBudget.admit(rem * 4);
      sharedIntLoopResult.ok = true;
      sharedIntLoopResult.lastInductionInt = (effLimit - 1) | 0;
      sharedIntLoopResult.subBytes = 0;
      sharedIntLoopResult.subCount = 0;
      return sharedIntLoopResult;
    }
  }
  while (isLe ? iVal <= limitVal : iVal < limitVal) {
    totalAdmitUnits += iVal < 0 ? 4 : 2;
    lastInductionInt = iVal;
    for (let b = 0; b < stepCount; b++) {
      if (deferredMask & (1 << b)) continue;
      const intStep = intSteps[b]!;
      const res = evalCompiledSmi(intStep.compiled, intStep.varRegMap);
      if (res === 0x7fffffff) {
        for (let r = 0; r < 32; r++) sharedLoopIntRegs[r] = sharedSavedLoopIntRegs[r]!;
        parseBudget.restore(savedBudget);
        sharedIntLoopResult.ok = false;
        sharedIntLoopResult.lastInductionInt = undefined;
        sharedIntLoopResult.subBytes = 0;
        sharedIntLoopResult.subCount = 0;
        return sharedIntLoopResult;
      }
      totalAdmitUnits += _lastCompiledSmiAdmitUnits;
      sharedLoopIntRegs[intStep.targetReg] = res | 0;
      if (intStep.isSub) {
        let abs = res < 0 ? -res : res;
        let digits = res < 0 ? 2 : 1;
        while (abs >= 10) { abs = Math.trunc(abs / 10); digits++; }
        if (intStep.padWidth !== undefined && digits < intStep.padWidth) digits = intStep.padWidth;
        subBytes = subBytes + digits + intStep.extraNewlineByte;
        subCount = subCount + 1;
      }
    }
    totalAdmitUnits += iVal < 0 ? 4 : 2;
    iVal = (iVal + 1) | 0;
    sharedLoopIntRegs[0] = iVal;
  }
  parseBudget.admit(totalAdmitUnits);
  sharedIntLoopResult.ok = true;
  sharedIntLoopResult.lastInductionInt = lastInductionInt;
  sharedIntLoopResult.subBytes = subBytes;
  sharedIntLoopResult.subCount = subCount;
  return sharedIntLoopResult;
}

const parsedLoopWordsCache = new WeakMap<readonly string[], (Int32Array & { _sum?: number }) | null>();

function getOrParsePositiveLoopWords(words: readonly string[]): (Int32Array & { _sum?: number }) | null {
  const cached = parsedLoopWordsCache.get(words);
  if (cached !== undefined) return cached;
  const len = words.length;
  if (len === 0 || len > 65536) {
    parsedLoopWordsCache.set(words, null);
    return null;
  }
  const arr: Int32Array & { _sum?: number } = new Int32Array(len);
  let sum = 0;
  for (let idx = 0; idx < len; idx++) {
    const word = words[idx]!;
    const wLen = word.length;
    if (wLen < 1 || wLen > 8) {
      parsedLoopWordsCache.set(words, null);
      return null;
    }
    const c0 = word.charCodeAt(0);
    if (c0 < 49 || c0 > 57) {
      parsedLoopWordsCache.set(words, null);
      return null;
    }
    let num = c0 - 48;
    for (let k = 1; k < wLen; k++) {
      const ck = word.charCodeAt(k);
      if (ck < 48 || ck > 57) {
        parsedLoopWordsCache.set(words, null);
        return null;
      }
      num = (num * 10 + (ck - 48)) | 0;
    }
    arr[idx] = num;
    sum += num;
  }
  arr._sum = sum;
  parsedLoopWordsCache.set(words, arr);
  return arr;
}

export function runIntForLoop(
  words: readonly string[],
  stepCount: number,
  intSteps: readonly (FastIntStepDesc | undefined)[],
  parseBudget: ParseBudget,
): { ok: boolean; subBytes: number; subCount: number } {
  for (let r = 0; r < 32; r++) sharedSavedLoopIntRegs[r] = sharedLoopIntRegs[r]!;
  const savedBudget = parseBudget.snapshot();
  let subBytes = 0;
  let subCount = 0;
  let totalAdmitUnits = 0;
  const cachedInts = getOrParsePositiveLoopWords(words);
  if (cachedInts !== null && stepCount === 1) {
    const s0 = intSteps[0]!;
    const ops = s0.compiled.ops;
    if (!s0.isSub && ops.length === 3 && ops[0] === 1 && ops[1] === 1 && ops[2] === 5) {
      const args = s0.compiled.args;
      const vMap = s0.varRegMap;
      const r0 = vMap[args[0]!]!;
      const r1 = vMap[args[1]!]!;
      const targetReg = s0.targetReg;
      const len = cachedInts.length;
      if (targetReg !== 0 && ((r0 === targetReg && r1 === 0) || (r0 === 0 && r1 === targetReg)) && cachedInts._sum !== undefined) {
        const initAcc = sharedLoopIntRegs[targetReg]!;
        const finalAcc = initAcc + cachedInts._sum;
        if (initAcc >= 0 && finalAcc <= 1073741823) {
          sharedLoopIntRegs[0] = cachedInts[len - 1]!;
          sharedLoopIntRegs[targetReg] = finalAcc | 0;
          parseBudget.admit(len * 6);
          sharedIntLoopResult.ok = true;
          sharedIntLoopResult.subBytes = 0;
          sharedIntLoopResult.subCount = 0;
          return sharedIntLoopResult;
        }
      }
      for (let idx = 0; idx < len; idx++) {
        sharedLoopIntRegs[0] = cachedInts[idx]!;
        const v0 = sharedLoopIntRegs[r0]!;
        const v1 = sharedLoopIntRegs[r1]!;
        const res = v0 + v1;
        if ((res | 0) !== res || res < -1073741824 || res > 1073741823) {
          for (let r = 0; r < 32; r++) sharedLoopIntRegs[r] = sharedSavedLoopIntRegs[r]!;
          parseBudget.restore(savedBudget);
          sharedIntLoopResult.ok = false;
          sharedIntLoopResult.subBytes = 0;
          sharedIntLoopResult.subCount = 0;
          return sharedIntLoopResult;
        }
        totalAdmitUnits = (totalAdmitUnits + 2 + (v0 < 0 ? 4 : 2) + (v1 < 0 ? 4 : 2)) | 0;
        sharedLoopIntRegs[targetReg] = res | 0;
      }
      parseBudget.admit(totalAdmitUnits);
      sharedIntLoopResult.ok = true;
      sharedIntLoopResult.subBytes = 0;
      sharedIntLoopResult.subCount = 0;
      return sharedIntLoopResult;
    }
  }
  for (let idx = 0; idx < words.length; idx++) {
    const word = words[idx]!;
    let iVal: number | undefined;
    const wLen = word.length;
    if (wLen >= 1 && wLen <= 8) {
      const c0 = word.charCodeAt(0);
      if (c0 >= 49 && c0 <= 57) {
        let num = c0 - 48;
        let valid = true;
        for (let k = 1; k < wLen; k++) {
          const ck = word.charCodeAt(k);
          if (ck < 48 || ck > 57) { valid = false; break; }
          num = (num * 10 + (ck - 48)) | 0;
        }
        if (valid) {
          iVal = num;
          totalAdmitUnits = (totalAdmitUnits + 2) | 0;
        }
      }
    }
    if (iVal === undefined) {
      iVal = fastSafeInt(word, parseBudget);
    }
    if (iVal === undefined || iVal < -1073741824 || iVal > 1073741823) {
      for (let r = 0; r < 32; r++) sharedLoopIntRegs[r] = sharedSavedLoopIntRegs[r]!;
      parseBudget.restore(savedBudget);
      sharedIntLoopResult.ok = false;
      sharedIntLoopResult.subBytes = 0;
      sharedIntLoopResult.subCount = 0;
      return sharedIntLoopResult;
    }
    sharedLoopIntRegs[0] = iVal | 0;
    for (let b = 0; b < stepCount; b++) {
      const intStep = intSteps[b]!;
      const res = evalCompiledSmi(intStep.compiled, intStep.varRegMap);
      if (res === 0x7fffffff) {
        for (let r = 0; r < 32; r++) sharedLoopIntRegs[r] = sharedSavedLoopIntRegs[r]!;
        parseBudget.restore(savedBudget);
        sharedIntLoopResult.ok = false;
        sharedIntLoopResult.subBytes = 0;
        sharedIntLoopResult.subCount = 0;
        return sharedIntLoopResult;
      }
      totalAdmitUnits = (totalAdmitUnits + _lastCompiledSmiAdmitUnits) | 0;
      sharedLoopIntRegs[intStep.targetReg] = res | 0;
      if (intStep.isSub) {
        let abs = res < 0 ? -res : res;
        let digits = res < 0 ? 2 : 1;
        while (abs >= 10) { abs = Math.trunc(abs / 10); digits++; }
        if (intStep.padWidth !== undefined && digits < intStep.padWidth) digits = intStep.padWidth;
        subBytes = subBytes + digits + intStep.extraNewlineByte;
        subCount = subCount + 1;
      }
    }
  }
  parseBudget.admit(totalAdmitUnits);
  sharedIntLoopResult.ok = true;
  sharedIntLoopResult.subBytes = subBytes;
  sharedIntLoopResult.subCount = subCount;
  return sharedIntLoopResult;
}
