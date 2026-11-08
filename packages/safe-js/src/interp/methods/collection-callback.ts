import type { Budget } from "../budget.js";
import { enterRunningState } from "../running-state.js";
import type { SandboxValue } from "../values.js";

type CallbackCursor = {
  budget: Budget;
  pending: Set<SandboxValue>;
};

const activeCallbacks = new WeakMap<
  object,
  { cursors: Set<CallbackCursor>; leaveRunning: () => void }
>();

export function enterKeyedCollectionCallback(
  target: object,
  keys: Iterable<SandboxValue>,
  budget: Budget
): { next(): IteratorResult<SandboxValue>; leave(): void } {
  let state = activeCallbacks.get(target);
  if (state === undefined) {
    state = { cursors: new Set(), leaveRunning: enterRunningState(target) };
    activeCallbacks.set(target, state);
  }
  const cursor: CallbackCursor = { budget, pending: new Set() };
  state.cursors.add(cursor);
  const leave = () => {
    if (!state.cursors.delete(cursor)) return;
    cursor.pending.clear();
    budget.setRetainedDataUsage(cursor, 0);
    budget.setRetainedValues(cursor, undefined);
    if (state.cursors.size === 0) {
      activeCallbacks.delete(target);
      state.leaveRunning();
    }
  };
  try {
    budget.setRetainedDataUsage(cursor, 1);
    budget.setRetainedValues(cursor, () => cursor.pending);
    for (const key of keys) updatePendingKeys(cursor, "add", key);
  } catch (error) {
    leave();
    throw error;
  }
  return {
    next: () => {
      budget.visitNode();
      for (const key of cursor.pending) {
        cursor.pending.delete(key);
        budget.setRetainedDataUsage(cursor, 1 + cursor.pending.size);
        return { done: false, value: key };
      }
      return { done: true, value: undefined };
    },
    leave
  };
}

export function updateKeyedCollectionCallbacks(
  target: object,
  mutation: "add" | "delete" | "clear",
  key?: SandboxValue
): void {
  const state = activeCallbacks.get(target);
  if (state === undefined) return;
  for (const cursor of state.cursors) updatePendingKeys(cursor, mutation, key);
}

function updatePendingKeys(
  cursor: CallbackCursor,
  mutation: "add" | "delete" | "clear",
  key: SandboxValue
): void {
  const { budget, pending } = cursor;
  budget.visitNode();
  if (mutation === "add") {
    const nextSize = pending.has(key) ? pending.size : pending.size + 1;
    budget.allocateCollectionEntries(nextSize);
    budget.setRetainedDataUsage(cursor, 1 + nextSize);
    pending.add(key);
  } else {
    if (mutation === "delete") pending.delete(key);
    else pending.clear();
    budget.setRetainedDataUsage(cursor, 1 + pending.size);
  }
}
