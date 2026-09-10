import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValue } from "./runtime-values.js";

/** Internal storage, not a guest attribute dictionary. Initialization copies
 * metadata through ordinary attribute lookup; constructor argument validation
 * and guest dictionary exposure belong to the native descriptor layer. Python
 * 3.14 copies these four fields eagerly, not annotations. Missing fields retain
 * their previous values; failures and reentrant lookups do not roll back writes. */
export class RuntimeMethodDecoratorState {
  #value: RuntimeValue;
  readonly attributes = new Map<string, RuntimeValue>();

  constructor(value: RuntimeValue, meter: ExecutionMeter) {
    meter.checkpoint(1, 64);
    this.#value = value;
    Object.freeze(this);
  }

  get value(): RuntimeValue { return this.#value; }

  initialize(value: RuntimeValue, attribute: (value: RuntimeValue, name: string) => RuntimeValue, meter: ExecutionMeter): void {
    meter.checkpoint();
    this.#value = value;
    for (const name of ["__module__", "__name__", "__qualname__", "__doc__"]) {
      meter.checkpoint();
      let metadata: RuntimeValue;
      try { metadata = attribute(value, name); }
      catch (error) {
        meter.checkpoint();
        if (error instanceof PythonRuntimeError && error.name === "AttributeError") continue;
        throw error;
      }
      meter.checkpoint(1, this.attributes.has(name) ? 0 : 48 + 2 * name.length);
      this.attributes.set(name, metadata);
    }
  }
}
