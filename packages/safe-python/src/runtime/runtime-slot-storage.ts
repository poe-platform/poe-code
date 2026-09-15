import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValue } from "./runtime-values.js";

/** Fixed positional storage, independent of the instance dictionary. Allocate
 * lazily on the first write; compatible __class__ changes retain slot positions. */
export class RuntimeSlotStorage {
  #items?: (RuntimeValue | undefined)[];
  constructor(private readonly count: number, private readonly meter: ExecutionMeter) {
    meter.checkpoint(1, 32); Object.freeze(this);
  }
  get(index: number): RuntimeValue | undefined {
    this.meter.checkpoint();
    if (!Number.isInteger(index) || index < 0 || index >= this.count) throw Error("invalid instance slot position");
    return this.#items?.[index];
  }
  set(index: number, value: RuntimeValue | undefined): void {
    this.get(index);
    if (this.#items === undefined) {
      if (value === undefined) return;
      this.meter.checkpoint(0, 32 + 8 * this.count); this.#items = new Array(this.count);
    }
    this.#items[index] = value;
  }
}
