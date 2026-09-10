import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { DictionaryValue, MethodDecoratorValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Shared native constructor/__init__ policy. Raw type-allocation wrappers must
 * not use this operation: CPython leaves their metadata dictionaries empty. */
export function initializeRuntimeMethodDecorator(receiver: MethodDecoratorValue, positional: readonly RuntimeValue[], keywords: DictionaryValue, values: RuntimeValues, meter: ExecutionMeter, attribute: (value: RuntimeValue, name: string) => RuntimeValue): RuntimeValue {
  meter.checkpoint();
  if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `${receiver.kind}() takes no keyword arguments`);
  if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `${receiver.kind} expected 1 argument, got ${positional.length}`);
  receiver.state.initialize(positional[0]!, attribute, meter);
  return values.none;
}
