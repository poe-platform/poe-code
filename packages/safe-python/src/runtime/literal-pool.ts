import type { Expression } from "../ast.js";
import { expressionChildren } from "../expression-children.js";
import { statementChildren } from "../statement-children.js";
import { statementExpressions } from "../statement-expressions.js";
import type { Statement } from "../statement-ast.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { integerBitMetric } from "./integer-bit-metric.js";

export type LiteralExpression = Extract<Expression, { kind: "literal" }>;
export interface LiteralPool<Value> extends ReadonlyMap<LiteralExpression, Value> {
  readonly folded?: ReadonlyMap<Expression, Value>;
}
interface ConstantRecord<Value> { readonly value: Value; readonly literal?: LiteralExpression }
interface TuplePool<Value> { readonly children: Map<ConstantRecord<Value>, TuplePool<Value>>; record?: ConstantRecord<Value> }

/** Per-compilation scalar literal merging, never guest equality or global
 * interning. Type-separated keys preserve integer/float/bool distinctions and
 * code-point boundaries. Unary integer/float constants and immutable tuple
 * displays can share the same pool without guest equality or AST mutation.
 * General folding and metadata/docstring pooling remain separate compiler work. */
export function compileLiteralPool<Value>(body: readonly Statement[], literal: (node: LiteralExpression) => Value, meter: ExecutionMeter, tuple?: (values: readonly Value[]) => Value): LiteralPool<Value> {
  try {
  meter.checkpoint(1, 352 + body.length * 8);
  const folded = new Map<Expression, Value>(), records = new Map<Expression, ConstantRecord<Value>>();
  const result = Object.assign(new Map<LiteralExpression, Value>(), { folded });
  const kinds = new Map<LiteralExpression["literalKind"], Map<unknown, ConstantRecord<Value>>>();
  const tuples: TuplePool<Value> = { children: new Map() };
  const scalar = (node: LiteralExpression): ConstantRecord<Value> => {
    let pool = kinds.get(node.literalKind);
    if (pool === undefined) { meter.checkpoint(1, 96); pool = new Map(); kinds.set(node.literalKind, pool); }
    const key = literalKey(node, meter);
    let record = pool.get(key);
    if (record === undefined) {
      meter.checkpoint(1, 80);
      record = { value: literal(node), literal: node }; meter.checkpoint();
      pool.set(key, record);
    }
    return record;
  };
  const statements = [...body], first = body[0];
  while (statements.length) {
    meter.checkpoint(); const statement = statements.pop()!;
    if (statement === first && isDocstring(statement)) continue;
    meter.checkpoint(1, 160);
    const expressions: { node: Expression; after: boolean }[] = [];
    for (const node of statementExpressions(statement, false, meter)) { meter.checkpoint(1, 40); expressions.push({ node, after: false }); }
    while (expressions.length) {
      meter.checkpoint(); const { node: expression, after } = expressions.pop()!;
      if (records.has(expression)) continue;
      let record: ConstantRecord<Value> | undefined;
      if (expression.kind === "literal") {
        record = scalar(expression);
        meter.checkpoint(1, 48); result.set(expression, record.value);
      } else if (!after) {
        meter.checkpoint(0, 40); expressions.push({ node: expression, after: true });
        meter.checkpoint(0, 128);
        for (const child of expressionChildren(expression, meter)) { meter.checkpoint(1, 40); expressions.push({ node: child, after: false }); }
        continue;
      } else if (expression.kind === "unary") {
        const operand = records.get(expression.operand)?.literal;
        const node = operand === undefined ? undefined : foldUnary(expression, operand, meter);
        if (node !== undefined) record = scalar(node);
      } else if (expression.kind === "tuple" && tuple !== undefined) {
        let complete = true;
        for (const item of expression.items) { meter.checkpoint(); if (item.kind === "unpack" || !records.has(item)) { complete = false; break; } }
        if (complete) {
          let pool = tuples;
          for (const item of expression.items) {
            meter.checkpoint(); const child = records.get(item as Expression)!;
            let next = pool.children.get(child);
            if (next === undefined) { meter.checkpoint(0, 112); next = { children: new Map() }; pool.children.set(child, next); }
            pool = next;
          }
          if (pool.record === undefined) {
            meter.checkpoint(0, 64 + expression.items.length * 8);
            pool.record = { value: tuple(expression.items.map(item => records.get(item as Expression)!.value)) };
            meter.checkpoint();
          }
          record = pool.record;
        }
      }
      if (record !== undefined) {
        meter.checkpoint(0, 48); records.set(expression, record);
        if (expression.kind !== "literal") { meter.checkpoint(0, 48); folded.set(expression, record.value); }
      }
    }
    meter.checkpoint(0, 128);
    for (const child of statementChildren(statement, meter)) {
      if ((statement.kind === "function" || statement.kind === "class") && child === statement.body[0] && isDocstring(child)) continue;
      meter.checkpoint(1, 8); statements.push(child);
    }
  }
  return result;
  } finally { meter.checkpoint(); }
}

function foldUnary(node: Extract<Expression, { kind: "unary" }>, operand: LiteralExpression, meter: ExecutionMeter): LiteralExpression | undefined {
  const operator = node.operator;
  if (operator !== "+" && operator !== "-" && operator !== "~") return undefined;
  if (operator === "~" && operand.literalKind === "boolean") return undefined;
  if (operand.literalKind === "integer" || operand.literalKind === "boolean") {
    const value = operand.literalKind === "boolean" ? (operand.value ? 1n : 0n) : operand.value as bigint;
    const bits = integerBitMetric(value, "bit_length", meter);
    meter.checkpoint(1, 64 + Math.ceil(bits / 8));
    return { ...operand, start: node.start, end: node.end, literalKind: "integer", value: operator === "-" ? -value : operator === "~" ? ~value : value };
  }
  if (operand.literalKind === "float" && operator !== "~") {
    meter.checkpoint(1, 64);
    return { ...operand, start: node.start, end: node.end, value: operator === "-" ? -(operand.value as number) : operand.value };
  }
  return undefined;
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
