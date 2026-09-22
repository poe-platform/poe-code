// Private scope cells must never pass through replaceable host collection hooks.
// Capture operations before callers can replace native prototypes. In particular,
// do not return native iterators whose next methods could expose stored cells.
const NativeMap = Map;
const NativeSet = Set;
const apply = Reflect.apply;
const mapGet = Map.prototype.get;
const mapSet = Map.prototype.set;
const mapHas = Map.prototype.has;
const mapDelete = Map.prototype.delete;
const mapEntries = Map.prototype.entries;
const mapValues = Map.prototype.values;
const mapSize = Object.getOwnPropertyDescriptor(Map.prototype, "size")!.get!;
const mapNext = Object.getPrototypeOf(new Map().values()).next;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;
const setDelete = Set.prototype.delete;
const setValues = Set.prototype.values;
const setNext = Object.getPrototypeOf(new Set().values()).next;

function privateIterator<T>(
  iterator: object,
  next: (this: object) => IteratorResult<T>
): IterableIterator<T> {
  return {
    next() {
      return apply(next, iterator, []);
    },
    [Symbol.iterator]() {
      return this;
    }
  };
}

export class ScopeBindingMap<K, V> implements Iterable<[K, V]> {
  readonly #data = new NativeMap<K, V>();

  get size(): number {
    return apply(mapSize, this.#data, []);
  }
  get(key: K): V | undefined {
    return apply(mapGet, this.#data, [key]);
  }
  has(key: K): boolean {
    return apply(mapHas, this.#data, [key]);
  }
  set(key: K, value: V): void {
    apply(mapSet, this.#data, [key, value]);
  }
  delete(key: K): boolean {
    return apply(mapDelete, this.#data, [key]);
  }
  entries(): IterableIterator<[K, V]> {
    return privateIterator(apply(mapEntries, this.#data, []), mapNext);
  }
  values(): IterableIterator<V> {
    return privateIterator(apply(mapValues, this.#data, []), mapNext);
  }
  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }
}

export class ScopeBindingSet<T> implements Iterable<T> {
  readonly #data = new NativeSet<T>();

  has(value: T): boolean {
    return apply(setHas, this.#data, [value]);
  }
  add(value: T): void {
    apply(setAdd, this.#data, [value]);
  }
  delete(value: T): boolean {
    return apply(setDelete, this.#data, [value]);
  }
  [Symbol.iterator](): IterableIterator<T> {
    return privateIterator(apply(setValues, this.#data, []), setNext);
  }
}
