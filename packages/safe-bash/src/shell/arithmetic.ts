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

function treeFeatures(tree: Arithmetic): Pick<ArithmeticProgram, "hasSubscript" | "hasMutation"> {
  const pending = [tree];
  let hasSubscript = false;
  let hasMutation = false;
  while (pending.length) {
    const node = pending.pop()!;
    if (node.kind === "name") hasSubscript ||= node.subscript !== undefined;
    else if (node.kind === "unary") {
      hasMutation ||= node.operator === "++" || node.operator === "--";
      pending.push(node.operand);
    } else if (node.kind === "binary") {
      hasMutation ||= precedence[node.operator] === 2;
      pending.push(node.left, node.right);
    } else if (node.kind === "conditional") pending.push(node.condition, node.yes, node.no);
  }
  return { hasSubscript, hasMutation };
}

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
  let units = 0;
  const tracking = {
    admit(n = 1): void {
      budget.admit(n);
      units += n;
    },
  } as ParseBudget;
  tracking.admit();
  try {
    const tree = parseArithmetic(source, 0, tracking);
    const program: ArithmeticProgram = { source, tree, ...treeFeatures(tree) };
    if (source.length <= 256) {
      if (preparedArithmeticCache.size >= 512) {
        const oldest = preparedArithmeticCache.keys().next().value;
        if (oldest !== undefined) preparedArithmeticCache.delete(oldest);
      }
      preparedArithmeticCache.set(source, { program, units });
    }
    return program;
  }
  catch (error) {
    if (!(error instanceof ShellSyntaxError) || /nesting/u.test(error.reason)) throw error;
    tracking.admit();
    const program: ArithmeticProgram = { source, error };
    if (source.length <= 256) {
      if (preparedArithmeticCache.size >= 512) {
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

function integer(text: string): bigint {
  if (/^0[xX][\da-fA-F]+$/u.test(text)) return BigInt(text);
  if (/^0[0-7]+$/u.test(text)) return BigInt(`0o${text.slice(1)}`);
  if (/^0\d+$/u.test(text)) throw new PublicDiagnostic("Invalid octal constant");
  if (/^\d+$/u.test(text)) return BigInt(text);
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

export function parseArithmetic(source: string, offset = 0, budget = new ParseBudget()): Arithmetic {
  const tokens: { value: string; offset: number }[] = [];
  let position = 0;
  while (position < source.length) {
    if (/\s/u.test(source[position]!)) { position++; continue; }
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
        if (depth > 64) throw new ShellSyntaxError("Arithmetic nesting exceeds 64", offset + start);
      }
      if (depth) throw new ShellSyntaxError("Unclosed arithmetic subscript", offset + start);
      budget.admit(position - start);
      tokens.push({ value: source.slice(start, position), offset: offset + start });
      continue;
    }
    const value = /^(?:\d+#[\da-zA-Z@_]+|0[xX][\da-fA-F]+|\d+|[a-zA-Z_][a-zA-Z_0-9]*|<<=|>>=|\*\*|\+\+|--|&&|\|\||<<|>>|[+*/%&^|!<>=-]=|[()+*/%~!<>=&^|?:,\-])/u.exec(source.slice(position))?.[0];
    if (!value) {
      const previous = tokens.at(-1)?.value;
      const quoted = source[position] === "'" || source[position] === "\\";
      const operand = previous === undefined || previous === "(" || previous === ":" || previous === "!" || previous === "~" || precedence[previous] !== undefined;
      throw new ShellSyntaxError(quoted ? operand ? "Quoted arithmetic operand expected" : "Invalid quoted arithmetic operator" : "Unsupported arithmetic token", offset + position);
    }
    budget.admit();
    tokens.push({ value, offset: offset + position });
    position += value.length;
  }
  let cursor = 0;
  let depth = 0;
  const current = () => tokens[cursor]?.value ?? "";
  const error = (message: string): never => { throw new ShellSyntaxError(message, tokens[cursor]?.offset ?? offset + source.length); };
  const expression = (minimum = 1): Arithmetic => {
    if (++depth > 64) error("Arithmetic nesting exceeds 64");
    let left: Arithmetic;
    const start = tokens[cursor]?.offset ?? offset + source.length;
    const token = current();
    cursor++;
    if (["+", "-", "!", "~", "++", "--"].includes(token)) {
      budget.admit();
      const operand = expression(15);
      if (["++", "--"].includes(token) && operand.kind !== "name") error("Arithmetic assignment requires a variable");
      left = { kind: "unary", operator: token, operand, postfix: false };
    } else if (token === "(") {
      left = expression();
      if (current() !== ")") error("Unclosed arithmetic parenthesis");
      cursor++;
    } else if (/^[a-zA-Z_]/u.test(token)) {
      budget.admit();
      left = { kind: "name", name: token };
      if (current().startsWith("[")) {
        left.subscript = current().slice(1, -1);
        if (!left.subscript.trim()) error("Invalid arithmetic operand");
        cursor++;
      }
    }
    else {
      budget.admit();
      try { left = { kind: "literal", value: BigInt.asIntN(64, integer(token)) }; }
      catch { error("Invalid arithmetic operand"); }
    }
    left!.start = start;
    while (true) {
      const operator = current();
      if (operator === "++" || operator === "--") {
        if (left!.kind !== "name") error("Arithmetic assignment requires a variable");
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
        if (assignment && left!.kind !== "name") error("Arithmetic assignment requires a variable");
        const right = expression(priority + (assignment || operator === "**" ? 0 : 1));
        left = { kind: "binary", operator, left: left!, right, start };
      }
    }
    depth--;
    return left!;
  };
  if (!tokens.length) { budget.admit(); return { kind: "literal", value: 0n }; }
  const tree = expression();
  if (cursor < tokens.length) error("Unexpected arithmetic token");
  return tree;
}

export function arithmeticEnd(source: string, start: number, allowSubshell = false): number {
  let depth = 0;
  let quote = "";
  let ansiQuote = false;
  const quotedSubstitutions: number[] = [];
  for (let position = start; position < source.length; position++) {
    const character = source[position];
    if (allowSubshell) {
      if (character === "\\" && (quote !== "'" || ansiQuote)) { position++; continue; }
      if (quote === '"' && character === "$" && source[position + 1] === "(") {
        if (quotedSubstitutions.length >= 64) throw new ShellSyntaxError("Syntax nesting exceeds 64", position);
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
      if (depth === 0 && source[position + 1] === ")") return position;
      if (--depth < 0) {
        if (allowSubshell) return -1;
        break;
      }
      if (quotedSubstitutions.at(-1) === depth) {
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

export function intToStr(n: number): string {
  if (n >= 0 && n <= 65536) {
    return SMALL_INT_STRINGS[n] ??= String(n);
  }
  return String(n);
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

function canEvalSafeSmiTree(node: Arithmetic, depth = 0): boolean {
  if (depth > 32) return false;
  if (node.kind === "literal") return node.value >= -94906265n && node.value <= 94906265n;
  if (node.kind === "name") return node.subscript === undefined;
  if (node.kind === "unary") {
    if (node.operator === "+" || node.operator === "-" || node.operator === "!") return canEvalSafeSmiTree(node.operand, depth + 1);
    if (node.operator === "++" || node.operator === "--") return node.operand.kind === "name" && node.operand.subscript === undefined && depth === 0;
    return false;
  }
  if (node.kind === "binary") {
    if ((node.operator === "=" || node.operator === "+=" || node.operator === "-=" || node.operator === "*=") && depth === 0) {
      return node.left.kind === "name" && node.left.subscript === undefined && canEvalSafeSmiTree(node.right, depth + 1);
    }
    if (
      node.operator === "+" || node.operator === "-" || node.operator === "*" ||
      node.operator === "<" || node.operator === "<=" || node.operator === ">" ||
      node.operator === ">=" || node.operator === "==" || node.operator === "!="
    ) {
      return canEvalSafeSmiTree(node.left, depth + 1) && canEvalSafeSmiTree(node.right, depth + 1);
    }
    if (node.operator === "/" || node.operator === "%") {
      return node.right.kind === "literal" && node.right.value !== 0n && node.right.value >= -94906265n && node.right.value <= 94906265n && canEvalSafeSmiTree(node.left, depth + 1);
    }
  }
  return false;
}

function evalSafeSmi(node: Arithmetic, refs: ArithmeticReferences, budget: ParseBudget): number | undefined {
  budget.admit(0);
  if (node.kind === "literal") return Number(node.value);
  if (node.kind === "name") {
    const ref = refs.resolve(node.name, undefined) as string;
    const text = refs.read(ref) as string | undefined;
    return fastSafeInt(text, budget);
  }
  if (node.kind === "unary") {
    if (node.operator === "++" || node.operator === "--") {
      const target = node.operand as Extract<Arithmetic, { kind: "name" }>;
      const ref = refs.resolve(target.name, undefined) as string;
      const cur = fastSafeInt(refs.read(ref) as string | undefined, budget);
      if (cur === undefined || cur < -94906264 || cur > 94906264) return undefined;
      const next = node.operator === "++" ? cur + 1 : cur - 1;
      refs.write(ref, intToStr(next));
      return node.postfix ? cur : next;
    }
    const v = evalSafeSmi(node.operand, refs, budget);
    if (v === undefined || v < -94906265 || v > 94906265) return undefined;
    if (node.operator === "+") return v;
    if (node.operator === "-") return -v;
    if (node.operator === "!") return v === 0 ? 1 : 0;
    return undefined;
  }
  if (node.kind === "binary") {
    if (node.operator === "=") {
      const r = evalSafeSmi(node.right, refs, budget);
      if (r === undefined || r < -94906265 || r > 94906265) return undefined;
      const target = node.left as Extract<Arithmetic, { kind: "name" }>;
      const ref = refs.resolve(target.name, undefined) as string;
      refs.write(ref, intToStr(r));
      return r;
    }
    if (node.operator === "+=" || node.operator === "-=" || node.operator === "*=") {
      const target = node.left as Extract<Arithmetic, { kind: "name" }>;
      const ref = refs.resolve(target.name, undefined) as string;
      const l = fastSafeInt(refs.read(ref) as string | undefined, budget);
      if (l === undefined || l < -94906265 || l > 94906265) return undefined;
      const r = evalSafeSmi(node.right, refs, budget);
      if (r === undefined || r < -94906265 || r > 94906265) return undefined;
      const updated = node.operator === "+=" ? l + r : node.operator === "-=" ? l - r : l * r;
      refs.write(ref, intToStr(updated));
      return updated;
    }
    const l = evalSafeSmi(node.left, refs, budget);
    if (l === undefined || l < -94906265 || l > 94906265) return undefined;
    const r = evalSafeSmi(node.right, refs, budget);
    if (r === undefined || r < -94906265 || r > 94906265) return undefined;
    switch (node.operator) {
      case "+": return l + r;
      case "-": return l - r;
      case "*": return l * r;
      case "/": return Math.trunc(l / r);
      case "%": return (l % r) | 0;
      case "<": return l < r ? 1 : 0;
      case "<=": return l <= r ? 1 : 0;
      case ">": return l > r ? 1 : 0;
      case ">=": return l >= r ? 1 : 0;
      case "==": return l === r ? 1 : 0;
      case "!=": return l !== r ? 1 : 0;
    }
  }
  return undefined;
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
    if (node.operator === "+" || node.operator === "-" || node.operator === "!") {
      return collectPureSmiTreeNames(node.operand, names, depth + 1);
    }
    return false;
  }
  if (node.kind === "binary") {
    if (
      node.operator === "+" || node.operator === "-" || node.operator === "*" ||
      node.operator === "<" || node.operator === "<=" || node.operator === ">" ||
      node.operator === ">=" || node.operator === "==" || node.operator === "!="
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
    }
  }
  return undefined;
}

export function isSafeSmiProgram(program: ArithmeticProgram): boolean {
  if (program.error || !program.tree) return false;
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
export const sharedLoopIntRegs = new Int32Array(32);
const sharedRpnStack = new Int32Array(32);

export interface CompiledSmiExpr {
  readonly ops: Int32Array;
  readonly args: Int32Array;
  readonly varNames: readonly string[];
}

const compiledSmiCache = new WeakMap<ArithmeticProgram, CompiledSmiExpr | null>();

export function compilePureSmiProgram(program: ArithmeticProgram, namesOut: Set<string>): CompiledSmiExpr | undefined {
  if (program.error || program.hasSubscript || !program.tree) return undefined;
  const cached = compiledSmiCache.get(program);
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
      if (node.operator !== "+" && node.operator !== "-" && node.operator !== "!") return false;
      if (!visit(node.operand, depth + 1)) return false;
      ops.push(node.operator === "+" ? 2 : node.operator === "-" ? 3 : 4);
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
    compiledSmiCache.set(program, null);
    return undefined;
  }
  for (let i = 0; i < varNames.length; i++) namesOut.add(varNames[i]!);
  const compiled: CompiledSmiExpr = {
    ops: new Int32Array(ops),
    args: new Int32Array(args),
    varNames,
  };
  compiledSmiCache.set(program, compiled);
  return compiled;
}

export function evalCompiledSmi(compiled: CompiledSmiExpr, varRegMap: Int32Array, budget: ParseBudget): number {
  const ops = compiled.ops;
  const args = compiled.args;
  const len = ops.length;
  if (len === 3 && ops[0] === 1 && ops[1] === 0 && ops[2] === 7) {
    const v0 = sharedLoopIntRegs[varRegMap[args[0]!]!]!;
    budget.admit(v0 < 0 ? 4 : 2);
    return Math.imul(v0, args[1]!) | 0;
  }
  if (len === 3 && ops[0] === 1 && ops[1] === 1 && ops[2] === 5) {
    const v0 = sharedLoopIntRegs[varRegMap[args[0]!]!]!;
    const v1 = sharedLoopIntRegs[varRegMap[args[1]!]!]!;
    budget.admit((v0 < 0 ? 4 : 2) + (v1 < 0 ? 4 : 2));
    return (v0 + v1) | 0;
  }
  if (len === 9 && ops[0] === 1 && ops[1] === 1 && ops[2] === 0 && ops[3] === 7 && ops[4] === 5 && ops[5] === 1 && ops[6] === 0 && ops[7] === 9 && ops[8] === 6) {
    const v0 = sharedLoopIntRegs[varRegMap[args[0]!]!]!;
    const v1 = sharedLoopIntRegs[varRegMap[args[1]!]!]!;
    const v2 = sharedLoopIntRegs[varRegMap[args[5]!]!]!;
    budget.admit((v0 < 0 ? 4 : 2) + (v1 < 0 ? 4 : 2) + (v2 < 0 ? 4 : 2));
    return ((v0 + Math.imul(v1, args[2]!)) - (v2 % args[6]!)) | 0;
  }
  let sp = 0;
  let admitUnits = 0;
  for (let pc = 0; pc < len; pc++) {
    const op = ops[pc]!;
    if (op === 0) {
      sharedRpnStack[sp++] = args[pc]!;
    } else if (op === 1) {
      const val = sharedLoopIntRegs[varRegMap[args[pc]!]!]!;
      admitUnits += val < 0 ? 4 : 2;
      sharedRpnStack[sp++] = val;
    } else if (op <= 4) {
      const v = sharedRpnStack[sp - 1]!;
      sharedRpnStack[sp - 1] = op === 2 ? v : op === 3 ? (-v) | 0 : (v === 0 ? 1 : 0);
    } else {
      sp--;
      const r = sharedRpnStack[sp]!;
      const l = sharedRpnStack[sp - 1]!;
      let res = 0;
      switch (op) {
        case 5: res = (l + r) | 0; break;
        case 6: res = (l - r) | 0; break;
        case 7: res = Math.imul(l, r) | 0; break;
        case 8: res = (l / r) | 0; break;
        case 9: res = (l % r) | 0; break;
        case 10: res = l < r ? 1 : 0; break;
        case 11: res = l <= r ? 1 : 0; break;
        case 12: res = l > r ? 1 : 0; break;
        case 13: res = l >= r ? 1 : 0; break;
        case 14: res = l === r ? 1 : 0; break;
        case 15: res = l !== r ? 1 : 0; break;
      }
      sharedRpnStack[sp - 1] = res;
    }
  }
  budget.admit(admitUnits);
  return sharedRpnStack[0]!;
}

export interface FastIntStepDesc {
  readonly name: string;
  readonly compiled: CompiledSmiExpr;
  readonly varRegMap: Int32Array;
  targetReg: number;
  readonly isSub: boolean;
  readonly extraNewlineByte: number;
}

export function runIntArithForLoop(
  startVal: number,
  limitVal: number,
  isLe: boolean,
  stepCount: number,
  deferredMask: number,
  intSteps: readonly (FastIntStepDesc | undefined)[],
  parseBudget: ParseBudget,
): { lastInductionInt: number | undefined; subBytes: number; subCount: number } {
  let iVal = startVal | 0;
  sharedLoopIntRegs[0] = iVal;
  parseBudget.admit(0);
  let lastInductionInt: number | undefined;
  let subBytes = 0;
  let subCount = 0;
  while (isLe ? iVal <= limitVal : iVal < limitVal) {
    parseBudget.admit(iVal < 0 ? 4 : 2);
    lastInductionInt = iVal;
    for (let b = 0; b < stepCount; b++) {
      if (deferredMask & (1 << b)) continue;
      const intStep = intSteps[b]!;
      const res = evalCompiledSmi(intStep.compiled, intStep.varRegMap, parseBudget);
      sharedLoopIntRegs[intStep.targetReg] = res;
      if (intStep.isSub) {
        let abs = res < 0 ? -res : res;
        let digits = res < 0 ? 2 : 1;
        while (abs >= 10) { abs = (abs / 10) | 0; digits++; }
        subBytes = (subBytes + digits + intStep.extraNewlineByte) | 0;
        subCount = (subCount + 1) | 0;
      }
    }
    parseBudget.admit(iVal < 0 ? 4 : 2);
    iVal = (iVal + 1) | 0;
    sharedLoopIntRegs[0] = iVal;
  }
  return { lastInductionInt, subBytes, subCount };
}

export function runIntForLoop(
  words: readonly string[],
  stepCount: number,
  intSteps: readonly (FastIntStepDesc | undefined)[],
  parseBudget: ParseBudget,
): { ok: boolean; subBytes: number; subCount: number } {
  let subBytes = 0;
  let subCount = 0;
  for (let idx = 0; idx < words.length; idx++) {
    const iVal = fastSafeInt(words[idx]!, parseBudget);
    if (iVal === undefined) return { ok: false, subBytes: 0, subCount: 0 };
    sharedLoopIntRegs[0] = iVal | 0;
    for (let b = 0; b < stepCount; b++) {
      const intStep = intSteps[b]!;
      const res = evalCompiledSmi(intStep.compiled, intStep.varRegMap, parseBudget);
      sharedLoopIntRegs[intStep.targetReg] = res;
      if (intStep.isSub) {
        let abs = res < 0 ? -res : res;
        let digits = res < 0 ? 2 : 1;
        while (abs >= 10) { abs = (abs / 10) | 0; digits++; }
        subBytes = (subBytes + digits + intStep.extraNewlineByte) | 0;
        subCount = (subCount + 1) | 0;
      }
    }
  }
  return { ok: true, subBytes, subCount };
}
