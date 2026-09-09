import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { ListStorage } from "./list-storage.js";
import { runtimeSizeIndex } from "./runtime-size-index.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Exact str/bytes split binding. Guest index slots and subclasses remain
 * object-protocol work; integer limits match the signed-size sequence model. */
export function createRuntimeSplitMethod(receiver: Extract<RuntimeValue, { kind: "str" | "bytes" }>, name: "split" | "rsplit", values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      const count = positional.length + keywords.items.size;
      if (count > 2) throw new PythonRuntimeError("TypeError", `${name}() takes at most 2 ${positional.length === 0 ? "keyword " : ""}arguments (${count} given)`);
      let separator = positional[0] ?? values.none, limit = positional[1];
      for (const [key, value] of keywords.items.snapshot()) {
        if (key.kind !== "str") throw new PythonRuntimeError("TypeError", "keywords must be strings");
        let label = "";
        for (const point of key.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); label += String.fromCodePoint(point); }
        if (label !== "sep" && label !== "maxsplit") throw new PythonRuntimeError("TypeError", `${name}() got an unexpected keyword argument '${label}'`);
        const position = label === "sep" ? 1 : 2;
        if (positional.length >= position) throw new PythonRuntimeError("TypeError", `argument for ${name}() given by name ('${label}') and position (${position})`);
        if (label === "sep") separator = value; else limit = value;
      }
      const maxsplit = limit === undefined ? -1n : runtimeSizeIndex(limit, meter);
      if (receiver.kind === "bytes") {
        if (separator.kind !== "none" && separator.kind !== "bytes") throw new PythonRuntimeError("TypeError", `a bytes-like object is required, not '${separator.kind === "not-implemented" ? "NotImplementedType" : separator.kind}'`);
        const reverse = name === "rsplit", result = new ListStorage<RuntimeValue>([], meter);
        for (const part of receiver.value.split(separator.kind === "none" ? null : separator.value, maxsplit, reverse, meter)) {
          meter.checkpoint();
          result.append(part === receiver.value ? receiver : values.bytes(part));
        }
        if (reverse) result.reverse();
        return values.list(result);
      }
      if (separator.kind !== "none" && separator.kind !== "str") throw new PythonRuntimeError("TypeError", `must be str or None, not ${separator.kind === "not-implemented" ? "NotImplementedType" : separator.kind}`);
      const reverse = name === "rsplit", result = new ListStorage<RuntimeValue>([], meter);
      for (const part of receiver.value.split(separator.kind === "none" ? null : separator.value, maxsplit, reverse, meter)) {
        meter.checkpoint();
        // A zero-limit whitespace remainder uses the copying path, not the
        // unsplit fast path. CPython's cached Latin-1 singleton is an exception.
        const copyRemainder = separator.kind === "none" && maxsplit === 0n
          && !(part.length === 1 && part.codePointAt(0n, meter) <= 0xff);
        result.append(part === receiver.value && !copyRemainder ? receiver : values.stringPoints(part));
      }
      if (reverse) result.reverse();
      return values.list(result);
    }
  });
}
