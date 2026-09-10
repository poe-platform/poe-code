import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { LocalNamespace } from "./module-frame.js";
import { runtimeIndex } from "./runtime-index.js";
import { runtimeMutateItem } from "./runtime-mutation.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { hasRuntimeInstanceAttributes, type BuiltinInvocationContext, type RuntimeValue, type RuntimeValues } from "./runtime-values.js";

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
      const hook = this.invocation.lookupSpecial?.(this.mapping, "__getitem__"); this.meter.checkpoint();
      let value: RuntimeValue;
      if (hook !== undefined) value = this.invocation.call(hook, [key]);
      else {
        if (hasRuntimeInstanceAttributes(this.mapping)) {
          const name = diagnosticTypeName(this.mapping.type.value.name, this.meter, 200);
          throw new PythonRuntimeError("TypeError", `'${name}' object is not subscriptable`);
        }
        value = runtimeIndex(this.mapping, key, this.values, this.meter);
      }
      this.meter.checkpoint(1, 16); return { value };
    } catch (error) {
      this.meter.checkpoint();
      if (error instanceof PythonRuntimeError && error.name === "KeyError") return undefined;
      throw error;
    }
  }

  store(name: string, value: RuntimeValue): void {
    this.#mutate(name, { kind: "set", value });
  }

  delete(name: string): boolean {
    try { this.#mutate(name, { kind: "delete" }); return true; }
    catch (error) {
      this.meter.checkpoint();
      if (error instanceof PythonRuntimeError && error.name === "KeyError") return false;
      throw error;
    }
  }

  #mutate(name: string, change: { readonly kind: "set"; readonly value: RuntimeValue } | { readonly kind: "delete" }): void {
    const key = this.values.string(name), hook = this.invocation.lookupSpecial?.(this.mapping, change.kind === "set" ? "__setitem__" : "__delitem__");
    this.meter.checkpoint();
    if (hook !== undefined) this.invocation.call(hook, change.kind === "set" ? [key, change.value] : [key]);
    else {
      if (hasRuntimeInstanceAttributes(this.mapping)) {
        const name = diagnosticTypeName(this.mapping.type.value.name, this.meter, 200);
        throw new PythonRuntimeError("TypeError", `'${name}' object does not support item ${change.kind === "set" ? "assignment" : "deletion"}`);
      }
      runtimeMutateItem(this.mapping, key, change, this.values, this.meter);
    }
    this.meter.checkpoint();
  }

  isGuest(error: unknown): boolean { return error instanceof PythonRuntimeError; }
}
