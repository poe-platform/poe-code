import { exhaustAllocation, type ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { ListIterator } from "./list-iterator.js";
import { normalizeSlice } from "./integer-sequence.js";

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

  slice(start: bigint | null = null, stop: bigint | null = null, step: bigint | null = null): ListStorage<Value> {
    this.meter.checkpoint();
    const indices = normalizeSlice(BigInt(this.#items.length), start, stop, step);
    const count = Number(indices.length), first = Number(indices.start);
    const stride = count > 1 ? Number(indices.step) : 0;
    const result = new ListStorage<Value>([], this.meter);
    this.meter.checkpoint(count, count * 8);
    result.#items.length = count;
    for (let i = 0; i < count; i++) result.#items[i] = this.#items[first + i * stride];
    return result;
  }

  /** Replacement is already materialized and slice components already converted
   * by the guest protocol layer. Normalize against the current length after
   * materialization, since guest iteration may have changed this list. No guest
   * callbacks run while slots shift; finalizer deferral belongs to that layer.
   */
  setSlice(start: bigint | null, stop: bigint | null, step: bigint | null, replacement: ListStorage<Value>): void {
    this.meter.checkpoint();
    const length = this.#items.length, indices = normalizeSlice(BigInt(length), start, stop, step);
    const count = Number(indices.length), first = Number(indices.start), added = replacement.#items.length;
    if (indices.step !== 1n && count !== added) {
      throw new PythonRuntimeError("ValueError", `attempt to assign sequence of size ${added} to extended slice of size ${count}`);
    }
    // Snapshot only the aliased source, before any mutation or shifting.
    const values = replacement === this ? this.snapshot() : replacement.#items;
    if (indices.step !== 1n) {
      const stride = count > 1 ? Number(indices.step) : 0;
      this.meter.checkpoint(count);
      for (let i = 0; i < count; i++) this.#items[first + i * stride] = values[i];
      return;
    }
    const delta = added - count, tail = first + count, size = length + delta;
    this.meter.checkpoint(added + (delta === 0 ? 0 : length - tail), Math.max(0, delta) * 8);
    if (size > 0xffffffff) exhaustAllocation(this.meter);
    if (delta > 0) {
      this.#items.length = size;
      for (let i = length - 1; i >= tail; i--) this.#items[i + delta] = this.#items[i];
    } else if (delta < 0) {
      for (let i = tail; i < length; i++) this.#items[i + delta] = this.#items[i];
      this.#items.length = size;
    }
    for (let i = 0; i < added; i++) this.#items[first + i] = values[i];
  }

  deleteSlice(start: bigint | null = null, stop: bigint | null = null, step: bigint | null = null): void {
    this.meter.checkpoint();
    const length = this.#items.length, indices = normalizeSlice(BigInt(length), start, stop, step);
    const count = Number(indices.length);
    if (count === 0) return;
    // Visit removed positions in ascending order so survivors compact in one
    // pass, including negative strides, without a positions array or tail copy.
    const first = Number(indices.step < 0n ? indices.start + (indices.length - 1n) * indices.step : indices.start);
    const stride = count > 1 ? Number(indices.step < 0n ? -indices.step : indices.step) : 0;
    this.meter.checkpoint(length - first);
    let write = first, removed = 0, next = first;
    for (let read = first; read < length; read++) {
      if (removed < count && read === next) { removed++; next += stride; }
      else this.#items[write++] = this.#items[read];
    }
    this.#items.length = length - count;
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
