const mapSize = Object.getOwnPropertyDescriptor(Map.prototype, "size")!.get!;
const mapEntries = Map.prototype.entries;
const setSize = Object.getOwnPropertyDescriptor(Set.prototype, "size")!.get!;
const setValues = Set.prototype.values;

export function readNativeMap(value: Map<unknown, unknown>, allowSubclass = false) {
  if (!allowSubclass && Object.getPrototypeOf(value) !== Map.prototype)
    throw new TypeError("Map subclasses are not supported.");
  return {
    size: Reflect.apply(mapSize, value, []) as number,
    entries: Reflect.apply(mapEntries, value, []) as MapIterator<[unknown, unknown]>
  };
}

export function readNativeSet(value: Set<unknown>, allowSubclass = false) {
  if (!allowSubclass && Object.getPrototypeOf(value) !== Set.prototype)
    throw new TypeError("Set subclasses are not supported.");
  return {
    size: Reflect.apply(setSize, value, []) as number,
    entries: Reflect.apply(setValues, value, []) as SetIterator<unknown>
  };
}
