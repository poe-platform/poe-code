import { CodePointString } from "./code-point-string.js";
import { exhaustAllocation, type ExecutionMeter } from "./execution-budget.js";
import { representationObject, type RepresentationContext } from "./representation-protocol.js";
import type { RepresentationStack } from "./representation-stack.js";

const empty = Uint32Array.of(40, 41), recursive = Uint32Array.of(40, 46, 46, 46, 41);
const opening = Uint32Array.of(40), closing = Uint32Array.of(41), singletonClosing = Uint32Array.of(44, 41);
const separator = Uint32Array.of(44, 32), noPoints = new Uint32Array(0);

/** Immutable tuple slots can still participate in cycles through mutable
 * elements. The caller shares this guard with every nested container slot.
 * Input is trusted immutable tuple storage, not a guest iterable or snapshot.
 */
export function tupleRepresentation<Value>(owner: Value, items: readonly Value[], context: RepresentationContext<Value>, stack: RepresentationStack<Value>, meter: ExecutionMeter): CodePointString {
  meter.checkpoint();
  const count = items.length;
  if (count === 0) return new CodePointString(empty, meter);
  const restore = stack.enter(owner);
  if (restore === undefined) return new CodePointString(recursive, meter);
  try {
    meter.checkpoint(1, 64);
    const parts = [new CodePointString(opening, meter)];
    const comma = new CodePointString(separator, meter);
    let length = count === 1 ? 3 : 2;
    for (let index = 0; index < count; index++) {
      meter.checkpoint();
      const result = representationObject(items[index]!, "repr", context, meter);
      const text = context.string(result); meter.checkpoint();
      if (text === undefined) throw new Error("validated repr lost string storage");
      length += text.length + (index > 0 ? 2 : 0);
      if (length > 0xffffffff) exhaustAllocation(meter);
      meter.checkpoint(1, index > 0 ? 16 : 8);
      if (index > 0) parts.push(comma);
      parts.push(text);
    }
    meter.checkpoint(1, 8);
    parts.push(new CodePointString(count === 1 ? singletonClosing : closing, meter));
    return new CodePointString(noPoints, meter).join(parts, meter);
  } finally {
    restore();
  }
}
