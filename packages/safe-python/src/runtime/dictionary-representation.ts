import { CodePointString } from "./code-point-string.js";
import { exhaustAllocation, type ExecutionMeter } from "./execution-budget.js";
import { representationObject, type RepresentationContext } from "./representation-protocol.js";
import type { RepresentationStack } from "./representation-stack.js";

const recursive = Uint32Array.of(123, 46, 46, 46, 125), opening = Uint32Array.of(123), closing = Uint32Array.of(125);
const separator = Uint32Array.of(44, 32), assignment = Uint32Array.of(58, 32), noPoints = new Uint32Array(0);

/** The trusted cursor factory must provide metered, live, mutation-tolerant
 * positional storage traversal, not a guest dict iterator or detached snapshot.
 * Pair payloads are captured before either repr call. Cursor acquisition and
 * results run no guest code; ownership/cleanup remains with the storage layer.
 * The runtime supplies cursor adaptation and native representation dispatch.
 */
export function dictionaryRepresentation<Value>(owner: Value, entries: () => Iterator<readonly [Value, Value]>, context: RepresentationContext<Value>, stack: RepresentationStack<Value>, meter: ExecutionMeter): CodePointString {
  meter.checkpoint();
  // Dict checks recursion even if an active owner was emptied by a repr hook.
  const restore = stack.enter(owner);
  if (restore === undefined) return new CodePointString(recursive, meter);
  try {
    meter.checkpoint(1, 64);
    const parts = [new CodePointString(opening, meter)];
    const comma = new CodePointString(separator, meter), colon = new CodePointString(assignment, meter);
    const cursor = entries(); meter.checkpoint();
    let length = 2, first = true;
    while (true) {
      const item = cursor.next(); meter.checkpoint();
      if (item.done) break;
      const key = item.value[0], value = item.value[1];
      const keyResult = representationObject(key, "repr", context, meter);
      const keyText = context.string(keyResult); meter.checkpoint();
      if (keyText === undefined) throw new Error("validated key repr lost string storage");
      const valueResult = representationObject(value, "repr", context, meter);
      const valueText = context.string(valueResult); meter.checkpoint();
      if (valueText === undefined) throw new Error("validated value repr lost string storage");
      length += keyText.length + valueText.length + (first ? 2 : 4);
      if (length > 0xffffffff) exhaustAllocation(meter);
      meter.checkpoint(1, first ? 24 : 32);
      if (!first) parts.push(comma);
      parts.push(keyText, colon, valueText);
      first = false;
    }
    meter.checkpoint(1, 8);
    parts.push(new CodePointString(closing, meter));
    return new CodePointString(noPoints, meter).join(parts, meter);
  } finally {
    restore();
  }
}
