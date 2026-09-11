import type { Expression, InterpolatedPart, SubscriptItem } from "./ast.js";
import type {SourceMeter} from "./source.js";

/** Enumerate syntax children without inspecting host objects or literal buffers. */
export function* expressionChildren(node: Expression,meter?:SourceMeter): Generator<Expression> {
  meter?.checkpoint();
  switch (node.kind) {
    case "await": case "yield-from": yield node.value; return;
    case "yield": if (node.value) yield node.value; return;
    case "interpolated-string": yield* interpolatedExpressions(node.parts,meter); return;
    case "literal": case "name": return;
    case "assignment-expression": yield node.target; yield node.value; return;
    case "lambda":
      for (const parameter of node.parameters) {meter?.checkpoint();if (parameter.default) yield parameter.default;}
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
      for (const item of node.items) {meter?.checkpoint(1,64);yield* subscriptExpressions(item);}
      return;
    case "unary": yield node.operand; return;
    case "binary": case "boolean": yield node.left; yield node.right; return;
    case "comparison": yield* node.operands; return;
    case "conditional": yield node.condition; yield node.consequent; yield node.alternate; return;
    default: { const exhaustive: never = node; throw new Error(`unknown expression: ${exhaustive}`); }
  }
}

function* interpolatedExpressions(parts: readonly InterpolatedPart[],meter?:SourceMeter): Generator<Expression> {
  meter?.checkpoint(1,80);
  const frames=[{parts,index:0}];
  while(frames.length){
    meter?.checkpoint();const frame=frames[frames.length-1];
    if(frame.index===frame.parts.length){frames.pop();continue;}
    const part=frame.parts[frame.index++];
    if (part.kind === "field") {
      yield part.expression;
      if (part.format) {meter?.checkpoint(0,40);frames.push({parts:part.format,index:0});}
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
