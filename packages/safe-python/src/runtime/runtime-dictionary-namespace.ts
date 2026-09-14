import { PythonRuntimeError } from "./error.js";
import { runtimeExceptionMatches } from "./runtime-exception-matches.js";
import { runtimeDictionaryPayload } from "./runtime-dictionary-payload.js";
import { runtimeGetItem } from "./runtime-subscription.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { LocalNamespace } from "./module-frame.js";
import type { BuiltinInvocationContext, DictionaryValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Dictionary globals use intrinsic writes/deletes but subclass item lookup.
 * Exact dictionaries also support ordinary locals and builtin namespaces.
 * Subclass locals require RuntimeMappingNamespace so their writes/deletes use
 * item slots too. Compiler names use the interpreter's intern pool, matching
 * code-name identity across loads/stores. Existing equal dictionary keys retain
 * their own identity; names are never normalized by this adapter.
 */
export class RuntimeDictionaryNamespace implements LocalNamespace<RuntimeValue> {
  private readonly storage: DictionaryValue;
  constructor(
    readonly object: RuntimeValue,
    private readonly values: RuntimeValues,
    private readonly meter: ExecutionMeter,
    private readonly invocation?:BuiltinInvocationContext|Pick<BuiltinInvocationContext,"isException">
  ) {
    meter.checkpoint(1, 64);
    const storage = runtimeDictionaryPayload(object);
    if (storage === undefined) throw new TypeError("dictionary namespace requires dictionary storage");
    this.storage = storage;
    Object.freeze(this);
  }

  lookup(name: string, access?: "intrinsic"): { readonly value: RuntimeValue } | undefined {
    const key = this.values.internString(name);
    if (this.object.kind !== "dict" && access !== "intrinsic") {
      const invocation = this.invocation;
      if (invocation === undefined || !("call" in invocation)) throw new Error("dictionary-subclass lookup requires invocation context");
      try {
        const value = runtimeGetItem(this.object, key, this.values, this.meter, invocation);
        this.meter.checkpoint(1, 16); return { value };
      } catch (error) {
        this.meter.checkpoint();
        if (runtimeExceptionMatches(error, "KeyError", this.invocation)) return undefined;
        throw error;
      }
    }
    const result = this.storage.items.lookup(key);
    this.meter.checkpoint();
    return result;
  }

  store(name: string, value: RuntimeValue): void {
    const key = this.values.internString(name);
    this.storage.items.set(key, value);
    this.meter.checkpoint();
  }

  delete(name: string): boolean {
    const key = this.values.internString(name);
    const result = this.storage.items.delete(key);
    this.meter.checkpoint();
    return result;
  }

  isGuest(error: unknown): boolean {
    return error instanceof PythonRuntimeError || runtimeExceptionMatches(error,"BaseException",this.invocation);
  }
}
