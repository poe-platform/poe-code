import { CodePointString } from "./code-point-string.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { FormatSpec } from "./format-spec.js";
import { integerIndex, type IntegerIndexContext } from "./index-protocol.js";
import { runtimeIntegerIndex } from "./runtime-integer-index.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Explicit radix builtin registration. Fixed presentation metadata is prepared
 * once; the shared integer renderer owns sign/prefix placement and bounded
 * allocation. Power-of-two radices are exempt from decimal conversion limits. */
export function createRadixBuiltin(name: "bin" | "oct" | "hex", values: RuntimeValues, meter: ExecutionMeter, index?: IntegerIndexContext<RuntimeValue>): BuiltinFunctionValue {
  meter.checkpoint(1, 256);
  const field: FormatSpec = Object.freeze({
    fill: 32, align: ">", sign: null, noNegativeZero: false, alternate: true,
    width: null, grouping: null, groupSize: 4, precision: null,
    fractionGrouping: null, type: { bin: 98, oct: 111, hex: 120 }[name]
  });
  return values.builtinFunction({ name, invoke(positional, keywords, meter, invocation) {
    meter.checkpoint();
    if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `${name}() takes no keyword arguments`);
    if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `${name}() takes exactly one argument (${positional.length} given)`);
    const protocol = index ?? invocation?.integerIndex;
    const integer = protocol === undefined ? runtimeIntegerIndex(positional[0], meter) : integerIndex(positional[0], protocol, meter);
    meter.checkpoint();
    return values.stringPoints(CodePointString.fromIntegerRadixFormat(integer, field, meter));
  } });
}
