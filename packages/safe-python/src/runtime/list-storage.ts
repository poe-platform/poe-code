import { exhaustAllocation, type ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { ListIterator } from "./list-iterator.js";
import { normalizeSlice } from "./integer-sequence.js";
import { stableSort, type StableSortContext } from "./stable-sort.js";

/** Owned mutable list slots, not the guest list type or protocol dispatcher.
 * Index arguments have already passed guest __index__ conversion. The fixed
 * signed-64-bit index model matches other builtin sequence kernels. Growth and
 * shifting work are charged before mutation; native array spare capacity,
 * reallocation copies and guest finalizer integration remain unaccounted for.
 */
export class ListStorage<Value> {
  readonly #items: Value[];
  #sortModified: boolean | undefined;

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
    if (this.#sortModified !== undefined) this.#sortModified = true;
    this.#items.push(value);
  }

  /** Exact list fast path; capture the source length before growth so extending
   * a list with itself duplicates its original slots exactly once. */
  extend(source: ListStorage<Value>): void {
    const offset = this.#items.length, count = source.#items.length;
    this.meter.checkpoint(1 + count, count * 8);
    if (offset + count > 0xffffffff) exhaustAllocation(this.meter);
    if (count > 0 && this.#sortModified !== undefined) this.#sortModified = true;
    this.#items.length = offset + count;
    for (let i = 0; i < count; i++) this.#items[offset + i] = source.#items[i];
  }

  /** The guest layer prepares the iterator and evaluates its length hint before
   * this streaming path. Earlier additions survive next failures; no implicit
   * iterator close occurs. A live iterator over this list is not self-extension
   * and can continue growing until the execution budget terminates it. */
  extendIterator(iterator: Iterator<Value>): void {
    while (true) {
      this.meter.checkpoint();
      const item = iterator.next();
      this.meter.checkpoint();
      if (item.done) return;
      this.append(item.value);
    }
  }

  concat(other: ListStorage<Value>): ListStorage<Value> {
    this.meter.checkpoint();
    const left = this.#items.length, length = left + other.#items.length;
    if (length > 0xffffffff) exhaustAllocation(this.meter);
    const result = new ListStorage<Value>([], this.meter);
    this.meter.checkpoint(length, length * 8);
    result.#items.length = length;
    for (let i = 0; i < length; i++) result.#items[i] = i < left ? this.#items[i] : other.#items[i - left];
    return result;
  }

  /** Unlike immutable tuple repetition, even zero/one repetitions return fresh
   * list slots. Elements themselves retain identity; no intermediate slot copy.
   * The guest caller owns __index__ conversion and reflected operator dispatch.
   */
  repeat(count: bigint): ListStorage<Value> {
    const length = this.#repeatedLength(count), original = this.#items.length;
    const result = new ListStorage<Value>([], this.meter);
    this.meter.checkpoint(length, length * 8);
    result.#items.length = length;
    for (let i = 0; i < length; i++) result.#items[i] = this.#items[i % original];
    return result;
  }

  repeatInPlace(count: bigint): void {
    const length = this.#repeatedLength(count), original = this.#items.length;
    if (length === original) return;
    if (length === 0) { this.clear(); return; }
    this.meter.checkpoint(length - original, (length - original) * 8);
    if (this.#sortModified !== undefined) this.#sortModified = true;
    this.#items.length = length;
    for (let i = original; i < length; i++) this.#items[i] = this.#items[i % original];
  }

  insert(index: bigint, value: Value): void {
    this.meter.checkpoint();
    if (BigInt.asIntN(64, index) !== index) throw new PythonRuntimeError("OverflowError", "Python int too large to convert to C ssize_t");
    const length = this.#items.length;
    if (index < 0n) index += BigInt(length);
    const position = index < 0n ? 0 : index > BigInt(length) ? length : Number(index);
    this.meter.checkpoint(1 + length - position, 8);
    if (length === 0xffffffff) exhaustAllocation(this.meter);
    if (this.#sortModified !== undefined) this.#sortModified = true;
    this.#items.push(value);
    for (let i = length; i > position; i--) this.#items[i] = this.#items[i - 1];
    this.#items[position] = value;
  }

  pop(index = -1n): Value { return this.#remove(this.#position(index, "pop")); }

  delete(index: bigint): void { this.#remove(this.#position(index, "write")); }

  /** Search bound arguments have already passed guest __index__ conversion.
   * Positive stops are not clipped to the initial list length: comparisons may
   * append elements. Absence is returned to the guest layer for its ValueError
   * (index/remove) or boolean membership result, without running repr here.
   */
  indexOf(value: Value, equal: (stored: Value, incoming: Value) => boolean, start = 0n, stop: bigint | null = null): number | undefined {
    this.meter.checkpoint();
    const length = BigInt(this.#items.length);
    const first = Math.max(0, Number(start < 0n ? start + length : start));
    const end = stop === null ? Infinity : Math.max(0, Number(stop < 0n ? stop + length : stop));
    for (let i = first; i < end && i < this.#items.length; i++) {
      this.meter.checkpoint();
      const stored = this.#items[i];
      if (Object.is(stored, value)) return i;
      const matches = equal(stored, value);
      this.meter.checkpoint();
      if (matches) return i;
    }
    return undefined;
  }

  count(value: Value, equal: (stored: Value, incoming: Value) => boolean): number {
    this.meter.checkpoint();
    let count = 0;
    for (let i = 0; i < this.#items.length; i++) {
      this.meter.checkpoint();
      const stored = this.#items[i];
      if (Object.is(stored, value)) { count++; continue; }
      const matches = equal(stored, value);
      this.meter.checkpoint();
      if (matches) count++;
    }
    return count;
  }

  removeFirst(value: Value, equal: (stored: Value, incoming: Value) => boolean): boolean {
    const index = this.indexOf(value, equal);
    if (index === undefined) return false;
    // Equality can remove or shift the matched element. Python deletes the
    // current numeric position, and still succeeds if that position vanished.
    if (index < this.#items.length) this.#remove(index);
    return true;
  }

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

  /** Hide saved elements from guest callbacks, retaining the backing array for
   * existing cursors. Any growth of the temporary empty list marks modification,
   * even if later undone. Shrink/reorder alone cannot change an empty list.
   * Restoration is prepaid and runs without guest code after fatal termination.
   * On comparison failure the kernel restores original order, not CPython's
   * algorithm-dependent partial permutation. Finalizer handling is still external.
   */
  sort<Key>(context: StableSortContext<Value, Key>): void {
    const original = this.snapshot();
    this.meter.checkpoint(1 + original.length * 2, original.length * 8);
    const outerModified = this.#sortModified;
    this.#sortModified = false;
    this.#items.length = 0;
    let result = original;
    try {
      result = stableSort(original, context, this.meter);
      if (this.#sortModified) throw new PythonRuntimeError("ValueError", "list modified during sort");
    } finally {
      this.#items.length = result.length;
      for (let i = 0; i < result.length; i++) this.#items[i] = result[i];
      this.#sortModified = outerModified === undefined ? undefined : outerModified || this.#sortModified;
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
      if (this.#sortModified !== undefined) this.#sortModified = true;
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

  #repeatedLength(count: bigint): number {
    this.meter.checkpoint();
    if (BigInt.asIntN(64, count) !== count) throw new PythonRuntimeError("OverflowError", "cannot fit 'int' into an index-sized integer");
    const length = BigInt(this.#items.length) * (count < 0n ? 0n : count);
    if (length > (1n << 63n) - 1n) throw new PythonRuntimeError("MemoryError", "");
    if (length > 0xffffffffn) exhaustAllocation(this.meter);
    return Number(length);
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
