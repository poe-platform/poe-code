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

export function fastDecimalLiteral(text: string | undefined, budget: ParseBudget): bigint | undefined {
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

export const precedence: Record<string, number> = {
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

export function binaryArithmeticOp(operator: string, left: bigint, right: bigint, offset: number): bigint {
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

export function formatArithmeticError(program: ArithmeticProgram, error: unknown): never {
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

export function evaluateArithmetic(program: ArithmeticProgram, variables: Record<string, string>, budget = new ParseBudget()): bigint {
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

export function* arithmeticEvaluation(program: ArithmeticProgram, references: ArithmeticReferences, budget: ParseBudget): Generator<string | undefined | void | Promise<string | undefined | void>, bigint, string | undefined> {
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