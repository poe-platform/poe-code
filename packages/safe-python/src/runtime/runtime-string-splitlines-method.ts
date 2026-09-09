import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { ListStorage } from "./list-storage.js";
import { runtimeTruth } from "./runtime-truth.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Python line boundaries are a strict subset of whitespace. CRLF is consumed
 * together; a terminal boundary never introduces an extra empty line. */
export function createRuntimeStringSplitlinesMethod(receiver: Extract<RuntimeValue, { kind: "str" }>, values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
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
      const retain = runtimeTruth(keepends, meter), text = receiver.value, length = BigInt(text.length);
      const result = new ListStorage<RuntimeValue>([], meter);
      let start = 0n, index = 0n;
      while (index < length) {
        const point = text.codePointAt(index, meter);
        if (!isLineBoundary(point)) { index++; continue; }
        const end = index++;
        if (point === 13 && index < length && text.codePointAt(index, meter) === 10) index++;
        const stop = retain ? index : end;
        result.append(start === 0n && stop === length ? receiver : values.stringPoints(text.slice(start, stop, null, meter)));
        start = index;
      }
      if (start < length) result.append(start === 0n ? receiver : values.stringPoints(text.slice(start, length, null, meter)));
      return values.list(result);
    }
  });
}

function isLineBoundary(point: number): boolean {
  return (point >= 10 && point <= 13) || (point >= 0x1c && point <= 0x1e)
    || point === 0x85 || point === 0x2028 || point === 0x2029;
}
