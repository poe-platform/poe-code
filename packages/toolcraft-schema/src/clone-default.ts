export function cloneDefaultValue<Value>(value: Value): Value {
  const copies = new WeakMap<object, object>();

  function copy(current: unknown): unknown {
    if (current === null || typeof current !== "object") return current;
    const existing = copies.get(current);
    if (existing !== undefined) return existing;

    const prototype = Object.getPrototypeOf(current);
    if (!Array.isArray(current) && prototype !== Object.prototype && prototype !== null) {
      return current;
    }

    const result = Array.isArray(current) ? new Array(current.length) : Object.create(prototype);
    copies.set(current, result);
    for (const key of Object.keys(current)) {
      Object.defineProperty(result, key, {
        value: copy((current as Record<string, unknown>)[key]),
        enumerable: true,
        configurable: true,
        writable: true
      });
    }
    return result;
  }

  return copy(value) as Value;
}
