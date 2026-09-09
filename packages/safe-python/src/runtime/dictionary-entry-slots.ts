import { exhaustAllocation, type ExecutionMeter } from "./execution-budget.js";

/** Positional entries for incrementally built combined dictionaries.
 * Entry objects have stable identity; key matching and payload updates belong to
 * the hash-storage owner. Deletion leaves holes, insertion exhaustion compacts,
 * and pop truncates without refunding usable capacity. Cursors retain numeric
 * positions across every mutation, including clear and compaction.
 * Exact-string layouts convert to general entries when appending a missing
 * non-exact-string key (CPython 3.14.7). Overwrites do not change layout.
 * Optional presizing selects the initial combined layout and reserves insertion
 * slots. Split/shared-key layouts and bulk merge/copy policies are not modeled
 * here yet. Not a set table or guest iterator.
 */
export class DictionaryEntrySlots<Entry extends object> {
  #slots: (Entry | undefined)[];
  #positions: Map<Entry, number>;
  #usable = 0;
  #unicode: boolean | undefined;

  /** Construction hint, not a guarantee: tiny hints use the normal empty table;
   * large hints cap at 2**17 hash slots, following CPython dict_new_presized.
   * The bulk-construction owner determines whether all keys are exact strings.
   */
  constructor(private readonly meter: ExecutionMeter, minimumEntries = 0, exactStrings = false) {
    if (!Number.isSafeInteger(minimumEntries) || minimumEntries < 0) throw new RangeError("minimum dictionary entries must be a nonnegative safe integer");
    let capacity = 0;
    if (minimumEntries > 5) {
      const target = Math.min(minimumEntries, 87381);
      let size = 8;
      while (Math.floor(size * 2 / 3) < target) { meter.checkpoint(); size *= 2; }
      capacity = Math.floor(size * 2 / 3);
    }
    meter.checkpoint(1, 96 + capacity * 8);
    this.#slots = []; this.#positions = new Map();
    this.#usable = capacity;
    this.#unicode = capacity === 0 ? undefined : exactStrings;
    Object.freeze(this);
  }

  append(entry: Entry, exactString = false): void {
    this.meter.checkpoint();
    if (this.#positions.has(entry)) throw new Error("entry is already present");
    if (this.#usable !== 0 && !(this.#unicode === true && !exactString)) {
      this.meter.checkpoint(1, 48);
      this.#positions.set(entry, this.#slots.length);
      this.#slots.push(entry); this.#usable--;
      return;
    }
    this.#rebuild(this.#unicode === false ? false : exactString, entry);
  }

  #rebuild(unicode: boolean, appended: Entry): void {
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
    positions.set(appended, slots.length); slots.push(appended);
    this.#slots = slots; this.#positions = positions;
    this.#usable = capacity - slots.length;
    this.#unicode = unicode;
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
    this.#slots.length = 0; this.#positions.clear(); this.#usable = 0; this.#unicode = undefined;
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
