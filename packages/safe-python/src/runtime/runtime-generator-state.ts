import type { GeneratorExecution } from "./generator-execution.js";
import type { RuntimeExceptionExecution } from "./runtime-exception-execution.js";
import type { RuntimeValue,InstanceValue } from "./runtime-values.js";
import type { AsyncGeneratorActivity,AsyncGeneratorSend } from "./async-generator-send.js";
import type { AsyncGeneratorThrow } from "./async-generator-throw.js";
import type { CompiledFunction } from "./function-compilation.js";

/** Native storage, never a guest attribute namespace. The lifecycle drops its
 * body/frame references on termination; exception services remain execution-owned. */
export interface RuntimeGeneratorState {
  readonly kind:"generator"|"coroutine";
  readonly execution:GeneratorExecution<RuntimeValue>;
  readonly exceptions:RuntimeExceptionExecution;
  /** Code survives termination; the execution alone retains a live frame. */
  readonly code?:CompiledFunction<RuntimeValue>;
}

export interface RuntimeCoroutineWrapperState {
  readonly kind:"coroutine_wrapper";
  readonly coroutine:InstanceValue;
}

export interface RuntimeAsyncGeneratorState extends Pick<RuntimeGeneratorState,"execution"|"exceptions"|"code"> {
  readonly kind:"async_generator";
  readonly activity:AsyncGeneratorActivity;
}
export interface RuntimeAsyncGeneratorOperationState {
  readonly kind:"async_generator_asend"|"async_generator_athrow";
  readonly generator:InstanceValue;
  readonly operation:AsyncGeneratorSend<RuntimeValue>|AsyncGeneratorThrow<RuntimeValue>;
}
