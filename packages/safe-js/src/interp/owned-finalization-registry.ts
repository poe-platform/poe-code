import type { Budget } from "./budget.js";
import { invokeBuiltinClosure } from "./builtin-call.js";
import { isCapturedException } from "./exceptions.js";
import { FinalizationRegistryState } from "./finalization-registry-state.js";
import { captureJobScheduler } from "./jobs.js";
import { retainValues, runResources } from "./resources.js";
import type { SandboxCallContext, SandboxClosure } from "./values.js";

export type FinalizationActivation = {phase:"pending" | "active" | "cancelled"; pending:Array<() => void>; rollback:Array<() => void>};

export function createOwnedFinalizationRegistryState(callback: SandboxClosure, budget: Budget, context?: SandboxCallContext,
  activation?: FinalizationActivation): FinalizationRegistryState {
  const owner = runResources.getStore();
  if (owner?.reportError === undefined) throw new TypeError("Finalization requires an execution owner with error reporting.");
  const reportError = owner.reportError;
  const schedule = captureJobScheduler();
  const state = new FinalizationRegistryState(async heldValue => {
    const keep = retainValues(budget, () => [callback,heldValue]);
    try { await invokeBuiltinClosure(callback,[heldValue],budget,context,undefined); }
    finally { keep(); }
  }, (job,cell) => {
    if (owner.signal.aborted || activation?.phase === "cancelled") return;
    // Queues and pending restore activations can outlive cancellation. Keep
    // their guest work in a clearable slot, not directly in queued closures.
    const pending: { job?: () => Promise<void>; callback?: SandboxClosure } = { job, callback };
    let keep: (() => void) | undefined;
    cell.release = () => {
      pending.job = undefined;
      pending.callback = undefined;
      keep?.();
      keep = undefined;
    };
    const dispatch = () => {
      if (owner.signal.aborted || activation?.phase === "cancelled" || pending.job === undefined) return;
      keep = retainValues(budget, () => [pending.callback,cell.heldValue]);
      void schedule(async () => { if (!owner.signal.aborted) await pending.job?.(); })
        .catch(error => reportError(isCapturedException(error) ? error.reason : error)).finally(() => {
          cell.release?.();
          cell.release = undefined;
        });
    };
    if (activation?.phase === "pending") activation.pending.push(dispatch);
    else dispatch();
  });
  const weakState = new WeakRef(state);
  const cleanupCharge = {};
  budget.setRetainedDataUsage(cleanupCharge,1);
  let detach: (() => void) | void;
  const dispose = () => {
    weakState.deref()?.dispose();
    budget.setRetainedDataUsage(cleanupCharge,0);
    detach?.();
  };
  try {
    detach = owner.add(async () => { dispose(); });
    activation?.rollback.push(dispose);
  } catch (error) {
    dispose();
    throw error;
  }
  return state;
}
