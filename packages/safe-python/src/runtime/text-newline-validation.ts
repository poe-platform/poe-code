import {CodePointString} from "./code-point-string.js";
import {PythonRuntimeError} from "./error.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {encodeUtf8} from "./utf8-encode.js";

/** Validate the host-text configuration accepted by the UTF-8 I/O adapters.
 * Guest TextIOWrapper must first convert its str through the interpreter's
 * Unicode C-string cache; this helper does not own guest objects or that cache.
 */
export function validateTextNewline(newline: string | null, meter?: ExecutionMeter): void {
  meter?.checkpoint();
  if (newline === null || newline === "" || newline === "\n" || newline === "\r" || newline === "\r\n") return;
  // Native argument conversion encodes the whole name before checking NUL.
  // Use the pinned kernel so lone surrogates retain their exact error range.
  meter?.checkpoint(0, 192 + newline.length * Uint32Array.BYTES_PER_ELEMENT);
  const points = Uint32Array.from(newline, character => {
    meter?.checkpoint();
    return character.codePointAt(0)!;
  });
  encodeUtf8(new CodePointString(points, meter), "strict", meter);
  meter?.checkpoint(0, 192 + newline.length * 2);
  if (newline.includes("\0")) throw new PythonRuntimeError("ValueError", "embedded null character");
  throw new PythonRuntimeError("ValueError", `illegal newline value: ${newline}`);
}
