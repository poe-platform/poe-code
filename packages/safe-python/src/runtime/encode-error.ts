import { PythonRuntimeError } from "./error.js";
import type { CodePointString } from "./code-point-string.js";

/** Internal encode fault retaining immutable input; guest exception mapping is separate. */
export class PythonEncodeError extends PythonRuntimeError {
  constructor(readonly encoding: string, readonly object: CodePointString, readonly start: number, readonly end: number, readonly reason: string) {
    let location = `characters in position ${start}-${end - 1}`;
    if (end === start + 1) {
      const point = object.codePointAt(BigInt(start));
      const prefix = point <= 0xff ? "x" : point <= 0xffff ? "u" : "U";
      const width = point <= 0xff ? 2 : point <= 0xffff ? 4 : 8;
      location = `character '\\${prefix}${point.toString(16).padStart(width, "0")}' in position ${start}`;
    }
    super("UnicodeEncodeError", `'${encoding}' codec can't encode ${location}: ${reason}`);
  }
}
