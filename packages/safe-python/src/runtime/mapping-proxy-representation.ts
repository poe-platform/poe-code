import { CodePointString } from "./code-point-string.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { representationObject, type RepresentationContext } from "./representation-protocol.js";

const prefix = Uint32Array.from("mappingproxy(", point => point.charCodeAt(0));
const suffix = Uint32Array.of(41), empty = new Uint32Array(0);

/** Repr wraps the underlying mapping's repr, not its str. The mapping owns
 * recursion detection; a proxy does not replace that marker with its own guard.
 * Fixed ASCII framing never round-trips guest storage through UTF-16.
 */
export function mappingProxyRepresentation<Value>(mapping: Value, context: RepresentationContext<Value>, meter: ExecutionMeter, depth = 1): CodePointString {
  meter.checkpoint(1, 64);
  const result = representationObject(mapping, "repr", context, meter);
  const storage = context.string(result); meter.checkpoint();
  if (storage === undefined) throw new Error("validated mapping repr lost string storage");
  return new CodePointString(empty, meter).join([
    new CodePointString(prefix, meter).repeat(depth, meter), storage, new CodePointString(suffix, meter).repeat(depth, meter)
  ], meter);
}
