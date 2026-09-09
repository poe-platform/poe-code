import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";

/** Internal provenance from the hash boundary, never from equality dispatch.
 * Container consumers add key context; hash() restores the original exception. */
export class RuntimeHashError extends PythonRuntimeError {
  constructor(readonly keyType: string, readonly original: PythonRuntimeError, meter: ExecutionMeter) {
    meter.checkpoint(0, 64);
    super("TypeError", original.message);
  }
}
