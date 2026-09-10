import type { CodePointString } from "./code-point-string.js";
import { exhaustAllocation, type ExecutionMeter } from "./execution-budget.js";
import { representationObject, type RepresentationContext } from "./representation-protocol.js";
import type { RepresentationStack } from "./representation-stack.js";
import type { FrozenSetValue, RuntimeValue, RuntimeValues, SetValue } from "./runtime-values.js";

/** Snapshot keys before any guest repr callback. Set storage order is not a
 * Python guarantee; shared active-path guards retain the original set identity. */
export function runtimeSetRepresentation(owner: SetValue | FrozenSetValue, values: RuntimeValues, context: RepresentationContext<RuntimeValue>, stack: RepresentationStack<RuntimeValue>, meter: ExecutionMeter): CodePointString {
  meter.checkpoint();
  if (owner.items.size === 0) return values.string(`${owner.kind}()`).value;
  const restore = stack.enter(owner);
  if (restore === undefined) return values.string(`${owner.kind}(...)`).value;
  try {
    meter.checkpoint(0, 64);
    const snapshot: RuntimeValue[] = [], iterator = owner.items.iterate(key => key, "set");
    for (let next = iterator.next(); !next.done; next = iterator.next()) {
      meter.checkpoint(1, 8); snapshot.push(next.value);
    }
    const opening = values.string(owner.kind === "set" ? "{" : "frozenset({").value, closing = values.string(owner.kind === "set" ? "}" : "})").value;
    const comma = values.string(", ").value, parts = [opening];
    let length = opening.length + closing.length;
    for (let index = 0; index < snapshot.length; index++) {
      meter.checkpoint();
      const result = representationObject(snapshot[index], "repr", context, meter), text = context.string(result);
      if (text === undefined) throw Error("validated set element repr lost string storage");
      length += text.length + (index === 0 ? 0 : 2);
      if (length > 0xffffffff) exhaustAllocation(meter);
      meter.checkpoint(1, index === 0 ? 8 : 16);
      if (index !== 0) parts.push(comma);
      parts.push(text);
    }
    meter.checkpoint(0, 8); parts.push(closing);
    return values.string("").value.join(parts, meter);
  } finally { restore(); }
}
