import { exhaustAllocation, type ExecutionMeter } from "./execution-budget.js";

/** Positional entries for incrementally built, combined general-key dictionaries.
 * Entry objects have stable identity; key matching and payload updates belong to
 * the hash-storage owner. Deletion leaves holes, insertion exhaustion compacts,
 * and pop truncates without refunding usable capacity. Cursors retain numeric
 * positions across every mutation, including clear and compaction.
 * Split/shared-key layouts, presized bulk construction and Unicode-to-general
 * layout transitions are not modeled here yet. Not a set table or guest iterator.
 */
export class DictionaryEntrySlots<Entry extends object> {
  #slots: (Entry | undefined)[];
  #positions: Map<Entry, number>;
  #usable = 0;

  constructor(private readonly meter: ExecutionMeter) {
    meter.checkpoint(1, 96);
    this.#slots = []; this.#positions = new Map();
    Object.freeze(this);
  }

  append(entry: Entry): void {
    this.meter.checkpoint();
    if (this.#positions.has(entry)) throw new Error("entry is already present");
    if (this.#usable !== 0) {
      this.meter.checkpoint(1, 48);
      this.#positions.set(entry, this.#slots.length);
      this.#slots.push(entry); this.#usable--;
      return;
    }
    // Combined dict insertion uses used*3 rounded up to a power of two, with
    // a minimum eight hash slots and floor(2*size/3) entry capacity.
    let size = 8;
    const minimum = this.#positions.size * 3;
    while (size < minimum) { this.meter.checkpoint(); size *= 2; }
    const capacity = Math.floor(size * 2 / 3);
    if (capacity > 0xffffffff) exhaustAllocation(this.meter);
    this.meter.checkpoint(1 + this.#slots.length, 96 + capacity * 8 + this.#positions.size * 40 + 48);
    const slots: Entry[] = [], positions = new Map<Entry, number>();
    for (const value of this.#slots) {
      if (value === undefined) continue;
      positions.set(value, slots.length); slots.push(value);
    }
    positions.set(entry, slots.length); slots.push(entry);
    this.#slots = slots; this.#positions = positions;
    this.#usable = capacity - slots.length;
  }

  delete(entry: Entry): boolean {
    this.meter.checkpoint();
    const position = this.#positions.get(entry);
    if (position === undefined) return false;
    this.#slots[position] = undefined;
    this.#positions.delete(entry);
    return true;
  }

  pop(): Entry | undefined {
    this.meter.checkpoint();
    if (this.#positions.size === 0) return undefined;
    let index = this.#slots.length - 1;
    while (index >= 0) {
      this.meter.checkpoint();
      const entry = this.#slots[index];
      if (entry !== undefined) {
        this.#positions.delete(entry);
        this.#slots.length = index;
        return entry;
      }
      index--;
    }
    return undefined;
  }

  clear(): void {
    this.meter.checkpoint(1 + this.#slots.length);
    this.#slots.length = 0; this.#positions.clear(); this.#usable = 0;
  }

  /** No exhaustion latch: the owner keeps the unchanged input position when no
   * entry exists, like a raw dictionary scan rather than a Python iterator. */
  next(position: number): Readonly<{ position: number; entry: Entry }> | undefined {
    this.meter.checkpoint();
    if (!Number.isSafeInteger(position) || position < 0) throw new RangeError("dictionary position must be a nonnegative safe integer");
    for (let index = position; index < this.#slots.length; index++) {
      this.meter.checkpoint();
      const entry = this.#slots[index];
      if (entry !== undefined) {
        this.meter.checkpoint(0, 32);
        return Object.freeze({ position: index + 1, entry });
      }
    }
    return undefined;
  }
}
