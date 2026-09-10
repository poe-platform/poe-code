import type { GeneratorExecution } from "./generator-execution.js";
import type { RuntimeExceptionExecution } from "./runtime-exception-execution.js";
import type { RuntimeValue } from "./runtime-values.js";

/** Native storage, never a guest attribute namespace. The lifecycle drops its
 * body/frame references on termination; exception services remain execution-owned. */
export interface RuntimeGeneratorState {
  readonly kind:"generator";
  readonly execution:GeneratorExecution<RuntimeValue>;
  readonly exceptions:RuntimeExceptionExecution;
}
