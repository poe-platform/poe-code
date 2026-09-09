import type { ExecutionMeter } from "./execution-budget.js";
import { hashReal } from "./real-comparison.js";

/** Opaque execution-local identities, not host addresses. Weak keys do not keep
 * guest objects alive; monotonically allocated IDs are never reused. IDs are
 * aligned and start outside the small-integer cache, so boxing id() results
 * does not accidentally intern them. Share one registry with identity hashing. */
export class ExecutionIdentity {
  readonly #ids: WeakMap<object, bigint>;
  #next: bigint;

  constructor(private readonly meter: ExecutionMeter) {
    meter.checkpoint(1, 64);
    this.#ids = new WeakMap();
    this.#next = 0x100000000n;
  }

  id(value: object): bigint {
    this.meter.checkpoint();
    const existing = this.#ids.get(value);
    if (existing !== undefined) return existing;
    this.meter.checkpoint(0, 96);
    const id = this.#next;
    this.#next += 16n;
    this.#ids.set(value, id);
    return id;
  }

  /** Identity hashing discards alignment bits and uses the numeric hash range.
   * This is stable per execution, with no dependency on the host allocator. */
  hash(value: object): bigint {
    const id = this.id(value);
    this.meter.checkpoint(0, 32);
    return hashReal(id >> 4n)!;
  }
}
