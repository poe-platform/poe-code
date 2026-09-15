import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { unexpectedBuiltinKeyword } from "./unexpected-builtin-keyword.js";
import type { IterationContext } from "./protocol-iterator.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeAddition } from "./runtime-addition.js";
import { runtimeStringPayload } from "./runtime-string-payload.js";
import { runtimeBytesPayload } from "./runtime-bytes-payload.js";
import { sumIterator } from "./sum-iterator.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface SumContext {
  iteration?: IterationContext<RuntimeValue>;
  /** Full ordinary addition, including reflected slots and unsupported errors;
   * must not perform in-place addition or return a dispatch sentinel. */
  add?(left: RuntimeValue, right: RuntimeValue): RuntimeValue;
  /** Pure storage/type classification for str/bytes/bytearray subclasses. */
  stringStart?(value: RuntimeValue): "strings" | "bytes" | "bytearray" | undefined;
}

/** Explicit sum(iterable, /, start=0) binding. Iterator acquisition precedes
 * start validation; no length hint is requested and failures do not close the
 * source. Numeric phase progression is owned by the streaming sum kernel. */
export function createSumBuiltin(values: RuntimeValues, meter: ExecutionMeter, context: SumContext = {}): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({ name: "sum", invoke(positional, keywords, meter, invocation) {
    meter.checkpoint();
    const count = positional.length + keywords.items.size;
    if (count > 2) throw new PythonRuntimeError("TypeError", `sum() takes at most 2 ${positional.length ? "" : "keyword "}arguments (${count} given)`);
    if (positional.length === 0) throw new PythonRuntimeError("TypeError", "sum() takes at least 1 positional argument (0 given)");
    let start = positional[1];
    for (const [name, value] of keywords.items.snapshot()) {
      const payload = runtimeStringPayload(name);
      if (payload === undefined) throw new PythonRuntimeError("TypeError", "keywords must be strings");
      let label = "";
      for (const point of payload.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); label += String.fromCodePoint(point); }
      if (label === "start") start = value;
      else unexpectedBuiltinKeyword("sum", keywords, ["start"], values, meter, invocation);
    }
    const cursor = runtimeIterate(positional[0], values, meter, context.iteration ?? invocation?.iteration);
    if (start === undefined) start = values.integer(0);
    else {
      const kind = runtimeStringPayload(start) !== undefined ? "strings" : runtimeBytesPayload(start) !== undefined ? "bytes" : context.stringStart?.(start);
      meter.checkpoint();
      if (kind !== undefined) throw new PythonRuntimeError("TypeError", `sum() can't sum ${kind} [use ${kind === "strings" ? "''" : "b''"}.join(seq) instead]`);
    }
    meter.checkpoint(0, 64);
    return sumIterator(cursor, start, values, (left, right) => {
      if (context.add !== undefined) return context.add(left, right);
      if (invocation?.binary !== undefined) return invocation.binary("+", left, right);
      return runtimeAddition(left, right, values, meter);
    }, meter);
  } });
}
