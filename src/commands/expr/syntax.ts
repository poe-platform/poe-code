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
  function node(value: Node): Node {
    budget.charge();
    budget.check(++nodes, budget.limits.maxNodes, "AST node");
    budget.check(value.depth, budget.limits.maxDepth, "AST depth");
    return value;
  }
  function prefix(depth: number): Node {
    budget.check(depth, budget.limits.maxDepth, "parser depth");
    const token = args[position++];
    if (token === undefined) throw new ExprError("syntax error: missing operand");
    if (token === ")") throw new ExprError("syntax error: unexpected ')'");
    if (token === "(") {
      const result = expression(1, depth + 1);
      if (args[position++] !== ")") throw new ExprError("syntax error: expecting ')'");
      return result;
    }
    if (token === "+") {
      const text = args[position++];
      if (text === undefined) throw new ExprError("syntax error: missing operand after '+'");
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
  const result = expression(1, 1);
  if (position !== args.length) throw new ExprError("syntax error: unexpected argument");
  return result;
}
