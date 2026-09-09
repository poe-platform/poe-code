import type { Expression, InterpolatedPart, SubscriptItem } from "./ast.js";

/** Enumerate syntax children without inspecting host objects or literal buffers. */
export function* expressionChildren(node: Expression): Generator<Expression> {
  switch (node.kind) {
    case "await": case "yield-from": yield node.value; return;
    case "yield": if (node.value) yield node.value; return;
    case "interpolated-string": yield* interpolatedExpressions(node.parts); return;
    case "literal": case "name": return;
    case "assignment-expression": yield node.target; yield node.value; return;
    case "lambda":
      for (const parameter of node.parameters) if (parameter.default) yield parameter.default;
      yield node.body; return;
    case "comprehension": case "dictionary-comprehension":
      for (const clause of node.clauses) { yield clause.target; yield clause.iterable; yield* clause.filters; }
      if (node.kind === "comprehension") yield node.element;
      else { yield node.key; yield node.value; }
      return;
    case "tuple": case "list": case "set":
      for (const item of node.items) yield item.kind === "unpack" ? item.value : item;
      return;
    case "dictionary":
      for (const entry of node.entries) { if (entry.kind === "entry") yield entry.key; yield entry.value; }
      return;
    case "attribute": yield node.object; return;
    case "call":
      yield node.callee;
      for (const argument of node.arguments) yield argument.value;
      return;
    case "subscript":
      yield node.object;
      for (const item of node.items) yield* subscriptExpressions(item);
      return;
    case "unary": yield node.operand; return;
    case "binary": case "boolean": yield node.left; yield node.right; return;
    case "comparison": yield* node.operands; return;
    case "conditional": yield node.condition; yield node.consequent; yield node.alternate; return;
    default: { const exhaustive: never = node; throw new Error(`unknown expression: ${exhaustive}`); }
  }
}

function* interpolatedExpressions(parts: readonly InterpolatedPart[]): Generator<Expression> {
  for (const part of parts) {
    if (part.kind === "field") {
      yield part.expression;
      if (part.format) yield* interpolatedExpressions(part.format);
    }
  }
}

function* subscriptExpressions(item: SubscriptItem): Generator<Expression> {
  if (item.kind === "slice") {
    if (item.lower) yield item.lower;
    if (item.upper) yield item.upper;
    if (item.step) yield item.step;
  } else yield item.kind === "unpack" ? item.value : item;
}
