import type { CodePointString } from "./code-point-string.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { scanFormatFieldName } from "./format-field-name.js";

export interface FormatFieldHooks<Value> {
  keyword(name: CodePointString): Value;
  attribute(value: Value, name: CodePointString): Value;
  item(value: Value, key: CodePointString | bigint): Value;
}

/** One formatting invocation owns one resolver, also shared by nested specs.
 * Null positional arguments select format_map. Hooks own guest lookup semantics
 * and errors; no JavaScript property or mapping access is implicit. Positional
 * arguments must remain stable for the invocation, as a Python args tuple does. */
export class FormatFieldResolver<Value> {
  #next = 0n;
  #mode: "auto" | "manual" | undefined;

  constructor(private readonly positional: readonly Value[] | null, private readonly hooks: FormatFieldHooks<Value>, private readonly meter: ExecutionMeter) {
    meter.checkpoint(1, 192);
  }

  resolve(source: CodePointString, start = 0, end = source.length): Value {
    const { meter, hooks, positional } = this;
    meter.checkpoint(1, 128);
    const steps = scanFormatFieldName(source, meter, start, end);
    const first = steps.next();
    if (first.done || first.value.kind !== "first") throw new Error("format field has no initial lookup");
    const field = first.value, automatic = field.start === field.end;
    let index = field.index, value: Value;
    if (automatic || index !== null) {
      if (this.#mode === "manual" && automatic) throw new PythonRuntimeError("ValueError", "cannot switch from manual field specification to automatic field numbering");
      if (this.#mode === "auto" && !automatic) throw new PythonRuntimeError("ValueError", "cannot switch from automatic field numbering to manual field specification");
      this.#mode = automatic ? "auto" : "manual";
      if (automatic) { meter.checkpoint(1, 64); index = this.#next++; }
      if (positional === null) throw new PythonRuntimeError("ValueError", "Format string contains positional fields");
      if (index === null) throw new Error("numeric format field lost its index");
      if (index >= BigInt(positional.length)) throw new PythonRuntimeError("IndexError", `Replacement index ${index} out of range for positional args tuple`);
      value = positional[Number(index)];
    } else {
      value = hooks.keyword(source.slice(BigInt(field.start), BigInt(field.end), null, meter));
      meter.checkpoint();
    }
    for (const step of steps) {
      if (step.kind === "first") throw new Error("duplicate initial format lookup");
      if (step.kind === "attribute") value = hooks.attribute(value, source.slice(BigInt(step.start), BigInt(step.end), null, meter));
      else value = hooks.item(value, step.index ?? source.slice(BigInt(step.start), BigInt(step.end), null, meter));
      meter.checkpoint();
    }
    return value;
  }
}
