import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { LocalNamespace } from "./module-frame.js";
import { runtimeGetItem, runtimeMutateSubscription } from "./runtime-subscription.js";
import type { BuiltinInvocationContext, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Prepared custom mappings use live type-level item slots, not instance
 * attributes. Only KeyError becomes a missing name; frame deletion separately
 * implements DELETE_NAME's replacement of guest failures with NameError. */
export class RuntimeMappingNamespace implements LocalNamespace<RuntimeValue> {
  constructor(private readonly mapping: RuntimeValue, private readonly values: RuntimeValues,
    private readonly meter: ExecutionMeter, private readonly invocation: BuiltinInvocationContext) {
    meter.checkpoint(1, 64); Object.freeze(this);
  }

  lookup(name: string): { readonly value: RuntimeValue } | undefined {
    const key = this.values.string(name);
    try {
      const value = runtimeGetItem(this.mapping, key, this.values, this.meter, this.invocation);
      this.meter.checkpoint(1, 16); return { value };
    } catch (error) {
      this.meter.checkpoint();
      if (error instanceof PythonRuntimeError && error.name === "KeyError") return undefined;
      throw error;
    }
  }

  store(name: string, value: RuntimeValue): void {
    const key = this.values.string(name);
    runtimeMutateSubscription(this.mapping, key, { kind: "set", value }, this.values, this.meter, this.invocation);
  }

  delete(name: string): boolean {
    const key = this.values.string(name);
    try { runtimeMutateSubscription(this.mapping, key, { kind: "delete" }, this.values, this.meter, this.invocation); return true; }
    catch (error) {
      this.meter.checkpoint();
      if (error instanceof PythonRuntimeError && error.name === "KeyError") return false;
      throw error;
    }
  }

  isGuest(error: unknown): boolean { return error instanceof PythonRuntimeError; }
}
