import { PythonRuntimeError, type PythonExceptionChaining } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";

export interface DecodeErrorLocation {readonly start:number;readonly end:number;readonly reason:string}

/** Internal codec fault metadata; conversion to a guest exception is separate. */
export class PythonDecodeError<Position extends number|bigint=number> extends PythonRuntimeError {
  readonly object: Uint8Array;

  constructor(readonly encoding: string, input: Uint8Array, readonly start: Position, readonly end: Position, readonly reason: string, meter?: ExecutionMeter, readonly initial?:DecodeErrorLocation, chaining?:PythonExceptionChaining) {
    // The internal exception record is separate from its owned byte snapshot,
    // including the typed-array header for empty input. Admit both before
    // constructing the fault or allowing a recovery callback to observe it.
    meter?.checkpoint(input.length, 256 + input.byteLength);
    const location = start>=0&&start<input.length&&BigInt(end)===BigInt(start)+1n
      ? `byte 0x${input[Number(start)]!.toString(16).padStart(2, "0")} in position ${start}`
      : `bytes in position ${start}-${BigInt(end) - 1n}`;
    super("UnicodeDecodeError", `'${encoding}' codec can't decode ${location}: ${reason}`, chaining);
    this.object = new Uint8Array(input);
  }
}
