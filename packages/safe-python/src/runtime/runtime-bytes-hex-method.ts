import {bindRuntimeClinicArguments} from "./runtime-clinic-arguments.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { CodePointString } from "./code-point-string.js";
import { runtimeIntegerIndex } from "./runtime-integer-index.js";
import type { IntegerIndexContext } from "./index-protocol.js";
import { runtimeLength } from "./runtime-length.js";
import { runtimeStringPayload } from "./runtime-string-payload.js";
import { runtimeBytesPayload } from "./runtime-bytes-payload.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export function createRuntimeBytesHexMethod(receiver: Extract<RuntimeValue, { kind: "bytes" }>, values: RuntimeValues, meter: ExecutionMeter, context?: IntegerIndexContext<RuntimeValue>): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "hex",
    invoke(positional, keywords, meter, invocation) {
      meter.checkpoint();
      const count = positional.length + keywords.items.size;
      if (count > 2) throw new PythonRuntimeError("TypeError", `hex() takes at most 2 ${positional.length === 0 ? "keyword " : ""}arguments (${count} given)`);
      const [separator,grouping]=bindRuntimeClinicArguments("hex",["sep","bytes_per_sep"],positional,keywords,values,meter,invocation);
      const group = grouping === undefined ? 1n : runtimeIntegerIndex(grouping, meter, context);
      if (BigInt.asIntN(32, group) !== group) throw new PythonRuntimeError("OverflowError", "Python int too large to convert to C int");
      let point: number | null = null;
      if (separator !== undefined) {
        if (BigInt(runtimeLength(separator, meter, undefined, invocation)) !== 1n) throw new PythonRuntimeError("ValueError", "sep must be length 1.");
        const payload = runtimeStringPayload(separator) ?? runtimeBytesPayload(separator);
        if (payload === undefined) throw new PythonRuntimeError("TypeError", "sep must be str or bytes.");
        // CPython checks the whole Unicode storage width, even when an
        // overridden length permits a separator with more than one character.
        if (payload.kind === "str") {
          for (const character of payload.value) {
            meter.checkpoint();
            if (character > 255) throw new PythonRuntimeError("ValueError", "sep must be ASCII.");
          }
        }
        // Native strings/bytes have a trailing NUL. A subtype may report one
        // from __len__ even when its immutable payload is empty.
        point = payload.value.length === 0 ? 0 : payload.kind === "str"
          ? payload.value.codePointAt(0n, meter) : payload.value.byteAt(0n, meter);
        if (point > 127) throw new PythonRuntimeError("ValueError", "sep must be ASCII.");
      }
      return values.stringPoints(CodePointString.fromBytesHex(receiver.value, point, Number(group), meter));
    }
  });
}
