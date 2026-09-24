const NativeWeakMap = WeakMap;
const nativeGet = WeakMap.prototype.get;
const nativeSet = WeakMap.prototype.set;
const bind = Function.prototype.call.bind(Function.prototype.bind);
const freeze = Object.freeze;

// Bind once per private table, rather than routing every lookup through a
// generic call adapter. Pin binding too: reentry and rollover can create tables
// after native hooks have changed, and must not expose their receivers.
function createMarkerRegistry(): {
  get(value: object): number | undefined;
  set(value: object, generation: number): unknown;
} {
  const store = new NativeWeakMap<object, number>();
  return { get: bind(nativeGet, store), set: bind(nativeSet, store) };
}

export interface MeasurementSeen {
  has(value: object): boolean;
  add(value: object): void;
}

// Weak keys retain no guest objects. Numeric generations reuse the backing
// table without carrying visited identities into the next fresh measurement.
let shared = createMarkerRegistry();
let generation = 0;
let activeWalks = 0;

export function withMeasurementSeen<T>(measure: (seen: MeasurementSeen) => T): T {
  let registry: ReturnType<typeof createMarkerRegistry>;
  let walk: number;
  if (activeWalks === 0) {
    if (generation === Number.MAX_SAFE_INTEGER) {
      shared = createMarkerRegistry();
      generation = 0;
    }
    registry = shared;
    walk = ++generation;
  } else {
    // A reentrant walk must not overwrite the outer walk's generation marks.
    registry = createMarkerRegistry();
    walk = 1;
  }
  const get = registry.get;
  const set = registry.set;
  const seen: MeasurementSeen = freeze({
    has(value: object): boolean { return get(value) === walk; },
    add(value: object): void {
      // Discard the native set return value; never reveal the private registry.
      set(value, walk);
    }
  });
  activeWalks++;
  try {
    return measure(seen);
  } finally {
    activeWalks--;
  }
}
