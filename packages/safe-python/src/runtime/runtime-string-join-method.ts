import type { CodePointString } from "./code-point-string.js";
import { PythonRuntimeError } from "./error.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { runtimeStringPayload } from "./runtime-string-payload.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeSequenceIterator } from "./runtime-sequence-iterator.js";
import type { ExpressionContext } from "./expression-evaluation.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Materialize generic input before validating members, as Python join does.
 * Iterator failures retain precedence over bad elements already collected.
 * Guest cursors supply length hints; members use native string storage without
 * invoking guest conversions. Only exact singleton strings retain identity. */
export function createRuntimeStringJoinMethod(receiver: Extract<RuntimeValue, { kind: "str" }>, values: RuntimeValues, meter: ExecutionMeter, iterate?: ExpressionContext<RuntimeValue>["iterate"]): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "join",
    invoke(positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "str.join() takes no keyword arguments");
      if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `str.join() takes exactly one argument (${positional.length} given)`);
      const source = positional[0];
      let items: readonly RuntimeValue[];
      if (source.kind === "tuple") items = source.items;
      else if (source.kind === "list") items = source.items.snapshot();
      else {
        const iterator = runtimeSequenceIterator(source, values, meter, "can only join an iterable", iterate, invocation);
        meter.checkpoint(1, 32);
        const collected: RuntimeValue[] = [];
        while (true) {
          meter.checkpoint(); const item = iterator.next(); meter.checkpoint();
          if (item.done) break;
          meter.checkpoint(0, 8); collected.push(item.value);
        }
        items = collected;
      }
      if (items.length === 0) return values.string("");
      if (items.length === 1 && items[0].kind === "str") return items[0];
      meter.checkpoint(1, 32 + 8 * items.length);
      const parts: CodePointString[] = new Array(items.length);
      for (let i = 0; i < items.length; i++) {
        meter.checkpoint(); const item = items[i];
        const payload = runtimeStringPayload(item);
        if (payload === undefined) {
          const type = diagnosticTypeName(item.kind === "none" ? "NoneType" : item.kind === "not-implemented" ? "NotImplementedType" : item.kind === "instance" ? item.type.value.diagnosticName : item.kind, meter, 80);
          throw new PythonRuntimeError("TypeError", `sequence item ${i}: expected str instance, ${type} found`);
        }
        parts[i] = payload.value;
      }
      return values.stringPoints(receiver.value.join(parts, meter));
    }
  });
}
