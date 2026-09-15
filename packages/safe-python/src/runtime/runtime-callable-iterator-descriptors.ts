import { CallableIterator } from "./callable-iterator.js";
import { PythonRuntimeError } from "./error.js";
import { ExecutionLimitError, type ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** The sentinel cursor owns its native slots; binding never invokes the
 * callable or sentinel. Reduction resolves iter in the active guest frame. */
export function installRuntimeCallableIteratorDescriptors(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  owner.value.namespace.items.set(values.string("__doc__"), values.none);
  for (const [name, doc] of [
    ["__iter__", "Implement iter(self)."],
    ["__next__", "Implement next(self)."],
    ["__reduce__", "Return state information for pickling."]
  ] as const) {
    meter.checkpoint(1, 96);
    const wrapper = name !== "__reduce__";
    const capability = {
      owner, name, doc, textSignature: "($self, /)",
      accepts: receiver => receiver.kind === "iterator" && receiver.value instanceof CallableIterator,
      invoke(receiver, positional, keywords, meter, invocation) {
        let fatal = false;
        try {
          meter.checkpoint();
          if (receiver.kind !== "iterator" || !(receiver.value instanceof CallableIterator)) throw Error("callable iterator descriptor requires native cursor storage");
          if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", wrapper ? `wrapper ${name}() takes no keyword arguments` : "callable_iterator.__reduce__() takes no keyword arguments");
          if (positional.length !== 0) throw new PythonRuntimeError("TypeError", wrapper ? `expected 0 arguments, got ${positional.length}` : `callable_iterator.__reduce__() takes no arguments (${positional.length} given)`);
          if (name === "__iter__") return receiver;
          if (name === "__next__") {
            const step = receiver.value.next();
            if (!step.done) return step.value;
            if (step.exception !== undefined) throw step.exception.value;
            throw new PythonRuntimeError("StopIteration");
          }
          if (invocation?.lookupBuiltin === undefined) throw Error("callable iterator reduction requires the calling builtin namespace");
          const iter = invocation.lookupBuiltin("iter");
          meter.checkpoint();
          const state = receiver.value.reductionState();
          return values.tuple([iter, state === undefined ? values.tuple([values.tuple([])]) : values.tuple([state.callable, state.sentinel])]);
        } catch (error) { fatal = error instanceof ExecutionLimitError; throw error; }
        finally { if (!fatal) meter.checkpoint(); }
      }
    } satisfies Parameters<RuntimeValues["methodDescriptor"]>[0];
    owner.value.namespace.items.set(values.string(name), wrapper ? values.wrapperDescriptor(capability) : values.methodDescriptor(capability));
  }
}
