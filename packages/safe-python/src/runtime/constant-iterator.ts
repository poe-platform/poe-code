import type { ConstantValue, ConstantValues } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

type Sequence = Extract<ConstantValue, { kind: "str" | "bytes" | "tuple" }>;

/** Host iterator adapter for exact immutable builtin sequences. Guest iterator
 * type objects, StopIteration conversion and special-method dispatch are separate.
 * Calls/results are metered; host iterator/result-record heap accounting remains
 * unfinished. Exhaustion releases the source reference and never restarts it.
 */
export class ConstantIterator implements IterableIterator<ConstantValue> {
  #source: Sequence | undefined;
  #index = 0;
  readonly #length: number;

  constructor(source: ConstantValue, private readonly values: ConstantValues, private readonly meter: ExecutionMeter) {
    meter.checkpoint();
    if (source.kind !== "str" && source.kind !== "bytes" && source.kind !== "tuple") {
      const name = source.kind === "none" ? "NoneType" : source.kind === "not-implemented" ? "NotImplementedType" : source.kind;
      throw new PythonRuntimeError("TypeError", `'${name}' object is not iterable`);
    }
    this.#source = source;
    this.#length = source.kind === "tuple" ? source.items.length : source.value.length;
  }

  [Symbol.iterator](): IterableIterator<ConstantValue> { return this; }

  lengthHint(): number {
    this.meter.checkpoint();
    return this.#source === undefined ? 0 : this.#length - this.#index;
  }

  next(): IteratorResult<ConstantValue> {
    this.meter.checkpoint();
    const source = this.#source;
    if (source === undefined || this.#index === this.#length) {
      this.#source = undefined;
      return { done: true, value: undefined };
    }
    const index = this.#index++;
    let value: ConstantValue;
    if (source.kind === "tuple") value = source.items[index];
    else if (source.kind === "bytes") value = this.values.integer(source.value.byteAt(BigInt(index), this.meter));
    else {
      const point = source.value.codePointAt(BigInt(index), this.meter);
      this.meter.checkpoint(0, Uint32Array.BYTES_PER_ELEMENT);
      value = this.values.stringPoints(Uint32Array.of(point));
    }
    return { done: false, value };
  }
}
