import { constantRepeat } from "./constant-repeat.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeAddition } from "./runtime-addition.js";
import { runtimeIntegerIndex } from "./runtime-integer-index.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** Explicit immutable sequence operations bypass numeric reflection. Index
 * conversion and signed-size validation precede repetition identity shortcuts. */
export function installRuntimeTupleArithmeticSlots(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  meter.checkpoint(0, 192);
  for (const [name, doc] of [["__add__", "Return self+value."], ["__mul__", "Return self*value."], ["__rmul__", "Return value*self."]] as const) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.wrapperDescriptor({ owner, name, doc, sequenceOperator: name === "__add__" ? "+" : "*", accepts: receiver => receiver.kind === "tuple",
      invoke(receiver, positional, keywords, meter, invocation) {
        meter.checkpoint();
        if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
        if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `expected 1 argument, got ${positional.length}`);
        if (receiver.kind !== "tuple") throw Error("tuple arithmetic requires tuple storage");
        const operand = positional[0];
        if (name === "__add__") {
          meter.checkpoint(0, 64);
          const typeOf = invocation?.actualType?.bind(invocation);
          return runtimeAddition(receiver, operand, values, meter, { typeName: typeOf === undefined ? undefined : value => typeOf(value).value.name });
        }
        const count = runtimeIntegerIndex(operand, meter, invocation?.integerIndex);
        if (BigInt.asIntN(64, count) !== count) {
          const type = diagnosticTypeName(invocation?.actualType?.(operand).value.name ?? operand.kind, meter);
          throw new PythonRuntimeError("OverflowError", `cannot fit '${type}' into an index-sized integer`);
        }
        return constantRepeat(receiver, values.integer(count), values, meter);
      }
    }));
  }
}
