import {bindRuntimeClinicArguments} from "./runtime-clinic-arguments.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { ListStorage } from "./list-storage.js";
import { runtimeTruth } from "./runtime-truth.js";
import { runtimeStringPayload } from "./runtime-string-payload.js";
import type { ExpressionContext } from "./expression-evaluation.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Bytes recognize only CR/LF, while text has additional Unicode boundaries.
 * Both consume CRLF together and omit an extra line after a terminal boundary. */
export function createRuntimeSplitlinesMethod(receiver: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, truth?: ExpressionContext<RuntimeValue>["truth"]): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  const source = receiver.kind === "bytes" ? receiver : runtimeStringPayload(receiver);
  if (source === undefined) throw Error("line splitting requires native string or bytes storage");
  return values.builtinFunction({
    name: "splitlines",
    invoke(positional, keywords, meter, invocation) {
      meter.checkpoint();
      const count = positional.length + keywords.items.size;
      if (count > 1) throw new PythonRuntimeError("TypeError", `splitlines() takes at most 1 ${positional.length === 0 ? "keyword " : ""}argument (${count} given)`);
      const [argument]=bindRuntimeClinicArguments("splitlines",["keepends"],positional,keywords,values,meter,invocation);
      const keepends=argument??values.false;
      const retain = truth === undefined ? runtimeTruth(keepends, meter) : truth(keepends);
      meter.checkpoint();
      const length = BigInt(source.value.length);
      const result = new ListStorage<RuntimeValue>([], meter);
      let start = 0n, index = 0n;
      while (index < length) {
        const point = source.kind === "str" ? source.value.codePointAt(index, meter) : source.value.byteAt(index, meter);
        if (!(point === 10 || point === 13 || source.kind === "str" && isLineBoundary(point))) { index++; continue; }
        const end = index++;
        if (point === 13 && index < length && (source.kind === "str" ? source.value.codePointAt(index, meter) : source.value.byteAt(index, meter)) === 10) index++;
        const stop = retain ? index : end;
        result.append(receiver === source && start === 0n && stop === length ? receiver : source.kind === "str"
          ? values.stringPoints(source.value.slice(start, stop, null, meter), "canonical") : values.bytes(source.value.slice(start, stop, null, meter)));
        start = index;
      }
      if (start < length) result.append(receiver === source && start === 0n ? receiver : source.kind === "str"
        ? values.stringPoints(source.value.slice(start, length, null, meter), "canonical") : values.bytes(source.value.slice(start, length, null, meter)));
      return values.list(result);
    }
  });
}

function isLineBoundary(point: number): boolean {
  return (point >= 10 && point <= 13) || (point >= 0x1c && point <= 0x1e)
    || point === 0x85 || point === 0x2028 || point === 0x2029;
}
