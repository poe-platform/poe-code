import { runtimeExceptionMatches } from "./runtime-exception-matches.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinInvocationContext, RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";
import { RuntimeAttributeStorage } from "./runtime-attribute-storage.js";
import { RuntimeSlotStorage } from "./runtime-slot-storage.js";

/** Wrapper payload and lazily reflected attribute storage. Initialization copies
 * metadata through ordinary attribute lookup; constructor argument validation
 * and dictionary assignment validation belong to the native descriptor layer. Python
 * 3.14 copies these four fields eagerly, not annotations. Missing fields retain
 * their previous values; failures and reentrant lookups do not roll back writes. */
export class RuntimeMethodDecoratorState {
  #value: RuntimeValue;
  #type?: TypeValue;
  readonly attributes: RuntimeAttributeStorage;
  readonly slots: RuntimeSlotStorage;

  constructor(value: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, type?: TypeValue) {
    meter.checkpoint(1, 64);
    this.#value = value;
    this.#type = type;
    this.attributes = new RuntimeAttributeStorage(values, meter);
    this.slots = new RuntimeSlotStorage(type?.value.slotCount ?? 0, meter);
    Object.freeze(this);
  }

  get value(): RuntimeValue { return this.#value; }
  get type(): TypeValue | undefined { return this.#type; }

  /** Payload kind and layout compatibility are checked by the object layer. */
  assignType(type: TypeValue, meter: ExecutionMeter): void {
    meter.checkpoint(); this.#type = type;
  }

  initialize(value: RuntimeValue, attribute: (value: RuntimeValue, name: string) => RuntimeValue, meter: ExecutionMeter, invocation?:Pick<BuiltinInvocationContext,"isException">): void {
    meter.checkpoint();
    this.#value = value;
    for (const name of ["__module__", "__name__", "__qualname__", "__doc__"]) {
      meter.checkpoint();
      let metadata: RuntimeValue;
      try { metadata = attribute(value, name); }
      catch (error) {
        meter.checkpoint();
        if (runtimeExceptionMatches(error,"AttributeError",invocation)) continue;
        throw error;
      }
      meter.checkpoint();
      this.attributes.set(name, metadata);
    }
  }
}
