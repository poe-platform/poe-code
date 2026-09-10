import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";
import { RuntimeAttributeStorage } from "./runtime-attribute-storage.js";

/** Wrapper payload and lazily reflected attribute storage. Initialization copies
 * metadata through ordinary attribute lookup; constructor argument validation
 * and dictionary assignment validation belong to the native descriptor layer. Python
 * 3.14 copies these four fields eagerly, not annotations. Missing fields retain
 * their previous values; failures and reentrant lookups do not roll back writes. */
export class RuntimeMethodDecoratorState {
  #value: RuntimeValue;
  readonly attributes: RuntimeAttributeStorage;

  constructor(value: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter) {
    meter.checkpoint(1, 64);
    this.#value = value;
    this.attributes = new RuntimeAttributeStorage(values, meter);
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
      meter.checkpoint();
      this.attributes.set(name, metadata);
    }
  }
}
