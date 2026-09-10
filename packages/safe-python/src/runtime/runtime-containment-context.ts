import type { ContainmentContext } from "./containment-protocol.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { usesRuntimeGuestNumericSlots } from "./runtime-numeric-slots.js";
import { runtimeTruth } from "./runtime-truth.js";
import type { BuiltinInvocationContext, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Select a cached frame-owned guest containment protocol. Exact native
 * containers/cursors keep their kernels. Bound iteration methods preserve an
 * explicit policy's receiver; advisory hints are deliberately not exposed. */
export function createRuntimeContainmentPolicy(values: RuntimeValues, meter: ExecutionMeter, invocation: BuiltinInvocationContext): (container: RuntimeValue) => ContainmentContext<RuntimeValue> | undefined {
  meter.checkpoint(0, 64);
  let context: ContainmentContext<RuntimeValue> | undefined;
  return container => {
    meter.checkpoint();
    if (container.kind === "iterator" || !usesRuntimeGuestNumericSlots(container)) return undefined;
    if (context !== undefined) return context;
    const iteration = invocation.iteration; meter.checkpoint();
    if (iteration === undefined) throw Error("containment requires an iteration policy");
    meter.checkpoint(0, 832);
    context = {
      lookupContains(value) {
        const method = invocation.lookupSpecial?.(value, "__contains__"); meter.checkpoint();
        if (method === undefined) return undefined;
        if (method === values.none) return null;
        meter.checkpoint(0, 64);
        return needle => {
          meter.checkpoint(0, 16);
          const result = invocation.call(method, [needle]); meter.checkpoint(); return result;
        };
      },
      lookupIter: iteration.lookupIter.bind(iteration), hasNext: iteration.hasNext.bind(iteration),
      nativeIterator: iteration.nativeIterator?.bind(iteration),
      next: iteration.next.bind(iteration), hasSequenceItem: iteration.hasSequenceItem.bind(iteration),
      getItem: iteration.getItem.bind(iteration), isStopIteration: iteration.isStopIteration.bind(iteration),
      isIndexError: iteration.isIndexError.bind(iteration), typeName: iteration.typeName.bind(iteration),
      equal(member, needle) {
        if (invocation.compare === undefined) throw Error("containment requires a comparison policy");
        const result = invocation.compare("==", member, needle); meter.checkpoint(); return result;
      },
      truth: invocation.truth?.bind(invocation) ?? (value => runtimeTruth(value, meter)),
      isTypeError: error => error instanceof PythonRuntimeError && error.name === "TypeError"
    };
    return context;
  };
}
