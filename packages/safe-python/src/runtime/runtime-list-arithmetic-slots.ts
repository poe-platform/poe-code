import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeAddition } from "./runtime-addition.js";
import { runtimeIntegerIndex } from "./runtime-integer-index.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeListPayload } from "./runtime-list-payload.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** Native list arithmetic wrappers do not negotiate reflected numeric slots.
 * Repetition uses wrapper index errors; in-place operations preserve storage. */
export function installRuntimeListArithmeticSlots(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  meter.checkpoint(0, 320);
  for (const [name, doc] of [["__add__", "Return self+value."], ["__iadd__", "Implement self+=value."], ["__mul__", "Return self*value."], ["__rmul__", "Return value*self."], ["__imul__", "Implement self*=value."]] as const) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.wrapperDescriptor({ owner, name, doc, sequenceOperator: name === "__add__" || name === "__iadd__" ? "+" : "*", accepts: receiver => runtimeListPayload(receiver) !== undefined,
      invoke(receiver, positional, keywords, meter, invocation) {
        meter.checkpoint();
        const list = runtimeListPayload(receiver);
        if (list === undefined) throw Error("list arithmetic slot requires list storage");
        if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
        if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `expected 1 argument, got ${positional.length}`);
        const operand = positional[0];
        if (name === "__add__" || name === "__iadd__") {
          meter.checkpoint(0, 128);
          const typeOf = invocation?.actualType?.bind(invocation);
          const result = runtimeAddition(list, name === "__add__" ? runtimeListPayload(operand) ?? operand : operand, values, meter, { typeName: typeOf === undefined ? undefined : value => typeOf(value).value.name }, name === "__iadd__", undefined,
            { iterate: (value, notIterable, hint) => runtimeIterate(value, values, meter, invocation?.iteration, notIterable, hint) });
          return name === "__iadd__" ? receiver : result;
        }
        const count = runtimeIntegerIndex(operand, meter, invocation?.integerIndex);
        if (BigInt.asIntN(64, count) !== count) {
          const type = diagnosticTypeName(invocation?.actualType?.(operand).value.name ?? operand.kind, meter);
          throw new PythonRuntimeError("OverflowError", `cannot fit '${type}' into an index-sized integer`);
        }
        if (name === "__imul__") { list.items.repeatInPlace(count); return receiver; }
        return values.list(list.items.repeat(count));
      }
    }));
  }
}
