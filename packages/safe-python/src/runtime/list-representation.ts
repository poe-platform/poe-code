import { CodePointString } from "./code-point-string.js";
import { exhaustAllocation, type ExecutionMeter } from "./execution-budget.js";
import type { ListStorage } from "./list-storage.js";
import { representationObject, type RepresentationContext } from "./representation-protocol.js";
import type { RepresentationStack } from "./representation-stack.js";

const empty = Uint32Array.of(91, 93), recursive = Uint32Array.of(91, 46, 46, 46, 93);
const opening = Uint32Array.of(91), closing = Uint32Array.of(93), separator = Uint32Array.of(44, 32);
const noPoints = new Uint32Array(0);

/** Native list storage is read live: element repr can append, remove or replace
 * later slots. The caller shares its active-path stack with nested repr slots.
 * This kernel does not install runtime slots or choose an execution depth policy.
 */
export function listRepresentation<Value>(owner: Value, items: ListStorage<Value>, context: RepresentationContext<Value>, stack: RepresentationStack<Value>, meter: ExecutionMeter): CodePointString {
  meter.checkpoint();
  // An active list can have been cleared by an element's repr before reentry.
  if (items.length === 0) return new CodePointString(empty, meter);
  const restore = stack.enter(owner);
  if (restore === undefined) return new CodePointString(recursive, meter);
  try {
    meter.checkpoint(1, 64);
    const parts = [new CodePointString(opening, meter)];
    const comma = new CodePointString(separator, meter);
    let length = 2;
    for (let index = 0; index < items.length; index++) {
      meter.checkpoint(1, 8);
      const result = representationObject(items.get(BigInt(index)), "repr", context, meter);
      const text = context.string(result); meter.checkpoint();
      if (text === undefined) throw new Error("validated repr lost string storage");
      length += text.length + (index > 0 ? 2 : 0);
      if (length > 0xffffffff) exhaustAllocation(meter);
      meter.checkpoint(1, index > 0 ? 16 : 8);
      if (index > 0) parts.push(comma);
      parts.push(text);
    }
    meter.checkpoint(1, 8);
    parts.push(new CodePointString(closing, meter));
    return new CodePointString(noPoints, meter).join(parts, meter);
  } finally {
    restore();
  }
}
