import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { ListStorage } from "./list-storage.js";
import { runtimeTruth } from "./runtime-truth.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Bytes recognize only CR/LF, while text has additional Unicode boundaries.
 * Both consume CRLF together and omit an extra line after a terminal boundary. */
export function createRuntimeSplitlinesMethod(receiver: Extract<RuntimeValue, { kind: "str" | "bytes" }>, values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "splitlines",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      const count = positional.length + keywords.items.size;
      if (count > 1) throw new PythonRuntimeError("TypeError", `splitlines() takes at most 1 ${positional.length === 0 ? "keyword " : ""}argument (${count} given)`);
      let keepends: RuntimeValue = positional[0] ?? values.false;
      for (const [name, value] of keywords.items.snapshot()) {
        if (name.kind !== "str") throw new PythonRuntimeError("TypeError", "keywords must be strings");
        let label = "";
        for (const point of name.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); label += String.fromCodePoint(point); }
        if (label !== "keepends") throw new PythonRuntimeError("TypeError", `splitlines() got an unexpected keyword argument '${label}'`);
        keepends = value;
      }
      const retain = runtimeTruth(keepends, meter), length = BigInt(receiver.value.length);
      const result = new ListStorage<RuntimeValue>([], meter);
      let start = 0n, index = 0n;
      while (index < length) {
        const point = receiver.kind === "str" ? receiver.value.codePointAt(index, meter) : receiver.value.byteAt(index, meter);
        if (!(point === 10 || point === 13 || receiver.kind === "str" && isLineBoundary(point))) { index++; continue; }
        const end = index++;
        if (point === 13 && index < length && (receiver.kind === "str" ? receiver.value.codePointAt(index, meter) : receiver.value.byteAt(index, meter)) === 10) index++;
        const stop = retain ? index : end;
        result.append(start === 0n && stop === length ? receiver : receiver.kind === "str"
          ? values.stringPoints(receiver.value.slice(start, stop, null, meter)) : values.bytes(receiver.value.slice(start, stop, null, meter)));
        start = index;
      }
      if (start < length) result.append(start === 0n ? receiver : receiver.kind === "str"
        ? values.stringPoints(receiver.value.slice(start, length, null, meter)) : values.bytes(receiver.value.slice(start, length, null, meter)));
      return values.list(result);
    }
  });
}

function isLineBoundary(point: number): boolean {
  return (point >= 10 && point <= 13) || (point >= 0x1c && point <= 0x1e)
    || point === 0x85 || point === 0x2028 || point === 0x2029;
}
