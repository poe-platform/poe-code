import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";

/** Active container identities, not all objects ever visited. Depth is an
 * explicit execution policy, independent of CPython's process/C-stack limits;
 * callers must choose a conservative bound while repr uses host callbacks.
 * Keep one stack per representation execution and share it with nested slots.
 */
export class RepresentationStack<Value> {
  readonly #active: Set<Value>;
  readonly #frames: Value[];

  constructor(readonly maxDepth: number, private readonly meter: ExecutionMeter) {
    if (!Number.isSafeInteger(maxDepth) || maxDepth < 1) throw new RangeError("maximum representation depth must be a positive safe integer");
    meter.checkpoint(1, 128);
    this.#active = new Set();
    this.#frames = [];
  }

  /** Undefined means an active-path cycle: the caller emits its type-specific
   * marker. Successful entries must be restored in finally. Cleanup runs no
   * guest code and remains available after a permanently fatal budget failure.
   */
  enter(value: Value): (() => void) | undefined {
    this.meter.checkpoint();
    if (this.#active.has(value)) return undefined;
    if (this.#frames.length >= this.maxDepth) throw new PythonRuntimeError("RecursionError", "maximum recursion depth exceeded while getting the repr of an object");
    // Set entry, growable frame reference, and the returned cleanup closure.
    this.meter.checkpoint(1, 128);
    this.#frames.push(value);
    this.#active.add(value);
    const depth = this.#frames.length;
    let open = true;
    return () => {
      if (!open) return;
      if (this.#frames.length !== depth || !Object.is(this.#frames.at(-1), value)) throw new Error("representation entries must be restored in LIFO order");
      this.#frames.pop();
      this.#active.delete(value);
      open = false;
    };
  }
}
