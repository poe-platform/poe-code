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
}

class ArithmeticFailure extends Error {
  constructor(message: string, readonly offset: number) { super(message); }
}

const preparedArithmeticCache = new Map<string, { program: ArithmeticProgram; units: number }>();

function treeHasSubscript(node: Arithmetic | undefined): boolean {
  if (!node) return false;
  switch (node.kind) {
    case "literal": return false;
    case "name": return node.subscript !== undefined;
    case "unary": return treeHasSubscript(node.operand);
    case "binary": return treeHasSubscript(node.left) || treeHasSubscript(node.right);
    case "conditional": return treeHasSubscript(node.condition) || treeHasSubscript(node.yes) || treeHasSubscript(node.no);
  }
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
    const program: ArithmeticProgram = { source, tree, hasSubscript: treeHasSubscript(tree) };
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

export function evaluateArithmeticSync(program: ArithmeticProgram, references: ArithmeticReferences, budget: ParseBudget): bigint {
  try {
    if (program.error) throw program.error;
    let visiting: Set<string> | undefined;
    const evalNameValue = (node: Extract<Arithmetic, { kind: "name" }>): bigint => {
      const reference = references.resolve(node.name, node.subscript) as string;
      if (visiting?.has(reference)) throw new PublicDiagnostic("Arithmetic variable recursion");
      const text = references.read(reference) as string | undefined;
      const fast = fastDecimalLiteral(text, budget);
      if (fast !== undefined) return fast;
      visiting ??= new Set();
      visiting.add(reference);
      try {
        return evalNode(parseArithmetic(text ?? "0", 0, budget));
      } finally {
        visiting.delete(reference);
      }
    };
    const evalName = (node: Extract<Arithmetic, { kind: "name" }>): { reference: string; value: bigint } => {
      const reference = references.resolve(node.name, node.subscript) as string;
      if (visiting?.has(reference)) throw new PublicDiagnostic("Arithmetic variable recursion");
      const text = references.read(reference) as string | undefined;
      const fast = fastDecimalLiteral(text, budget);
      if (fast !== undefined) return { reference, value: fast };
      visiting ??= new Set();
      visiting.add(reference);
      try {
        return { reference, value: evalNode(parseArithmetic(text ?? "0", 0, budget)) };
      } finally {
        visiting.delete(reference);
      }
    };
    const evalNode = (node: Arithmetic): bigint => {
      budget.admit(0);
      switch (node.kind) {
        case "literal":
          return node.value;
        case "name":
          return evalNameValue(node);
        case "conditional": {
          const cond = evalNode(node.condition);
          return evalNode(cond ? node.yes : node.no);
        }
        case "unary": {
          if (node.operator === "+") return BigInt.asIntN(64, evalNode(node.operand));
          if (node.operator === "-") return BigInt.asIntN(64, -evalNode(node.operand));
          if (node.operator === "!") return BigInt(!evalNode(node.operand));
          if (node.operator === "~") return BigInt.asIntN(64, ~evalNode(node.operand));
          const { reference, value: operand } = evalName(node.operand as Extract<Arithmetic, { kind: "name" }>);
          const updated = BigInt.asIntN(64, operand + (node.operator === "++" ? 1n : -1n));
          references.write(reference, String(updated));
          return node.postfix ? BigInt.asIntN(64, operand) : updated;
        }
        case "binary": {
          if (node.operator === "&&" || node.operator === "||") {
            const left = evalNode(node.left);
            if (node.operator === "&&" ? left === 0n : left !== 0n) return BigInt(left !== 0n);
            return BigInt(evalNode(node.right) !== 0n);
          }
          if (node.operator === ",") {
            evalNode(node.left);
            return BigInt.asIntN(64, evalNode(node.right));
          }
          if (node.operator === "=") {
            const right = evalNode(node.right);
            const operand = node.left as Extract<Arithmetic, { kind: "name" }>;
            const reference = references.resolve(operand.name, operand.subscript) as string;
            const updated = BigInt.asIntN(64, right);
            references.write(reference, String(updated));
            return updated;
          }
          if (precedence[node.operator] === 2) {
            const { reference, value: left } = evalName(node.left as Extract<Arithmetic, { kind: "name" }>);
            const right = evalNode(node.right);
            const updated = BigInt.asIntN(64, binaryArithmeticOp(node.operator.slice(0, -1), left, right, node.right.start ?? 0));
            references.write(reference, String(updated));
            return updated;
          }
          const left = evalNode(node.left);
          const right = evalNode(node.right);
          return BigInt.asIntN(64, binaryArithmeticOp(node.operator, left, right, node.right.start ?? 0));
        }
      }
    };
    return evalNode(program.tree!);
  } catch (error) {
    formatArithmeticError(program, error);
  }
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
