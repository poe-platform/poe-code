import { Budget, ExprError } from "./internal.js";

export type Node =
  | { readonly kind: "literal"; readonly text: string; readonly depth: number }
  | { readonly kind: "binary"; readonly operator: string; readonly left: Node; readonly right: Node; readonly depth: number }
  | { readonly kind: "call"; readonly operator: string; readonly args: readonly Node[]; readonly depth: number };

const precedences = new Map([
  ["|", 1], ["&", 2], ["<", 3], ["<=", 3], ["=", 3], ["==", 3], ["!=", 3], [">=", 3], [">", 3],
  ["+", 4], ["-", 4], ["*", 5], ["/", 5], ["%", 5], [":", 6],
]);
const arities = new Map([["length", 1], ["index", 2], ["substr", 3], ["match", 2]]);

export function parse(args: readonly string[], budget: Budget, start = 0): Node {
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
  function node(value: Node): Node {
    budget.charge();
    budget.check(++nodes, budget.limits.maxNodes, "AST node");
    budget.check(value.depth, budget.limits.maxDepth, "AST depth");
    return value;
  }
  function prefix(depth: number): Node {
    budget.check(depth, budget.limits.maxDepth, "parser depth");
    if (position === args.length) fail(`syntax error: missing argument after ${quote(args[position - 1]!)}`);
    const token = args[position++]!;
    if (token === ")") fail("syntax error: unexpected ')'");
    if (token === "(") {
      const result = expression(1, depth + 1);
      if (position === args.length) fail(`syntax error: expecting ')' after ${quote(args[position - 1]!)}`);
      if (args[position] !== ")") fail(`syntax error: expecting ')' instead of ${quote(args[position]!)}`);
      position++;
      return result;
    }
    if (token === "+") {
      const text = args[position++];
      if (text === undefined) fail("syntax error: missing argument after '+'");
      return node({ kind: "literal", text, depth: 1 });
    }
    const arity = arities.get(token);
    if (arity !== undefined) {
      const operands: Node[] = [];
      for (let index = 0; index < arity; index++) operands.push(prefix(depth + 1));
      return node({ kind: "call", operator: token, args: operands, depth: 1 + Math.max(...operands.map(operand => operand.depth)) });
    }
    return node({ kind: "literal", text: token, depth: 1 });
  }
  function expression(minimum: number, depth: number): Node {
    let left = prefix(depth);
    while (position < args.length) {
      const operator = args[position]!;
      const precedence = precedences.get(operator);
      if (precedence === undefined || precedence < minimum) break;
      position++;
      const right = expression(precedence + 1, depth + 1);
      left = node({ kind: "binary", operator, left, right, depth: 1 + Math.max(left.depth, right.depth) });
    }
    return left;
  }
  if (position === args.length) fail("missing operand\nTry 'expr --help' for more information.");
  const result = expression(1, 1);
  if (position !== args.length) fail(`syntax error: unexpected argument ${quote(args[position]!)}`);
  return result;
}
