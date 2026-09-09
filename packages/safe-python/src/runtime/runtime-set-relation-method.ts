import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { UnhashableRuntimeValueError } from "./runtime-hash.js";
import { RuntimeHashError } from "./runtime-hash-error.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { isRuntimeSet, type BuiltinFunctionValue, type FrozenSetValue, type RuntimeValues, type SetValue } from "./runtime-values.js";

/** Explicit native set/frozen-set read-method binding. Generic relationship
 * sources stream and retain their cursor on short circuit; they do not apply
 * the mutable-set probe conversion used by the contains/remove methods. */
export function createRuntimeSetRelationMethod(receiver: SetValue | FrozenSetValue, name: "copy" | "isdisjoint" | "issubset" | "issuperset", values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `${receiver.kind}.${name}() takes no keyword arguments`);
      if (name === "copy") {
        if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `${receiver.kind}.copy() takes no arguments (${positional.length} given)`);
        return receiver.kind === "frozenset" ? receiver : values.set(receiver.items.copy());
      }
      if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `${receiver.kind}.${name}() takes exactly one argument (${positional.length} given)`);
      const other = positional[0];
      if (isRuntimeSet(other)) {
        return values.boolean(name === "isdisjoint" ? receiver.items.isKeyDisjointFrom(other.items) : name === "issubset" ? receiver.items.isKeySubsetOf(other.items) : other.items.isKeySubsetOf(receiver.items));
      }
      if (name === "issubset") {
        meter.checkpoint(1, 32);
        const common = receiver.items.intersectKeysFrom(() => runtimeIterate(other, values, meter), values.none);
        return values.boolean(common.size === receiver.items.size);
      }
      const iterator = runtimeIterate(other, values, meter);
      while (true) {
        meter.checkpoint();
        const item = iterator.next();
        meter.checkpoint();
        if (item.done) return values.true;
        let found: boolean;
        try { found = receiver.items.containsKey(item.value); }
        catch (error) {
          if (!(error instanceof UnhashableRuntimeValueError) && !(error instanceof RuntimeHashError)) throw error;
          const type = error instanceof RuntimeHashError ? error.keyType : item.value.kind;
          throw new PythonRuntimeError("TypeError", `cannot use '${type}' as a set element (${error.message})`);
        }
        if (name === "isdisjoint" ? found : !found) return values.false;
      }
    }
  });
}
