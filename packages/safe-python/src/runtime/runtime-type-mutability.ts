import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { representationObject, type RepresentationContext } from "./representation-protocol.js";
import { createRuntimeRepresentationContext } from "./runtime-representation.js";
import { runtimeStringPayload } from "./runtime-string-payload.js";
import type { RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** type_setattro rejects immutable types before validating or copying the name.
 * The diagnostic invokes repr on the original object, including str subtypes. */
export function requireMutableRuntimeType(type: TypeValue, name: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, representation?: RepresentationContext<RuntimeValue>): void {
  meter.checkpoint();
  if (!type.immutable) return;
  const context = representation ?? createRuntimeRepresentationContext(values, meter, {
    defaultRepr() { throw Error("type mutation requires a representation policy for this name"); }
  });
  const rendered = representationObject(name, "repr", context, meter);
  const payload = runtimeStringPayload(rendered);
  if (payload === undefined) throw Error("validated representation has no string storage");
  let label = "";
  for (const point of payload.value) {
    meter.checkpoint(1, point > 0xffff ? 4 : 2);
    label += String.fromCodePoint(point);
  }
  const typeName = type.value.diagnosticName;
  meter.checkpoint(0, 128 + 2 * (label.length + typeName.length));
  throw new PythonRuntimeError("TypeError", `cannot set ${label} attribute of immutable type '${typeName}'`);
}
