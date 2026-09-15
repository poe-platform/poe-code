import { PythonRuntimeError } from "./error.js";
import { PythonEncodeError } from "./encode-error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";

type NameField = "__name__" | "__qualname__";
type StringValue = Extract<RuntimeValue, { kind: "str" }>;

/** Intrinsic names are independent of both the namespace and inheritance.
 * Retained guest strings preserve assignment/read identity; host text supports
 * diagnostics without allocating a fresh decoded name at every use. */
export class RuntimeTypeNames {
  #name: string;
  #qualifiedName: string;
  #nameValue?: StringValue;
  #qualifiedNameValue?: StringValue;

  constructor(name: string, qualifiedName: string, meter: ExecutionMeter) {
    meter.checkpoint(1, 64);
    this.#name = name; this.#qualifiedName = qualifiedName;
    Object.freeze(this);
  }

  get name(): string { return this.#name; }

  get(field: NameField, values: RuntimeValues, meter: ExecutionMeter): StringValue {
    meter.checkpoint();
    if (field === "__name__") return this.#nameValue ??= values.string(this.#name);
    return this.#qualifiedNameValue ??= values.string(this.#qualifiedName);
  }

  set(field: NameField, value: RuntimeValue, meter: ExecutionMeter): void {
    meter.checkpoint();
    if (value.kind !== "str") {
      const actual = value.kind === "instance" ? value.type.value.name : value.kind === "type" ? value.metaclass.value.name : value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind;
      meter.checkpoint(0, 128 + 2 * (this.#name.length + actual.length));
      throw new PythonRuntimeError("TypeError", `can only assign string to ${this.#name}.${field}, not '${actual}'`);
    }
    let text = "", nullCharacter = false;
    for (let index = 0; index < value.value.length; index++) {
      const point = value.value.codePointAt(BigInt(index), meter);
      meter.checkpoint(1, point > 0xffff ? 4 : 2);
      if (field === "__name__" && point >= 0xd800 && point <= 0xdfff) {
        let end = index + 1;
        while (end < value.value.length) {
          const next = value.value.codePointAt(BigInt(end), meter);
          if (next < 0xd800 || next > 0xdfff) break;
          end++;
        }
        meter.checkpoint(0, 128);
        throw new PythonEncodeError("utf-8", value.value, index, end, "surrogates not allowed");
      }
      nullCharacter ||= point === 0;
      text += String.fromCodePoint(point);
    }
    meter.checkpoint();
    if (field === "__name__" && nullCharacter) throw new PythonRuntimeError("ValueError", "type name must not contain null characters");
    if (field === "__name__") { this.#name = text; this.#nameValue = value; }
    else { this.#qualifiedName = text; this.#qualifiedNameValue = value; }
  }
}
