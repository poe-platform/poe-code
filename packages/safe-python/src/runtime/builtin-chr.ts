import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { integerIndex, type IntegerIndexContext } from "./index-protocol.js";
import { runtimeIntegerIndex } from "./runtime-integer-index.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Explicit builtin registration; optional index capabilities add guest slots
 * and warning policy. Unicode range validation never narrows through a C int. */
export function createChrBuiltin(values: RuntimeValues, meter: ExecutionMeter, index?: IntegerIndexContext<RuntimeValue>): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({ name: "chr", invoke(positional, keywords, meter, invocation) {
    meter.checkpoint();
    if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "chr() takes no keyword arguments");
    if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `chr() takes exactly one argument (${positional.length} given)`);
    const protocol = index ?? invocation?.integerIndex;
    const point = protocol === undefined ? runtimeIntegerIndex(positional[0], meter) : integerIndex(positional[0], protocol, meter);
    meter.checkpoint();
    if (point < 0n || point >= 0x110000n) throw new PythonRuntimeError("ValueError", "chr() arg not in range(0x110000)");
    meter.checkpoint(0, Uint32Array.BYTES_PER_ELEMENT);
    return values.stringPoints(Uint32Array.of(Number(point)), "canonical");
  } });
}
