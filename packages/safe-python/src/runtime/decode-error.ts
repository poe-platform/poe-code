import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";

/** Internal codec fault metadata; conversion to a guest exception is separate. */
export class PythonDecodeError extends PythonRuntimeError {
  readonly object: Uint8Array;

  constructor(readonly encoding: string, input: Uint8Array, readonly start: number, readonly end: number, readonly reason: string, meter?: ExecutionMeter) {
    const location = end === start + 1
      ? `byte 0x${input[start]!.toString(16).padStart(2, "0")} in position ${start}`
      : `bytes in position ${start}-${end - 1}`;
    super("UnicodeDecodeError", `'${encoding}' codec can't decode ${location}: ${reason}`);
    meter?.checkpoint(input.length, input.byteLength);
    this.object = new Uint8Array(input);
  }
}
