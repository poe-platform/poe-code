import type { Expression } from "../ast.js";
import { expressionChildren } from "../expression-children.js";
import { statementChildren } from "../statement-children.js";
import { statementExpressions } from "../statement-expressions.js";
import type { Statement } from "../statement-ast.js";
import type { ExecutionMeter } from "./execution-budget.js";

export type LiteralExpression = Extract<Expression, { kind: "literal" }>;
export type LiteralPool<Value> = ReadonlyMap<LiteralExpression, Value>;

/** Per-compilation scalar literal merging, never guest equality or global
 * interning. Type-separated keys preserve integer/float/bool distinctions and
 * code-point boundaries. Folding compound constants and pooling metadata or
 * docstrings are separate compiler work. Annotations are absent from this AST. */
export function compileLiteralPool<Value>(body: readonly Statement[], literal: (node: LiteralExpression) => Value, meter: ExecutionMeter): LiteralPool<Value> {
  meter.checkpoint(1, 160 + body.length * 8);
  const result = new Map<LiteralExpression, Value>(), kinds = new Map<LiteralExpression["literalKind"], Map<unknown, Value>>();
  const statements = [...body], first = body[0];
  while (statements.length) {
    meter.checkpoint(); const statement = statements.pop()!;
    if (statement === first && isDocstring(statement)) continue;
    meter.checkpoint(1, 32);
    const expressions: Expression[] = [];
    for (const expression of statementExpressions(statement, false)) { meter.checkpoint(1, 8); expressions.push(expression); }
    while (expressions.length) {
      meter.checkpoint(); const expression = expressions.pop()!;
      if (expression.kind === "literal") {
        if (result.has(expression)) continue;
        let pool = kinds.get(expression.literalKind);
        if (pool === undefined) { meter.checkpoint(1, 96); pool = new Map(); kinds.set(expression.literalKind, pool); }
        const key = literalKey(expression, meter);
        if (!pool.has(key)) { meter.checkpoint(1, 48); pool.set(key, literal(expression)); }
        meter.checkpoint(1, 48); result.set(expression, pool.get(key)!);
      } else for (const child of expressionChildren(expression)) { meter.checkpoint(1, 8); expressions.push(child); }
    }
    for (const child of statementChildren(statement)) {
      if ((statement.kind === "function" || statement.kind === "class") && child === statement.body[0] && isDocstring(child)) continue;
      meter.checkpoint(1, 8); statements.push(child);
    }
  }
  return result;
}

function literalKey(node: LiteralExpression, meter: ExecutionMeter): unknown {
  const value = node.value;
  if (value instanceof Uint32Array || value instanceof Uint8Array) {
    let key = "";
    for (const point of value) {
      meter.checkpoint(1, 16);
      key += point.toString(16) + ",";
    }
    return key;
  }
  if (typeof value === "number") {
    if (Object.is(value, -0)) return "-0";
    if (Number.isNaN(value)) { meter.checkpoint(1, 32); return Symbol("NaN constant"); }
  }
  return value;
}

function isDocstring(statement: Statement): boolean {
  return statement.kind === "expression-statement" && statement.expression.kind === "literal" && statement.expression.literalKind === "string";
}
