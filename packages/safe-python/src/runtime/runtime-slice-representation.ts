import { CodePointString } from "./code-point-string.js";
import type { SliceConstant } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { representationObject, type RepresentationContext } from "./representation-protocol.js";
import type { RuntimeValue } from "./runtime-values.js";

/** Slice components use repr, never index conversion or str. Expand nested
 * exact slices iteratively; mutable component containers own cycle markers. */
export function runtimeSliceRepresentation(slice: SliceConstant<RuntimeValue>, context: RepresentationContext<RuntimeValue>, meter: ExecutionMeter): CodePointString {
  meter.checkpoint(1, 128);
  const opening = new CodePointString(Uint32Array.of(115, 108, 105, 99, 101, 40), meter), separator = new CodePointString(Uint32Array.of(44, 32), meter), closing = new CodePointString(Uint32Array.of(41), meter);
  const work: (RuntimeValue | CodePointString)[] = [slice], parts: CodePointString[] = [];
  while (work.length !== 0) {
    meter.checkpoint();
    const value = work.pop()!;
    if (value instanceof CodePointString) {
      meter.checkpoint(0, 8); parts.push(value);
    } else if (value.kind === "slice") {
      meter.checkpoint(0, 56);
      work.push(closing, value.step, separator, value.stop, separator, value.start, opening);
    } else {
      const result = representationObject(value, "repr", context, meter), storage = context.string(result);
      meter.checkpoint();
      if (storage === undefined) throw Error("validated slice component repr lost string storage");
      meter.checkpoint(0, 8); parts.push(storage);
    }
  }
  return new CodePointString(new Uint32Array(0), meter).join(parts, meter);
}
