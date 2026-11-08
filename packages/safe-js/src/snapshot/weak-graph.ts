import { weakReferenceStates } from "../interp/weak-reference.js";
import { finalizationRegistryStates } from "../interp/finalization-registry-state.js";
import { wellKnownSymbols } from "../interp/symbols.js";
import { weakCollectionStates, type WeakCollectionKey } from "../interp/weak-collection.js";

// Weak-map values become strong only after their key is reached. Drain the queue
// to a fixed point before deciding which WeakRef and registry edges survive.
export function createWeakSnapshotGraph(
  hasObject: (value: object) => boolean,
  forceHeap: (value: object) => void,
  collect: (value: unknown, depth: number, reached: (value: WeakCollectionKey, depth: number) => void) => void
) {
  const weakEntries = new Map<object, Array<[WeakCollectionKey, unknown]>>();
  const seenSymbols = new Set<symbol>();
  type Contribution = { owner: object; key: WeakCollectionKey; value: unknown; depth: number };
  const waiting = new Map<WeakCollectionKey, Contribution[]>();
  const ready: Contribution[] = [];
  const reached = (value: WeakCollectionKey, depth: number) => {
    if (typeof value === "symbol") {
      if (seenSymbols.has(value)) return;
      seenSymbols.add(value);
    }
    const unlocked = waiting.get(value);
    if (unlocked !== undefined) {
      for (const contribution of unlocked) ready.push(contribution);
      waiting.delete(value);
    }
    if (typeof value === "symbol") return;
    const weakState = weakCollectionStates.get(value);
    if (weakState === undefined) return;
    weakEntries.set(value, []);
    for (const reference of weakState.references) {
      const key = reference.deref();
      if (key === undefined) continue;
      const entry = weakState.entries.get(key);
      if (entry === undefined) continue;
      const contribution = { owner: value, key, value: weakState.kind === "map" ? entry.value : undefined, depth: depth + 1 };
      if (typeof key === "symbol" ? seenSymbols.has(key) || Object.values(wellKnownSymbols).includes(key) : hasObject(key)) ready.push(contribution);
      else {
        const pending = waiting.get(key);
        if (pending === undefined) waiting.set(key, [contribution]);
        else pending.push(contribution);
      }
    }
  };

  return { reached, finish(guestValues: Iterable<object>) {
      for (let index = 0; index < ready.length; index++) {
        const contribution = ready[index]!;
        weakEntries.get(contribution.owner)!.push([contribution.key, contribution.value]);
        if (typeof contribution.key === "object") forceHeap(contribution.key);
        collect(contribution.value, contribution.depth, reached);
        if (contribution.value !== null && typeof contribution.value === "object") {
          if (hasObject(contribution.value)) forceHeap(contribution.value);
        }
      }
      const weakTargets = new Map<object, object | symbol>();
      const finalizationTargets = new Map<object, Array<{target?:object | symbol;token?:object | symbol}>>();
      const reachableWeakTarget = (target: object | symbol | undefined): object | symbol | undefined => {
        if (typeof target === "symbol") return seenSymbols.has(target) || Object.values(wellKnownSymbols).includes(target) ? target : undefined;
        if (target === undefined || !hasObject(target)) return undefined;
        forceHeap(target);
        return target;
      };
      for (const value of guestValues) {
        const target = reachableWeakTarget(weakReferenceStates.get(value)?.deref());
        if (target !== undefined) weakTargets.set(value,target);
        const finalization = finalizationRegistryStates.get(value);
        if (finalization !== undefined) finalizationTargets.set(value,[...finalization.state.cells].map(cell => ({
          target:reachableWeakTarget(cell.target.deref()),token:reachableWeakTarget(cell.token?.deref())
        })));
      }
    return { weakEntries, weakTargets, finalizationTargets };
  } };
}
