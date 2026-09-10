import { PythonRuntimeError } from "./error.js";
import { runtimeExceptionMatches } from "./runtime-exception-matches.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { LocalNamespace } from "./module-frame.js";
import type { BuiltinInvocationContext, DictionaryValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Adapt source-name access to an exact Python dictionary without copying its
 * entries or normalizing names. Source analysis owns identifier normalization
 * and frames own private-name mangling. The same storage can back class locals,
 * builtin lookup and later class attributes. Arbitrary prepared mapping objects
 * require their own protocol adapter; this class does not emulate them.
 */
export class RuntimeDictionaryNamespace implements LocalNamespace<RuntimeValue> {
  constructor(
    private readonly dictionary: DictionaryValue,
    private readonly values: RuntimeValues,
    private readonly meter: ExecutionMeter,
    private readonly invocation?:Pick<BuiltinInvocationContext,"isException">
  ) {
    meter.checkpoint(1, 56);
    Object.freeze(this);
  }

  lookup(name: string): { readonly value: RuntimeValue } | undefined {
    const key = this.values.string(name);
    const result = this.dictionary.items.lookup(key);
    this.meter.checkpoint();
    return result;
  }

  store(name: string, value: RuntimeValue): void {
    const key = this.values.string(name);
    this.dictionary.items.set(key, value);
    this.meter.checkpoint();
  }

  delete(name: string): boolean {
    const key = this.values.string(name);
    const result = this.dictionary.items.delete(key);
    this.meter.checkpoint();
    return result;
  }

  isGuest(error: unknown): boolean {
    return error instanceof PythonRuntimeError || runtimeExceptionMatches(error,"BaseException",this.invocation);
  }
}
