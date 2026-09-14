import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";

/** Internal provenance from the hash boundary, never from equality dispatch.
 * Container consumers add key context; hash() restores the original exception. */
export class RuntimeHashError extends PythonRuntimeError {
  constructor(private readonly typeName: string | (() => string), readonly original: unknown, meter: ExecutionMeter, private readonly describe?: () => string) {
    meter.checkpoint(0, 64);
    super("TypeError", original instanceof PythonRuntimeError ? original.message : undefined);
  }
  get keyType(): string { return typeof this.typeName === "string" ? this.typeName : this.typeName(); }
  /** Render only when a container adds diagnostic context, never for hash(). */
  detail(): string { return this.describe === undefined ? this.message : this.describe(); }
}
