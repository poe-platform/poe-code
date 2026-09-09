import type { CollectionItem, Expression } from "../ast.js";
import type { ExecutionMeter } from "./execution-budget.js";

export interface DeletionContext {
  removeName(name: string): void;
  /** Evaluate receiver/key now without reading the target's current value.
   * Scope storage, descriptors, subscriptions and internal metering are owned
   * by the adapter; later deletion must use this resolved reference.
   */
  resolve(target: Extract<Expression, { kind: "attribute" | "subscript" }>): { remove(): void };
}

/** Execute statically validated del targets, preserving earlier side effects
 * after a failure. Target lists describe deletions, not iterable unpacking.
 * Explicit frames use O(nesting depth) space and are charged cumulatively before
 * allocation. Guest reference operations have required checkpoints.
 */
export function deleteTargets(targets: readonly Expression[], context: DeletionContext, meter: ExecutionMeter): void {
  meter.checkpoint(1, 72);
  const frames: { items: readonly CollectionItem[]; index: number }[] = [{ items: targets, index: 0 }];
  while (frames.length) {
    meter.checkpoint();
    const frame = frames[frames.length - 1];
    if (frame.index === frame.items.length) { frames.pop(); continue; }
    const target = frame.items[frame.index++];
    if (target.kind === "name") context.removeName(target.name);
    else if (target.kind === "attribute" || target.kind === "subscript") {
      const reference = context.resolve(target);
      meter.checkpoint();
      reference.remove();
    } else if (target.kind === "tuple" || target.kind === "list") {
      meter.checkpoint(0, 40);
      frames.push({ items: target.items, index: 0 });
    } else throw new Error("deletion targets must be statically validated");
  }
}
