import { Budget, ExprError } from "./internal.js";
import { evaluateBinary, evaluateCall, truth, zeroValue, type Matcher, type Value } from "./evaluate.js";

type Operand =
  | { readonly active: true; readonly value: Value; readonly depth: number }
  | { readonly active: false; readonly depth: number };

const precedences = new Map([
  ["|", 1], ["&", 2], ["<", 3], ["<=", 3], ["=", 3], ["==", 3], ["!=", 3], [">=", 3], [">", 3],
  ["+", 4], ["-", 4], ["*", 5], ["/", 5], ["%", 5], [":", 6],
]);
const arities = new Map([["length", 1], ["index", 2], ["substr", 3], ["match", 2]]);

export async function evaluateExpression(args: readonly string[], budget: Budget, match: Matcher, start = 0): Promise<Value> {
  let position = start;
  let nodes = 0;
  function fail(message: string): never {
    const size = Buffer.byteLength(message) + 7;
    budget.check(size, budget.limits.maxOutputBytes, "output bytes");
    budget.charge(size);
    throw new ExprError(message);
  }
  function quote(text: string): string {
    const input = budget.encode(text);
    const fragments = ["'"];
    let size = 2;
    budget.check(size, budget.limits.maxStringBytes, "string allocation");
    for (const byte of input) {
      const escaped = byte === 39 ? "\\'" : byte === 92 ? "\\\\"
        : byte === 7 ? "\\a" : byte === 8 ? "\\b" : byte === 9 ? "\\t"
          : byte === 10 ? "\\n" : byte === 11 ? "\\v" : byte === 12 ? "\\f" : byte === 13 ? "\\r"
            : byte < 32 || byte >= 127 ? `\\${byte.toString(8).padStart(3, "0")}` : String.fromCharCode(byte);
      size += escaped.length;
      budget.check(size, budget.limits.maxStringBytes, "string allocation");
      budget.charge(escaped.length);
      fragments.push(escaped);
    }
    fragments.push("'");
    return fragments.join("");
  }
  async function node(depth: number): Promise<void> {
    budget.charge();
    budget.check(++nodes, budget.limits.maxNodes, "AST node");
    budget.check(depth, budget.limits.maxDepth, "AST depth");
    await budget.yield();
  }
  async function literal(text: string, active: boolean): Promise<Operand> {
    await node(1);
    return active ? { active, value: budget.encode(text), depth: 1 } : { active, depth: 1 };
  }
  async function prefix(depth: number, active: boolean): Promise<Operand> {
    budget.check(depth, budget.limits.maxDepth, "parser depth");
    if (position === args.length) fail(`syntax error: missing argument after ${quote(args[position - 1]!)}`);
    const token = args[position++]!;
    if (token === ")") fail("syntax error: unexpected ')'");
    if (token === "(") {
      const result = await expression(1, depth + 1, active);
      if (position === args.length) fail(`syntax error: expecting ')' after ${quote(args[position - 1]!)}`);
      if (args[position] !== ")") fail(`syntax error: expecting ')' instead of ${quote(args[position]!)}`);
      position++;
      return result;
    }
    if (token === "+") {
      const text = args[position++];
      if (text === undefined) fail("syntax error: missing argument after '+'");
      return literal(text, active);
    }
    const arity = arities.get(token);
    if (arity !== undefined) {
      const values: Value[] = [];
      let operandDepth = 0;
      for (let index = 0; index < arity; index++) {
        const operand = await prefix(depth + 1, active);
        operandDepth = Math.max(operandDepth, operand.depth);
        if (operand.active) values.push(operand.value);
      }
      const resultDepth = 1 + operandDepth;
      await node(resultDepth);
      return active ? { active, value: await evaluateCall(token, values, budget, match), depth: resultDepth }
        : { active, depth: resultDepth };
    }
    return literal(token, active);
  }
  async function expression(minimum: number, depth: number, active: boolean): Promise<Operand> {
    let left = await prefix(depth, active);
    while (position < args.length) {
      const operator = args[position]!;
      const precedence = precedences.get(operator);
      if (precedence === undefined || precedence < minimum) break;
      position++;
      const logical = operator === "|" || operator === "&";
      const leftTruth = left.active && logical ? truth(left.value, budget) : false;
      const enabled = operator === "|" ? !leftTruth : operator === "&" ? leftTruth : true;
      const right = await expression(precedence + 1, depth + 1, active && enabled);
      const resultDepth = 1 + Math.max(left.depth, right.depth);
      await node(resultDepth);
      if (!left.active) left = { active: false, depth: resultDepth };
      else if (logical) {
        const value = operator === "|" ? leftTruth ? left.value : right.active && truth(right.value, budget) ? right.value : zeroValue
          : leftTruth && right.active && truth(right.value, budget) ? left.value : zeroValue;
        left = { active: true, value, depth: resultDepth };
      } else if (right.active) {
        left = { active: true, value: await evaluateBinary(operator, left.value, right.value, budget, match), depth: resultDepth };
      }
    }
    return left;
  }
  if (position === args.length) fail("missing operand\nTry 'expr --help' for more information.");
  const result = await expression(1, 1, true);
  if (position !== args.length) fail(`syntax error: unexpected argument ${quote(args[position]!)}`);
  if (!result.active) throw new ExprError("inactive expression", 3);
  return result.value;
}
