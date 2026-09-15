import { dispatchBinaryOperation, type BinaryDispatch } from "./binary-dispatch.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeDivmod } from "./runtime-divmod.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface DivmodContext {
  /** Prepare type-level __divmod__/__rdivmod__ negotiation, including native
   * slots for mixed native/guest pairs. Undefined selects exact real kernels.
   * The dispatch sentinel must belong to this execution. */
  numeric?(left: RuntimeValue, right: RuntimeValue): BinaryDispatch<RuntimeValue> | undefined;
  typeName?(value: RuntimeValue): string;
}

/** Explicit positional-only builtin registration. Guest results are unrestricted;
 * divmod is its own numeric protocol, never separate // and % dispatches. */
export function createDivmodBuiltin(values: RuntimeValues, meter: ExecutionMeter, context?: DivmodContext): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({ name: "divmod", invoke(positional, keywords, meter, invocation) {
    meter.checkpoint();
    if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "divmod() takes no keyword arguments");
    if (positional.length !== 2) throw new PythonRuntimeError("TypeError", `divmod expected 2 arguments, got ${positional.length}`);
    const [left, right] = positional;
    const prepared = context === undefined ? invocation?.numeric?.("divmod()", left, right) : undefined;
    meter.checkpoint();
    const numeric = context === undefined ? prepared?.numeric : context.numeric?.(left, right);
    meter.checkpoint();
    const result = numeric === undefined ? runtimeDivmod(left, right, values, meter) : dispatchBinaryOperation(numeric, meter);
    meter.checkpoint();
    if (result !== values.notImplemented) return result;
    const names: string[] = [];
    meter.checkpoint(0, 48);
    for (const value of positional) {
      const name = (context === undefined ? prepared?.typeName?.(value) : context.typeName?.(value)) ?? (value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind);
      names.push(diagnosticTypeName(name, meter, 100));
    }
    throw new PythonRuntimeError("TypeError", `unsupported operand type(s) for divmod(): '${names[0]}' and '${names[1]}'`);
  } });
}
