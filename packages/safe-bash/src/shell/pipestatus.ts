import type { State } from "./runtime.js";
import { throwCleanupFailures, type InvocationScope } from "./cleanup.js";
import { ArrayFailure, ArrayOwner } from "./arrays/ledger.js";
import { IndexedBinding, OwnedText, textToken } from "./arrays/bindings.js";
import { stateMonitor } from "./arrays/state.js";

const name = "PIPESTATUS";
const pipeStatusFastCharge = { generation: true, version: true, epoch: true, work: 8 } as const;
const pipeStatusTickets = { generation: 0, version: 0, epoch: 0 };

export type PipelineStatusTarget = "indexed" | "scalar" | "readonly-absent" | "local-tombstone" | "exported-absent" | "absent";

export function pipelineStatusTarget(state: State): PipelineStatusTarget {
  const monitor = stateMonitor(state);
  if (monitor?.lazyPipeStatus !== undefined || monitor?.store?.get(name)) return "indexed";
  const raw = monitor ? monitor.raw : state;
  if (Object.hasOwn(raw.variables, name)) return "scalar";
  if (raw.readonlyVariables?.has(name)) return "readonly-absent";
  const rawLocals = (raw as { _locals?: Map<string, unknown>[] })._locals ?? ("_locals" in raw ? undefined : raw.locals);
  if (rawLocals) {
    for (let index = rawLocals.length - 1; index >= 0; index--) {
      if (rawLocals[index]!.has(name)) return "local-tombstone";
    }
  }
  const rawExported = (raw as { _exported?: Set<string> })._exported ?? ("_exported" in raw ? undefined : raw.exported);
  if (rawExported ? rawExported.has(name) : false) return "exported-absent";
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
  if (!monitor.store && !monitor.hasOverlay(name)) {
    for (let i = 0; i < statuses.length; i++) {
      const s = statuses[i]!;
      if (!Number.isSafeInteger(s) || s < 0 || s > 255) throw new TypeError("Invalid PIPESTATUS completion");
    }
    const tickets = monitor.chargeLazyPipeStatus(signal, pipeStatusFastCharge, pipeStatusTickets);
    if (tickets) {
      monitor.epoch = tickets.epoch;
      monitor.lazyPipeStatus = statuses;
      return;
    }
  }
  if (!monitor.store?.watches.has(name) && !monitor.hasOverlay(name)) {
    for (let i = 0; i < statuses.length; i++) {
      const s = statuses[i]!;
      if (!Number.isSafeInteger(s) || s < 0 || s > 255) throw new TypeError("Invalid PIPESTATUS completion");
    }
    if (target === "indexed") {
      const store = monitor.store;
      const existing = store?.get(name);
      const owner = monitor.internalOwner();
      if (store && existing && !existing.associative && !owner.ledger.checkpoint(signal, 0)) {
        if (existing.values.size === statuses.length && existing.maximum === statuses.length - 1) {
          let canMutateInPlace = true;
          for (let i = 0; i < statuses.length; i++) {
            const s = statuses[i]!;
            const statusStr = s === 0 ? "0" : s === 1 ? "1" : String(s);
            const elem = existing.values.get(i);
            if (
              !elem ||
              (elem.text.shellValue !== statusStr &&
                (existing.references !== 1 || elem.text.references !== 1 || elem.text.bytes !== statusStr.length))
            ) {
              canMutateInPlace = false;
              break;
            }
          }
          if (canMutateInPlace) {
            for (let i = 0; i < statuses.length; i++) {
              const s = statuses[i]!;
              existing.values.get(i)!.text.shellValue = s === 0 ? "0" : s === 1 ? "1" : String(s);
            }
            const tickets = owner.charge(pipeStatusFastCharge, pipeStatusTickets);
            monitor.epoch = tickets.epoch;
            store.changed(tickets, name);
            return;
          }
        }
        if (existing.references === 1 && statuses.length <= 16) {
          for (const key of existing.values.keys()) {
            if (key >= statuses.length) existing.remove(key);
          }
          existing.maximum = statuses.length - 1;
          for (let i = 0; i < statuses.length; i++) {
            const s = statuses[i]!;
            const statusStr = s === 0 ? "0" : s === 1 ? "1" : String(s);
            const elem = existing.values.get(i);
            if (elem && elem.text.references === 1 && elem.text.bytes === statusStr.length) {
              elem.text.shellValue = statusStr;
            } else {
              existing.owner.chargeWork(statusStr.length);
              const token = new OwnedText(statusStr, statusStr.length, existing.owner.reserve({ payload: statusStr.length, metadata: 32, work: 4 }));
              try { existing.insert(i, token); }
              catch (error) { token.release(); throw error; }
            }
          }
          const tickets = owner.charge(pipeStatusFastCharge, pipeStatusTickets);
          monitor.epoch = tickets.epoch;
          store.changed(tickets, name);
          return;
        }
      }
    } else if (target === "absent") {
      const store = monitor.activate(true);
      const owner = monitor.internalOwner();
      if (!store.watches.has(name) && !owner.ledger.checkpoint(signal, 0)) {
        const tickets = owner.reserve({ generation: true, version: true, epoch: true, work: 8 + statuses.length * 2 });
        const prepared = store.prepareExistingName(name, 10, owner, signal);
        const staged = IndexedBinding.create(owner);
        try {
          for (let i = 0; i < statuses.length; i++) {
            const s = statuses[i]!;
            const statusStr = s === 0 ? "0" : s === 1 ? "1" : String(s);
            staged.owner.chargeWork(statusStr.length);
            const token = new OwnedText(statusStr, statusStr.length, staged.owner.reserve({ payload: statusStr.length, metadata: 32, work: 4 }));
            try { staged.insert(i, token); }
            catch (error) { token.release(); throw error; }
          }
          monitor.publish(tickets, name, () => {
            void store.publish(name, staged, tickets, prepared, false, owner);
          });
          return;
        } catch (error) {
          void staged.release();
          prepared?.admission.release();
          prepared?.name.release();
          tickets.release();
          throw error;
        }
      }
    }
  }
  if (target === "indexed" && statuses.length === 1) {
    const status = statuses[0]!;
    if (!Number.isSafeInteger(status) || status < 0 || status > 255) throw new TypeError("Invalid PIPESTATUS completion");
    const store = monitor.store;
    const existing = store?.get(name);
    if (
      store &&
      existing &&
      !existing.associative &&
      existing.values.size === 1 &&
      existing.maximum === 0 &&
      !store.watches.has(name) &&
      !monitor.hasOverlay(name)
    ) {
      const statusStr = status === 0 ? "0" : status === 1 ? "1" : String(status);
      const elem0 = existing.values.get(0);
      if (
        elem0 &&
        (elem0.text.shellValue === statusStr ||
          (existing.references === 1 && elem0.text.references === 1 && elem0.text.bytes === statusStr.length))
      ) {
        elem0.text.shellValue = statusStr;
        const owner = monitor.internalOwner();
        const tickets = owner.charge(pipeStatusFastCharge, pipeStatusTickets);
        monitor.epoch = tickets.epoch;
        store.changed(tickets, name);
        return;
      }
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
