const NativeWeakMap = WeakMap;
// Pin direct calls once; fresh argument arrays would otherwise be allocated
// for both registry operations on every visited object.
const get = Function.prototype.call.bind(WeakMap.prototype.get) as
  (store: WeakMap<object, number>, value: object) => number | undefined;
const set = Function.prototype.call.bind(WeakMap.prototype.set) as
  (store: WeakMap<object, number>, value: object, generation: number) => unknown;

export interface MeasurementSeen {
  has(value: object): boolean;
  add(value: object): void;
}

// Weak keys retain no guest objects. Numeric generations reuse the backing
// table without carrying visited identities into the next fresh measurement.
let shared = new NativeWeakMap<object, number>();
let generation = 0;
let activeWalks = 0;
let activeSharedWalk: VisitedObjects | undefined;

class VisitedObjects implements MeasurementSeen {
  readonly #store: WeakMap<object, number>;
  readonly #generation: number;
  #active = true;
  #first?: object;
  #second?: object;
  #third?: object;
  #fourth?: object;

  constructor(store: WeakMap<object, number>, generation: number) {
    this.#store = store;
    this.#generation = generation;
  }

  has(value: object): boolean {
    // A saved collector can still read its old walk after completion. Only
    // active walks memoize positive hits, and no misses are ever cached.
    if (!this.#active) return get(this.#store, value) === this.#generation;
    if (value !== undefined && (value === this.#first || value === this.#second ||
        value === this.#third || value === this.#fourth)) return true;
    if (get(this.#store, value) !== this.#generation) return false;
    this.#fourth = this.#third;
    this.#third = this.#second;
    this.#second = this.#first;
    this.#first = value;
    return true;
  }

  add(value: object): void {
    // Old native handles can still write their generation into the shared map.
    // Invalidate the active cache only on that uncommon path, including when
    // the write arrives from a nested measurement with its own private map.
    if (!this.#active && activeSharedWalk !== undefined && activeSharedWalk.#store === this.#store)
      activeSharedWalk.#clear();
    // Discard the native set return value; never reveal the private registry.
    set(this.#store, value, this.#generation);
  }

  #clear(): void {
    this.#first = undefined;
    this.#second = undefined;
    this.#third = undefined;
    this.#fourth = undefined;
  }

  static release(seen: VisitedObjects): void {
    seen.#active = false;
    seen.#clear();
  }
}
Object.freeze(VisitedObjects.prototype);
// Pin cleanup so caller-owned properties and later constructor hooks cannot
// intercept it or keep the bounded per-walk cache's guest references alive.
const releaseVisitedObjects = VisitedObjects.release;

export function withMeasurementSeen<T>(measure: (seen: MeasurementSeen) => T): T {
  let seen: VisitedObjects;
  if (activeWalks === 0) {
    if (generation === Number.MAX_SAFE_INTEGER) {
      shared = new NativeWeakMap<object, number>();
      generation = 0;
    }
    seen = new VisitedObjects(shared, ++generation);
    activeSharedWalk = seen;
  } else {
    // A reentrant walk must not overwrite the outer walk's generation marks.
    seen = new VisitedObjects(new NativeWeakMap<object, number>(), 1);
  }
  activeWalks++;
  try {
    return measure(seen);
  } finally {
    releaseVisitedObjects(seen);
    activeWalks--;
    if (activeWalks === 0) activeSharedWalk = undefined;
  }
}
