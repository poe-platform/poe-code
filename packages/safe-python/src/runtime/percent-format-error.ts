import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";

/** Called by field dispatch only after binding has consumed the operand.
 * Text diagnostics retain U+001F through U+007E. Bytes diagnostics retain raw
 * ASCII controls; CPython's signed-char path overflows for high byte codes. */
export function unsupportedPercentConversion(code: number, offset: number, byteFormat: boolean, meter: ExecutionMeter): never {
  meter.checkpoint(1, 256);
  if (!Number.isInteger(code) || code < 0 || code > (byteFormat ? 255 : 0x10ffff) || !Number.isSafeInteger(offset) || offset < 0) throw new RangeError("invalid percent conversion metadata");
  if (byteFormat && code >= 128) throw new PythonRuntimeError("OverflowError", "character argument not in range(0x110000)");
  const character = byteFormat || code >= 31 && code < 127 ? String.fromCharCode(code) : "?";
  throw new PythonRuntimeError("ValueError", `unsupported format character '${character}' (0x${code.toString(16)}) at index ${offset}`);
}
