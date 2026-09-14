import { PythonRuntimeError } from "./error.js";
import { ExecutionLimitError, type ExecutionMeter } from "./execution-budget.js";
import { runtimeIntegerIndex } from "./runtime-integer-index.js";
import { runtimeQualifiedTypeName } from "./runtime-qualified-type-name.js";
import { RuntimeRangeIterator } from "./runtime-range-iterator.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** Each concrete cursor layout owns its descriptors. In particular a small
 * cursor's descriptors cannot be explicitly applied to a long cursor. */
export function installRuntimeRangeIteratorDescriptors(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  owner.value.namespace.items.set(values.string("__doc__"), values.none);
  for (const [name, doc] of [
    ["__iter__", "Implement iter(self)."],
    ["__next__", "Implement next(self)."],
    ["__length_hint__", "Private method returning an estimate of len(list(it))."],
    ["__reduce__", "Return state information for pickling."],
    ["__setstate__", "Set state information for unpickling."]
  ] as const) {
    meter.checkpoint(1, 96);
    const wrapper = name === "__iter__" || name === "__next__";
    const capability = {
      owner, name, doc, textSignature: name === "__setstate__" ? "($self, object, /)" : "($self, /)",
      accepts: receiver => receiver.kind === "iterator" && receiver.value instanceof RuntimeRangeIterator && receiver.value.typeName === owner.value.name,
      invoke(receiver, positional, keywords, meter, invocation) {
        let fatal = false;
        try {
          meter.checkpoint();
          if (receiver.kind !== "iterator" || !(receiver.value instanceof RuntimeRangeIterator)) throw Error("range iterator descriptor requires native cursor storage");
          const cursor = receiver.value, count = name === "__setstate__" ? 1 : 0;
          if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", wrapper ? `wrapper ${name}() takes no keyword arguments` : `${cursor.typeName}.${name}() takes no keyword arguments`);
          if (positional.length !== count) throw new PythonRuntimeError("TypeError", wrapper ? `expected 0 arguments, got ${positional.length}` : `${cursor.typeName}.${name}() takes ${count === 1 ? "exactly one argument" : "no arguments"} (${positional.length} given)`);
          switch (name) {
            case "__iter__": return receiver;
            case "__next__": {
              const result = cursor.next();
              if (result.done) throw new PythonRuntimeError("StopIteration");
              return result.value;
            }
            case "__length_hint__": return cursor.hintValue();
            case "__reduce__": {
              const range = cursor.reductionRange();
              if (invocation?.lookupBuiltin === undefined) throw Error("range iterator reduction requires the calling builtin namespace");
              const iter = invocation.lookupBuiltin("iter");
              meter.checkpoint();
              return values.tuple([iter, values.tuple([range]), values.none]);
            }
            case "__setstate__": {
              const state = positional[0];
              let index: bigint;
              if (cursor.typeName === "longrange_iterator") {
                if (state.kind !== "int") {
                  if (invocation?.actualType === undefined) throw Error("range iterator state validation requires a type policy");
                  throw new PythonRuntimeError("TypeError", `state must be an int, not ${runtimeQualifiedTypeName(invocation.actualType(state), values, meter)}`);
                }
                index = state.value;
              } else {
                index = runtimeIntegerIndex(state, meter, invocation?.integerIndex);
                if (BigInt.asIntN(64, index) !== index) throw new PythonRuntimeError("OverflowError", "Python int too large to convert to C long");
              }
              cursor.advance(index);
              return values.none;
            }
          }
        } catch (error) { fatal = error instanceof ExecutionLimitError; throw error; }
        finally { if (!fatal) meter.checkpoint(); }
      }
    } satisfies Parameters<RuntimeValues["methodDescriptor"]>[0];
    owner.value.namespace.items.set(values.string(name), wrapper ? values.wrapperDescriptor(capability) : values.methodDescriptor(capability));
  }
}
