import { PythonRuntimeError } from "./error.js";
import { exhaustAllocation, type ExecutionMeter } from "./execution-budget.js";
import type { FormatSpec } from "./format-spec.js";
import { renderFloatFormatBuffer } from "./float-format-field.js";
import type { NumericLocale } from "./numeric-locale.js";

/** Compose independently formatted complex components, then pad the whole.
 * Omitted-type zero-real omission is decided before rounding or z coercion.
 * Component buffers are temporary; the final output is owned by the caller. */
export function renderComplexFormatBuffer(real: number, imaginary: number, field: FormatSpec, meter: ExecutionMeter, locale?: NumericLocale): Uint32Array {
  meter.checkpoint(1, 512);
  if (field.type !== 0 && field.type !== 101 && field.type !== 69 && field.type !== 102 && field.type !== 70 && field.type !== 103 && field.type !== 71 && field.type !== 110) throw new RangeError("unsupported complex presentation");
  if (field.precision !== null && field.precision > 2147483647n) throw new PythonRuntimeError("ValueError", "precision too big");
  if (field.fill === 48) throw new PythonRuntimeError("ValueError", "Zero padding is not allowed in complex format specifier");
  if (field.align === "=") throw new PythonRuntimeError("ValueError", "'=' alignment flag is not allowed in complex format specifier");
  const skipReal = field.type === 0 && real === 0 && !Object.is(real, -0);
  const parentheses = field.type === 0 && !skipReal;
  const component: FormatSpec = { ...field, fill: 0, align: "<", width: null };
  const realPoints = renderFloatFormatBuffer(real, component, meter, false, locale);
  const imaginaryPoints = renderFloatFormatBuffer(imaginary, { ...component, sign: skipReal ? field.sign : "+" }, meter, false, locale);
  const core = (skipReal ? 0 : realPoints.length) + imaginaryPoints.length + 1 + (parentheses ? 2 : 0);
  const width = field.width ?? 0n;
  if (width > 0xffffffffn) exhaustAllocation(meter);
  const length = Math.max(core, Number(width));
  if (length > 0xffffffff) exhaustAllocation(meter);
  meter.checkpoint(0, length * Uint32Array.BYTES_PER_ELEMENT);
  const output = new Uint32Array(length), padding = length - core;
  const left = field.align === ">" ? padding : field.align === "^" ? Math.floor(padding / 2) : 0;
  let offset = 0;
  while (offset < left) { meter.checkpoint(); output[offset++] = field.fill; }
  if (parentheses) { meter.checkpoint(); output[offset++] = 40; }
  if (!skipReal) for (const point of realPoints) { meter.checkpoint(); output[offset++] = point; }
  for (const point of imaginaryPoints) { meter.checkpoint(); output[offset++] = point; }
  meter.checkpoint(); output[offset++] = 106;
  if (parentheses) { meter.checkpoint(); output[offset++] = 41; }
  while (offset < length) { meter.checkpoint(); output[offset++] = field.fill; }
  return output;
}
