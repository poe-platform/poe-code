import type { Expression, SubscriptItem } from "./ast.js";
import { PythonSyntaxError, type SourceMeter } from "./source.js";

/** Executable target-side expressions for an annotation without an RHS.
 * Key tuples flatten recursively, but slice bounds are ordinary expressions.
 * No target value, outer slice or outer tuple is constructed. Type expressions
 * are deliberately absent from the AST under the ignored-types policy.
 */
export function* annotationTargetExpressions(target: Expression, filename = "<string>", meter?: SourceMeter): Generator<Expression> {
  meter?.checkpoint(1,64);
  try {
  if (target.kind === "name") return;
  if (target.kind !== "attribute" && target.kind !== "subscript") throw new Error("annotation targets must be statically validated");
  yield target.object;
  if (target.kind === "attribute") return;
  meter?.checkpoint(0,96);
  const frames: { items: readonly SubscriptItem[]; index: number }[] = [{ items: target.items, index: 0 }];
  while (frames.length) {
    meter?.checkpoint();
    const frame = frames[frames.length - 1];
    if (frame.index === frame.items.length) { frames.pop(); continue; }
    const item = frame.items[frame.index++];
    if (item.kind === "tuple") {meter?.checkpoint(0,64);frames.push({ items: item.items, index: 0 });}
    else if (item.kind === "slice") {
      for(let index=0;index<3;index++){
        meter?.checkpoint();const bound=index===0?item.lower:index===1?item.upper:item.step;
        if(bound!==null)yield bound;
      }
    } else if (item.kind === "unpack") {meter?.checkpoint(0,320);throw new PythonSyntaxError("can't use starred expression here", filename, item.start);}
    else yield item;
  }
  } finally {meter?.checkpoint();}
}
