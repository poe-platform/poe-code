import type { State } from "./runtime.js";
import type { InvocationScope } from "./cleanup.js";
import { ArrayFailure, ArrayOwner } from "./arrays/ledger.js";
import { IndexedBinding, textToken } from "./arrays/bindings.js";
import { arrayStore, requireArrays, stateMonitor } from "./arrays/state.js";

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

export async function publishPipelineStatus(
  state: State,
  statuses: readonly number[],
  signal: AbortSignal,
  scope: InvocationScope,
): Promise<void> {
  signal.throwIfAborted();
  scope.assertOpen();
  const target = pipelineStatusTarget(state);
  if (target !== "absent" && target !== "indexed") return;
  const store = requireArrays(state);
  const operation = ArrayOwner.create(store.owner.ledger, store.owner);
  const holding = store.owner.hold();
  let staged: IndexedBinding | undefined;
  let primary = false;
  try {
    const watch = await store.watch(name, operation, signal);
    const supersede = await stateMonitor(state)!.prepareTypedPublication(name, operation, signal);
    const tickets = operation.reserve({ generation: true, version: true, epoch: true, work: 8 });
    const prepared = await store.prepareName(name, operation, signal);
    staged = IndexedBinding.create(store.owner);
    for (let index = 0; index < statuses.length; index++) {
      operation.reserve({ work: 2 });
      const status = statuses[index]!;
      if (!Number.isSafeInteger(status) || status < 0 || status > 255) throw new TypeError("Invalid PIPESTATUS completion");
      const token = await textToken(staged.owner, String(status), signal);
      try { staged.insert(index, token); } catch (error) { token.release(); throw error; }
      await operation.ledger.checkpoint(signal, 2);
    }
    signal.throwIfAborted();
    scope.assertOpen();
    if (pipelineStatusTarget(state) !== target || !watch.valid()) throw new ArrayFailure("stale PIPESTATUS binding");
    let released: Promise<void> | undefined;
    stateMonitor(state)!.publish(tickets, name, () => {
      supersede();
      released = store.publish(name, staged!, tickets, prepared);
    });
    staged = undefined;
    watch.close();
    await released;
  } catch (error) {
    primary = true;
    signal.throwIfAborted();
    throw error;
  } finally {
    try { await staged?.release(); await operation.close(); }
    catch (error) { if (primary) scope.failures.push(error); else throw error; }
    finally { holding.release(); }
  }
}
