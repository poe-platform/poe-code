import { exhaustAllocation, type ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { ListIterator } from "./list-iterator.js";

/** Owned mutable list slots, not the guest list type or protocol dispatcher.
 * Index arguments have already passed guest __index__ conversion. The fixed
 * signed-64-bit index model matches other builtin sequence kernels. Growth and
 * shifting work are charged before mutation; native array spare capacity,
 * reallocation copies and guest finalizer integration remain unaccounted for.
 */
export class ListStorage<Value> {
  readonly #items: Value[];

  constructor(values: readonly Value[], private readonly meter: ExecutionMeter) {
    const length = values.length;
    meter.checkpoint(1, 32 + length * 8);
    this.#items = new Array(length);
    for (let i = 0; i < length; i++) { meter.checkpoint(); this.#items[i] = values[i]; }
    Object.freeze(this);
  }

  get length(): number { this.meter.checkpoint(); return this.#items.length; }

  get(index: bigint): Value { return this.#items[this.#position(index, "read")]; }

  set(index: bigint, value: Value): void { this.#items[this.#position(index, "write")] = value; }

  append(value: Value): void {
    this.meter.checkpoint(1, 8);
    if (this.#items.length === 0xffffffff) exhaustAllocation(this.meter);
    this.#items.push(value);
  }

  insert(index: bigint, value: Value): void {
    this.meter.checkpoint();
    if (BigInt.asIntN(64, index) !== index) throw new PythonRuntimeError("OverflowError", "Python int too large to convert to C ssize_t");
    const length = this.#items.length;
    if (index < 0n) index += BigInt(length);
    const position = index < 0n ? 0 : index > BigInt(length) ? length : Number(index);
    this.meter.checkpoint(1 + length - position, 8);
    if (length === 0xffffffff) exhaustAllocation(this.meter);
    this.#items.push(value);
    for (let i = length; i > position; i--) this.#items[i] = this.#items[i - 1];
    this.#items[position] = value;
  }

  pop(index = -1n): Value { return this.#remove(this.#position(index, "pop")); }

  delete(index: bigint): void { this.#remove(this.#position(index, "write")); }

  clear(): void {
    this.meter.checkpoint(1 + this.#items.length);
    this.#items.length = 0;
  }

  reverse(): void {
    const swaps = Math.floor(this.#items.length / 2);
    this.meter.checkpoint(1 + swaps);
    for (let i = 0; i < swaps; i++) {
      const other = this.#items.length - i - 1, value = this.#items[i];
      this.#items[i] = this.#items[other]; this.#items[other] = value;
    }
  }

  iterate(): ListIterator<Value> { return new ListIterator(this.#items, false, this.meter); }

  reversed(): ListIterator<Value> { return new ListIterator(this.#items, true, this.meter); }

  snapshot(): readonly Value[] {
    this.meter.checkpoint(1 + this.#items.length, 32 + this.#items.length * 8);
    return Object.freeze(this.#items.slice());
  }

  #position(index: bigint, operation: "read" | "write" | "pop"): number {
    this.meter.checkpoint();
    if (BigInt.asIntN(64, index) !== index) {
      if (operation === "pop") throw new PythonRuntimeError("OverflowError", "Python int too large to convert to C ssize_t");
      throw new PythonRuntimeError("IndexError", "cannot fit 'int' into an index-sized integer");
    }
    if (operation === "pop" && this.#items.length === 0) throw new PythonRuntimeError("IndexError", "pop from empty list");
    if (index < 0n) index += BigInt(this.#items.length);
    if (index < 0n || index >= BigInt(this.#items.length)) throw new PythonRuntimeError("IndexError", operation === "read" ? "list index out of range" : operation === "write" ? "list assignment index out of range" : "pop index out of range");
    return Number(index);
  }

  #remove(position: number): Value {
    this.meter.checkpoint(this.#items.length - position);
    const value = this.#items[position];
    for (let i = position; i < this.#items.length - 1; i++) this.#items[i] = this.#items[i + 1];
    this.#items.pop();
    return value;
  }
}
