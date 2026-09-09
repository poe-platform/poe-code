import type { ExecutionMeter } from "./execution-budget.js";

/** Access internal exception context slots, bypassing guest attribute overrides.
 * These host metadata operations must not invoke guest code or mutate other links.
 */
export interface ExceptionLinks<Exception extends object> {
  get(error: Exception): Exception | null;
  set(error: Exception, context: Exception | null): void;
}

/** Dynamic handled-exception state for one synchronous execution context.
 * This is separate from the exception being propagated. Suspension/context
 * switching and concrete guest exception storage remain runtime responsibilities.
 */
export class HandledExceptionState<Exception extends object> {
  #active: Exception | null = null;

  get active(): Exception | null { return this.#active; }

  /** Host-only scope entry. Restore in LIFO order; repeated restores are inert.
   * Restoration is unmetered so fatal execution limits cannot strand this state.
   */
  enter(exception: Exception): () => void {
    const previous = this.#active;
    this.#active = exception;
    let open = true;
    return () => {
      if (!open) return;
      open = false;
      this.#active = previous;
    };
  }

  /** Attach implicit context after raise normalization. Preserve explicit cause
   * and suppression. Remove only an edge that would create a new context cycle;
   * tolerate unrelated existing cycles. Floyd traversal uses constant extra space.
   * Fatal limits can leave an already-removed cycle edge changed: no rollback.
   */
  chain(error: Exception, links: ExceptionLinks<Exception>, meter: ExecutionMeter): void {
    meter.checkpoint();
    const active = this.#active;
    if (active === null || active === error) return;
    let current = active, slow = active, updateSlow = false;
    while (true) {
      meter.checkpoint();
      const next = links.get(current);
      if (next === null) break;
      if (next === error) {
        meter.checkpoint();
        links.set(current, null);
        break;
      }
      current = next;
      if (current === slow) break;
      if (updateSlow) { meter.checkpoint(); slow = links.get(slow)!; }
      updateSlow = !updateSlow;
    }
    meter.checkpoint();
    links.set(error, active);
  }
}
