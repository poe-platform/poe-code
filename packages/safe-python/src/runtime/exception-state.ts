import type { ExecutionMeter } from "./execution-budget.js";

/** Access internal exception context slots, bypassing guest attribute overrides.
 * These host metadata operations must not invoke guest code or mutate other links.
 */
export interface ExceptionLinks<Exception extends object> {
  get(error: Exception): Exception | null;
  set(error: Exception, context: Exception | null): void;
}

declare const frameException: unique symbol;
/** Opaque, execution-owned exception slot retained across suspension. */
export interface HandledExceptionFrame<Exception extends object> {
  readonly [frameException]:Exception;
}

interface ExceptionSlot<Exception> { value:Exception|null; active:boolean; }

/** Dynamic handled-exception state, separate from the propagating exception.
 * Each resumable frame retains its own handler, not its caller's inherited
 * handler. Inheritance is refreshed at activation and read in constant time.
 */
export class HandledExceptionState<Exception extends object> {
  #current:{slot:ExceptionSlot<Exception>;inherited:Exception|null}={slot:{value:null,active:true},inherited:null};
  #frames:WeakMap<HandledExceptionFrame<Exception>,ExceptionSlot<Exception>>|undefined;

  get active(): Exception | null { return this.#current.slot.value??this.#current.inherited; }

  createFrame(meter:ExecutionMeter):HandledExceptionFrame<Exception> {
    meter.checkpoint(1,96+(this.#frames===undefined?48:0));
    const frame=Object.freeze({}) as HandledExceptionFrame<Exception>;
    this.#frames??=new WeakMap();this.#frames.set(frame,{value:null,active:false});
    return frame;
  }

  /** Activate saved handler storage with this caller's fallback exception.
   * Deactivation does not clear the saved handler and is unmetered, including
   * after fatal termination. Active records must unwind in LIFO order. */
  activate(frame:HandledExceptionFrame<Exception>,meter:ExecutionMeter):()=>void {
    meter.checkpoint(1,96);
    const slot=this.#frames?.get(frame);
    if(slot===undefined)throw Error("frame belongs to another exception state");
    if(slot.active)throw Error("exception frame is already active");
    const previous=this.#current,current={slot,inherited:this.active};
    slot.active=true;this.#current=current;
    let open=true;
    return ()=>{
      if(!open)return;
      if(this.#current!==current)throw Error("exception frames must restore in LIFO order");
      open=false;slot.active=false;this.#current=previous;
    };
  }

  /** Host-only scope entry. Restore in LIFO order; repeated restores are inert.
   * Restoration is unmetered so fatal execution limits cannot strand this state.
   */
  enter(exception: Exception): () => void {
    const slot=this.#current.slot,previous=slot.value;
    slot.value=exception;
    let open = true;
    return () => {
      if (!open) return;
      if(this.#current.slot!==slot)throw Error("cannot restore an inactive exception frame");
      open = false;
      slot.value=previous;
    };
  }

  /** Attach implicit context after raise normalization. Preserve explicit cause
   * and suppression. Remove only an edge that would create a new context cycle;
   * tolerate unrelated existing cycles. Floyd traversal uses constant extra space.
   * Fatal limits can leave an already-removed cycle edge changed: no rollback.
   */
  chain(error: Exception, links: ExceptionLinks<Exception>, meter: ExecutionMeter): void {
    meter.checkpoint();
    const active = this.active;
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
