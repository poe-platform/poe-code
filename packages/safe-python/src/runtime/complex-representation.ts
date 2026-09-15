import type { ExecutionMeter } from "./execution-budget.js";
import { floatRepresentation } from "./float-representation.js";

/** Complex repr/str uses shortest float components without integral .0 suffixes.
 * A positive-zero real component is omitted; negative zero remains explicit.
 * NaN sign bits are ignored by floatRepresentation, including the imaginary sign.
 */
export function complexRepresentation(real: number, imaginary: number, meter: ExecutionMeter): string {
  meter.checkpoint(1, 512);
  const imaginaryFloat = floatRepresentation(imaginary, meter);
  const imaginaryText = imaginaryFloat.endsWith(".0") ? imaginaryFloat.slice(0, -2) : imaginaryFloat;
  if (real === 0 && !Object.is(real, -0)) return imaginaryText + "j";
  const realFloat = floatRepresentation(real, meter);
  const realText = realFloat.endsWith(".0") ? realFloat.slice(0, -2) : realFloat;
  meter.checkpoint();
  return "(" + realText + (imaginaryText[0] === "-" ? "" : "+") + imaginaryText + "j)";
}
