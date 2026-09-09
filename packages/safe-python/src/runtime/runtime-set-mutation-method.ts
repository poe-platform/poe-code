import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { PythonKeyError } from "./runtime-dictionary-access.js";
import { runtimeSetAccess, updateRuntimeSet } from "./runtime-set.js";
import { intersectRuntimeSets } from "./runtime-set-algebra-method.js";
import type { BuiltinFunctionValue, RuntimeValues, SetValue } from "./runtime-values.js";

/** Bind exact mutable-set methods explicitly. Descriptor installation, receiver
 * discovery and native bound-method introspection belong to the object layer.
 * Pop chooses an arbitrary stored member, not a promised iteration order. */
export function createRuntimeSetMutationMethod(receiver: SetValue, name: "add" | "remove" | "discard" | "pop" | "clear" | "update" | "intersection_update", values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `set.${name}() takes no keyword arguments`);
      if (name === "intersection_update") {
        const result = intersectRuntimeSets(receiver, positional, values, meter);
        // These unchanged cases keep live cursors without restarting them.
        if (positional.length !== 0 && !(positional.length === 1 && positional[0] === receiver)) receiver.items.takeContents(result);
        return values.none;
      }
      if (name === "update") {
        for (const source of positional) updateRuntimeSet(receiver, source, values, meter);
        meter.checkpoint();
        return values.none;
      }
      if (name === "add" || name === "remove" || name === "discard") {
        if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `set.${name}() takes exactly one argument (${positional.length} given)`);
        const key = positional[0];
        if (name === "add") runtimeSetAccess(receiver, key, "add", values, meter);
        else {
          const removed = runtimeSetAccess(receiver, key, "discard", values, meter);
          if (!removed && name === "remove") throw new PythonKeyError(key, meter);
        }
        return values.none;
      }
      if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `set.${name}() takes no arguments (${positional.length} given)`);
      if (name === "clear") { receiver.items.clear(); return values.none; }
      meter.checkpoint(1, 32);
      const result = receiver.items.popitem(key => key);
      if (result === undefined) throw new PythonKeyError(values.string("pop from an empty set"), meter);
      return result;
    }
  });
}
