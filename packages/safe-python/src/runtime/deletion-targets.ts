import type { CollectionItem, Expression,SourceSpan } from "../ast.js";
import type { ExecutionMeter } from "./execution-budget.js";

export interface DeletionContext {
  /** Name deletion sites; retained references own attribute/subscript sites. */
  position?(site:SourceSpan):void;
  removeName(name: string): void;
  /** Evaluate receiver/key now without reading the target's current value.
   * Scope storage, descriptors, subscriptions and internal metering are owned
   * by the adapter; later deletion must use this resolved reference.
   */
  resolve(target: Extract<Expression, { kind: "attribute" | "subscript" }>): { remove(): void };
}

export interface ResumableDeletionContext<Value> extends Pick<DeletionContext, "removeName" | "position"> {
  resolve(target: Extract<Expression, { kind: "attribute" | "subscript" }>): Generator<Value, { remove(): void }, Value>;
}

type DeletionExecution<Value> =
  | { kind: "synchronous"; context: DeletionContext }
  | { kind: "resumable"; context: ResumableDeletionContext<Value> };

/** Execute statically validated del targets, preserving earlier side effects
 * after a failure. Target lists describe deletions, not iterable unpacking.
 * Explicit frames use O(nesting depth) space and are charged cumulatively before
 * allocation. Guest reference operations have required checkpoints.
 */
export function deleteTargets(targets: readonly Expression[], context: DeletionContext, meter: ExecutionMeter): void {
  meter.checkpoint(1, 224);
  const result = deletionContinuation(targets, { kind: "synchronous", context }, meter).next();
  if (!result.done) throw Error("synchronous deletion unexpectedly suspended");
}

export function createDeletionContinuation<Value>(targets: readonly Expression[], context: ResumableDeletionContext<Value>, meter: ExecutionMeter): Generator<Value, void, Value> {
  meter.checkpoint(1, 224);
  return deletionContinuation<Value>(targets, { kind: "resumable", context }, meter);
}

function* deletionContinuation<Value>(targets: readonly Expression[], execution: DeletionExecution<Value>, meter: ExecutionMeter): Generator<Value, void, Value> {
  meter.checkpoint(0, 72);
  const frames: { items: readonly CollectionItem[]; index: number }[] = [{ items: targets, index: 0 }];
  while (frames.length) {
    meter.checkpoint();
    const frame = frames[frames.length - 1];
    if (frame.index === frame.items.length) { frames.pop(); continue; }
    const target = frame.items[frame.index++];
    if (target.kind === "name") {
      if(execution.context.position!==undefined){try{execution.context.position(target.contentSpan??target);}finally{meter.checkpoint(0);}}
      execution.context.removeName(target.name);
    }
    else if (target.kind === "attribute" || target.kind === "subscript") {
      const reference = execution.kind === "synchronous" ? execution.context.resolve(target) : yield* execution.context.resolve(target);
      meter.checkpoint();
      reference.remove();
    } else if (target.kind === "tuple" || target.kind === "list") {
      meter.checkpoint(0, 40);
      frames.push({ items: target.items, index: 0 });
    } else throw new Error("deletion targets must be statically validated");
  }
}
