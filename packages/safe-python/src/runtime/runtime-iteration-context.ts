import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { IterationContext } from "./protocol-iterator.js";
import type { LengthHintContext } from "./length-hint.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { usesRuntimeGuestNumericSlots } from "./runtime-numeric-slots.js";
import { readRuntimeIteratorMethod } from "./runtime-iterator-method.js";
import { runtimeLength } from "./runtime-length.js";
import { runtimeActualType, type RuntimeSpecialMethodContext } from "./runtime-special-method.js";
import type { BuiltinInvocationContext, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Frame-owned iteration, with live next/getitem lookup and advisory hints only
 * when requested. Native iterator methods preserve completion metadata. Explicit
 * iteration policies remain responsible for custom exception-subclass matching. */
export function createRuntimeIterationContext(values: RuntimeValues, meter: ExecutionMeter, special: RuntimeSpecialMethodContext, invocation: BuiltinInvocationContext): IterationContext<RuntimeValue> {
  meter.checkpoint(0, 704);
  const typeName = (value: RuntimeValue): string => {
    const name = value.kind !== "iterator" && usesRuntimeGuestNumericSlots(value) ? invocation.typeName?.(value) : undefined;
    meter.checkpoint();
    return name ?? (value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind);
  };
  const lookup = (value: RuntimeValue, name: string) => {
    const method = readRuntimeIteratorMethod(value, name, values, meter) ?? (value.kind !== "iterator" && usesRuntimeGuestNumericSlots(value) ? invocation.lookupSpecial?.(value, name) : undefined);
    meter.checkpoint(); return method;
  };
  let hints: LengthHintContext<RuntimeValue> | undefined;
  return {
    lookupIter(value) {
      const method = lookup(value, "__iter__");
      if (method === undefined) return undefined;
      meter.checkpoint(0, 64);
      return () => {
        meter.checkpoint(0, 8);
        if (method === values.none) throw new PythonRuntimeError("TypeError", `'${diagnosticTypeName(typeName(value), meter)}' object is not iterable`);
        const result = invocation.call(method, []); meter.checkpoint(); return result;
      };
    },
    hasNext(value) {
      if (value.kind === "iterator") return true;
      const present = usesRuntimeGuestNumericSlots(value) && (invocation.hasSpecial?.(value, "__next__") ?? false);
      meter.checkpoint(); return present;
    },
    nativeIterator(value) { meter.checkpoint(); return value.kind === "iterator" ? value.value : undefined; },
    next(value) {
      const method = lookup(value, "__next__");
      // Explicit next() checks eligibility before this call. Iteration pulls
      // instead use PyIter_Next's diagnostic when the slot disappears mid-loop.
      if (method === undefined) throw new PythonRuntimeError("TypeError", `'${diagnosticTypeName(typeName(value), meter)}' object is not iterable`);
      meter.checkpoint(0, 8);
      const result = invocation.call(method, []); meter.checkpoint(); return result;
    },
    hasSequenceItem(value) {
      if (value.kind === "iterator" || !usesRuntimeGuestNumericSlots(value)) return false;
      const type = runtimeActualType(value, special, meter); meter.checkpoint();
      const present = type.value.hasSequenceTable && (invocation.hasSpecial?.(value, "__getitem__") ?? false);
      meter.checkpoint(); return present;
    },
    getItem(value, index) {
      const method = lookup(value, "__getitem__");
      if (method === undefined) throw new PythonRuntimeError("TypeError", `'${diagnosticTypeName(typeName(value), meter)}' object does not support indexing`);
      meter.checkpoint(0, 16);
      const result = invocation.call(method, [values.integer(index)]); meter.checkpoint(); return result;
    },
    isStopIteration: invocation.isStopIteration.bind(invocation),
    isIndexError: error => error instanceof PythonRuntimeError && error.name === "IndexError",
    typeName,
    get hints() {
      meter.checkpoint();
      if (hints === undefined) {
        meter.checkpoint(0, 384);
        hints = {
          length: value => value.kind === "iterator" ? undefined : BigInt(runtimeLength(value, meter, undefined, usesRuntimeGuestNumericSlots(value) ? invocation : undefined)),
          lookupHint(value) {
            const method = lookup(value, "__length_hint__");
            if (method === undefined) return undefined;
            meter.checkpoint(0, 64);
            return () => { meter.checkpoint(0, 8); const result = invocation.call(method, []); meter.checkpoint(); return result; };
          },
          integer: value => value.kind === "int" ? value.value : value.kind === "bool" ? value.value ? 1n : 0n : undefined,
          isNotImplemented: value => value === values.notImplemented,
          isTypeError: error => error instanceof PythonRuntimeError && error.name === "TypeError",
          typeName
        };
      }
      return hints;
    }
  };
}
