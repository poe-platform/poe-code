import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

/** Active guest bodies for one execution context, shared by nested invocations.
 * Suspended objects do not occupy this stack until resumed. maxDepth is an
 * explicit runtime policy, not CPython's process-global recursion limit. It must
 * be chosen conservatively while calls still recurse through host callbacks;
 * a stack-independent invocation trampoline and full heap accounting are pending.
 */
export class CallStack<Frame extends object> {
  readonly #frames: Frame[] = [];

  constructor(readonly maxDepth: number, private readonly meter: ExecutionMeter) {
    if (!Number.isSafeInteger(maxDepth) || maxDepth < 1)
      throw new RangeError("maximum call depth must be a positive safe integer");
  }

  get depth(): number { return this.#frames.length; }
  get current(): Frame | undefined { return this.#frames.at(-1); }

  /** Rejected entry leaves the stack unchanged. Restore in LIFO order; repeated
   * restores are inert. Cleanup is unmetered and runs no guest code, including
   * after fatal limits. Out-of-order restoration is a host integration fault.
   */
  enter(frame: Frame): () => void {
    this.meter.checkpoint();
    if (this.#frames.length >= this.maxDepth)
      throw new PythonRuntimeError("RecursionError", "maximum recursion depth exceeded");
    this.#frames.push(frame);
    const depth = this.#frames.length;
    let open = true;
    return () => {
      if (!open) return;
      if (this.#frames.length !== depth || this.current !== frame)
        throw new Error("call frames must be restored in LIFO order");
      this.#frames.pop();
      open = false;
    };
  }
}
