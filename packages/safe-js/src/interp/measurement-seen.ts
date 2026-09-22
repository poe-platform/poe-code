const NativeWeakMap = WeakMap;
const get = WeakMap.prototype.get;
const set = WeakMap.prototype.set;
const apply = Reflect.apply;

export interface MeasurementSeen {
  has(value: object): boolean;
  add(value: object): void;
}

// Weak keys retain no guest objects. Numeric generations reuse the backing
// table without carrying visited identities into the next fresh measurement.
let shared = new NativeWeakMap<object, number>();
let generation = 0;
let activeWalks = 0;

class VisitedObjects implements MeasurementSeen {
  readonly #store: WeakMap<object, number>;
  readonly #generation: number;

  constructor(store: WeakMap<object, number>, generation: number) {
    this.#store = store;
    this.#generation = generation;
  }

  has(value: object): boolean {
    return apply(get, this.#store, [value]) === this.#generation;
  }

  add(value: object): void {
    // Discard the native set return value; never reveal the private registry.
    apply(set, this.#store, [value, this.#generation]);
  }
}
Object.freeze(VisitedObjects.prototype);

export function withMeasurementSeen<T>(measure: (seen: MeasurementSeen) => T): T {
  let seen: MeasurementSeen;
  if (activeWalks === 0) {
    if (generation === Number.MAX_SAFE_INTEGER) {
      shared = new NativeWeakMap<object, number>();
      generation = 0;
    }
    seen = new VisitedObjects(shared, ++generation);
  } else {
    // A reentrant walk must not overwrite the outer walk's generation marks.
    seen = new VisitedObjects(new NativeWeakMap<object, number>(), 1);
  }
  activeWalks++;
  try {
    return measure(seen);
  } finally {
    activeWalks--;
  }
}
