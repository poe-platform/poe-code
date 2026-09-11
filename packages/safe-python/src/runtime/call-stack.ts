import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { ExecutionFrame } from "./execution-frame.js";

/** Active guest bodies for one execution context, shared by nested invocations.
 * Suspended objects do not occupy this stack until resumed. maxDepth is an
 * explicit runtime policy, not CPython's process-global recursion limit. It must
 * be chosen conservatively while calls still recurse through host callbacks;
 * a stack-independent invocation trampoline and full heap accounting are pending.
 */
export class CallStack<Frame extends object> {
  readonly #frames: Frame[] = [];
  readonly #active = new Set<ExecutionFrame>();
  #activation: ExecutionFrame | undefined;
  #current: Frame | undefined;

  constructor(readonly maxDepth: number, private readonly meter: ExecutionMeter) {
    if (!Number.isSafeInteger(maxDepth) || maxDepth < 1)
      throw new RangeError("maximum call depth must be a positive safe integer");
  }

  get depth(): number { return this.#frames.length; }
  get current(): Frame | undefined { return this.#current; }

  /** Rejected entry leaves the stack unchanged. Restore in LIFO order; repeated
   * restores are inert. Cleanup is unmetered and runs no guest code, including
   * after fatal limits. Out-of-order restoration is a host integration fault.
   * Suspended bodies set retainCaller=false. Delegated cleanup uses activate=false
   * to enforce depth without making the suspended delegating body a caller.
   */
  enter(frame: Frame, options?: { readonly retainCaller?: boolean; readonly activate?: boolean }): () => void {
    this.meter.checkpoint();
    if (this.#frames.length >= this.maxDepth)
      throw new PythonRuntimeError("RecursionError", "maximum recursion depth exceeded");
    this.#frames.push(frame);
    const previousCurrent = this.#current;
    if (options?.activate !== false) this.#current = frame;
    const previous = this.#activation;
    const activation = options?.activate !== false && frame instanceof ExecutionFrame ? frame : undefined;
    const entered = activation !== undefined && !this.#active.has(activation);
    const retainCaller = options?.retainCaller !== false;
    if (activation !== undefined) {
      if (entered) {
        activation.caller = previous;
        this.#active.add(activation);
      }
      this.#activation = activation;
    }
    const depth = this.#frames.length;
    let open = true;
    return () => {
      if (!open) return;
      if (this.#frames.length !== depth || this.#frames.at(-1) !== frame)
        throw new Error("call frames must be restored in LIFO order");
      this.#frames.pop();
      this.#current = previousCurrent;
      this.#activation = previous;
      if (entered && activation !== undefined) {
        this.#active.delete(activation);
        if (!retainCaller) activation.caller = undefined;
      }
      open = false;
    };
  }
}
