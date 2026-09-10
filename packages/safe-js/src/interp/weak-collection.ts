import type { SandboxObject, SandboxValue } from "./values.js";
import { wellKnownSymbols } from "./symbols.js";
import { createWeakReferenceState } from "./weak-reference.js";

export type WeakCollectionKey = object | symbol;
type WeakKeyReference = { deref(): WeakCollectionKey | undefined };
type WeakEntry = { value: SandboxValue; reference: WeakKeyReference };
// Keep modern weak-key typing local: Node 18 still requires a symbol-lifetime
// implementation before the guest API can support symbols portably.
interface WeakEntries {
  get(key: WeakCollectionKey): WeakEntry | undefined;
  has(key: WeakCollectionKey): boolean;
  set(key: WeakCollectionKey, entry: WeakEntry): unknown;
  delete(key: WeakCollectionKey): boolean;
}

// Fixed, permanently reachable intrinsic keys can use object identities even
// on hosts that cannot weakly hold symbols. Arbitrary symbols are not retained.
const intrinsicKeys = new Map(Object.values(wellKnownSymbols).map(symbol => [symbol, Object.freeze({})]));
function storageKey(key: WeakCollectionKey): object {
  // The cast bridges older TypeScript weak-key declarations; unique symbols
  // still go directly to the host and require native weak-symbol support.
  return (typeof key === "symbol" ? intrinsicKeys.get(key) ?? key : key) as object;
}

class WeakCollectionEntries extends WeakMap<object, WeakEntry> {
  override get(key: WeakCollectionKey): WeakEntry | undefined { return super.get(storageKey(key)); }
  override has(key: WeakCollectionKey): boolean { return super.has(storageKey(key)); }
  override set(key: WeakCollectionKey, value: WeakEntry): this { return super.set(storageKey(key), value); }
  override delete(key: WeakCollectionKey): boolean { return super.delete(storageKey(key)); }
}
export const weakCollectionStates = new WeakMap<object, {
  kind: "map" | "set";
  entries: WeakEntries;
  references: Set<WeakKeyReference>;
  cleanup: FinalizationRegistry<WeakKeyReference>;
}>();

export function createWeakCollection(kind: "map" | "set"): SandboxObject {
  const value = Object.create(null) as SandboxObject;
  const references = new Set<WeakKeyReference>();
  const cleanup = new FinalizationRegistry<WeakKeyReference>(reference => references.delete(reference));
  weakCollectionStates.set(value, { kind, entries: new WeakCollectionEntries(), references, cleanup });
  return value;
}

export function setWeakEntry(collection: object, key: WeakCollectionKey, value: SandboxValue): void {
  const state = weakCollectionStates.get(collection);
  if (state === undefined) throw new TypeError("Incompatible weak collection receiver.");
  const entry = state.entries.get(key);
  if (entry !== undefined) entry.value = value;
  else {
    const reference = createWeakReferenceState(key as Extract<SandboxValue, object | symbol>);
    state.entries.set(key, { value, reference });
    state.references.add(reference);
    if (typeof key !== "symbol" || !intrinsicKeys.has(key))
      Reflect.apply(state.cleanup.register, state.cleanup, [key, reference, reference]);
  }
}

export function deleteWeakEntry(collection: object, key: WeakCollectionKey): boolean {
  const state = weakCollectionStates.get(collection);
  if (state === undefined) throw new TypeError("Incompatible weak collection receiver.");
  const entry = state.entries.get(key);
  if (entry === undefined) return false;
  state.references.delete(entry.reference);
  state.cleanup.unregister(entry.reference);
  return state.entries.delete(key);
}
