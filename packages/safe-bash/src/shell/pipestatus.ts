import type { State } from "./runtime.js";
import { throwCleanupFailures, type InvocationScope } from "./cleanup.js";
import { ArrayFailure, ArrayOwner } from "./arrays/ledger.js";
import { IndexedBinding, textToken } from "./arrays/bindings.js";
import { arrayStore, stateMonitor } from "./arrays/state.js";

const name = "PIPESTATUS";

export type PipelineStatusTarget = "indexed" | "scalar" | "readonly-absent" | "local-tombstone" | "exported-absent" | "absent";

export function pipelineStatusTarget(state: State): PipelineStatusTarget {
  if (arrayStore(state)?.get(name)) return "indexed";
  if (Object.hasOwn(state.variables, name)) return "scalar";
  if (state.readonlyVariables?.has(name)) return "readonly-absent";
  for (let index = state.locals.length - 1; index >= 0; index--) {
    if (state.locals[index]!.has(name)) return "local-tombstone";
  }
  if (state.exported.has(name)) return "exported-absent";
  return "absent";
}

export function publishPipelineStatus(
  state: State,
  statuses: readonly number[],
  signal: AbortSignal,
  scope: InvocationScope,
): Promise<void> | void {
  signal.throwIfAborted();
  scope.assertOpen();
  const target = pipelineStatusTarget(state);
  if (target !== "absent" && target !== "indexed") return;
  const monitor = stateMonitor(state)!;
  if (target === "indexed" && statuses.length === 1) {
    const status = statuses[0]!;
    if (!Number.isSafeInteger(status) || status < 0 || status > 255) throw new TypeError("Invalid PIPESTATUS completion");
    const store = monitor.store;
    const existing = store?.get(name);
    if (
      store &&
      existing &&
      !existing.associative &&
      existing.references === 1 &&
      existing.values.size === 1 &&
      existing.maximum === 0 &&
      !store.watches.has(name) &&
      !monitor.hasOverlay(name) &&
      existing.get(0) === (status === 0 ? "0" : String(status))
    ) {
      const owner = monitor.internalOwner();
      const tickets = owner.charge({ generation: true, version: true, epoch: true, work: 8 });
      monitor.publish(tickets, name, () => {
        store.revise(name, existing, tickets);
      });
      return;
    }
  }
  return publishPipelineStatusSlow(state, target, monitor, statuses, signal, scope);
}

async function publishPipelineStatusSlow(
  state: State,
  target: PipelineStatusTarget,
  monitor: NonNullable<ReturnType<typeof stateMonitor>>,
  statuses: readonly number[],
  signal: AbortSignal,
  scope: InvocationScope,
): Promise<void> {
  const store = monitor.activate(true);
  const owner = monitor.internalOwner();
  const epoch = monitor.epoch;
  const operation = ArrayOwner.create(owner.ledger, owner);
  const holding = owner.hold();
  let staged: IndexedBinding | undefined;
  let primary = false;
  let failure: unknown;
  try {
    const watch = await store.watch(name, operation, signal, owner);
    const supersede = await stateMonitor(state)!.prepareTypedPublication(name, operation, signal);
    const tickets = operation.reserve({ generation: true, version: true, epoch: true, work: 8 });
    const prepared = await store.prepareName(name, operation, signal);
    staged = IndexedBinding.create(owner);
    for (let index = 0; index < statuses.length; index++) {
      operation.reserve({ work: 2 });
      const status = statuses[index]!;
      if (!Number.isSafeInteger(status) || status < 0 || status > 255) throw new TypeError("Invalid PIPESTATUS completion");
      const token = await textToken(staged.owner, String(status), signal);
      try { staged.insert(index, token); } catch (error) { token.release(); throw error; }
      const pending = operation.ledger.checkpoint(signal, 2);
      if (pending) await pending;
    }
    signal.throwIfAborted();
    scope.assertOpen();
    if (pipelineStatusTarget(state) !== target || monitor.epoch !== epoch || !watch.valid()) throw new ArrayFailure("stale PIPESTATUS binding");
    let released: Promise<void> | undefined;
    stateMonitor(state)!.publish(tickets, name, () => {
      supersede();
      released = store.publish(name, staged!, tickets, prepared, false, owner);
    });
    staged = undefined;
    watch.close();
    await released;
  } catch (error) {
    primary = true;
    failure = error;
  }
  await scope.cleanup(() => staged?.release());
  await scope.cleanup(() => operation.close());
  await scope.cleanup(() => holding.release());
  signal.throwIfAborted();
  if (primary) throw failure;
  throwCleanupFailures(scope.failures);
}
