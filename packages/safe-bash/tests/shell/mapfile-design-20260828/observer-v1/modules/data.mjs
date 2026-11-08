export const moduleUrl = import.meta.url;

export function snapshotOwnData(value) {
  let nodes = 0;
  const visit = (item, depth) => {
    if (++nodes > 32768 || depth > 64) throw new TypeError("own-data work limit");
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (typeof item !== "object" || item === null) throw new TypeError("finite own-data value required");
    const keys = Reflect.ownKeys(item);
    if (keys.length > 4096 || keys.some(key => typeof key !== "string")) throw new TypeError("own-data keys invalid");
    const descriptors = new Map(keys.map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new TypeError("own-data accessor refused");
      return [key, descriptor];
    }));
    if (Array.isArray(item)) {
      const length = descriptors.get("length")?.value;
      if (!Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1) throw new TypeError("own-data array shape");
      const result = [];
      for (let index = 0; index < length; index++) {
        const descriptor = descriptors.get(String(index));
        if (!descriptor) throw new TypeError("own-data array hole or extra");
        result.push(visit(descriptor.value, depth + 1));
      }
      return result;
    }
    const result = Object.create(null);
    for (const key of keys) result[key] = visit(descriptors.get(key).value, depth + 1);
    return result;
  };
  return visit(value, 0);
}

export function assertOwnData(actual, expected, message = "own-data mismatch") {
  const left = snapshotOwnData(actual), right = snapshotOwnData(expected);
  const equal = (first, second) => {
    if (first === null || second === null || typeof first !== "object" || typeof second !== "object") return Object.is(first, second);
    if (Array.isArray(first) !== Array.isArray(second)) return false;
    const firstKeys = Object.keys(first).sort(), secondKeys = Object.keys(second).sort();
    return firstKeys.length === secondKeys.length && firstKeys.every((key, index) => key === secondKeys[index] && equal(first[key], second[key]));
  };
  if (!equal(left, right)) throw new TypeError(message);
}

export function describeReason(reason) {
  if (reason === null) return "null";
  if (typeof reason === "string") return reason.slice(0, 2048);
  if (["undefined", "boolean", "number", "bigint"].includes(typeof reason)) return String(reason).slice(0, 2048);
  try {
    const descriptor = Object.getOwnPropertyDescriptor(reason, "message");
    if (descriptor && Object.hasOwn(descriptor, "value") && typeof descriptor.value === "string") return descriptor.value.slice(0, 2048);
  } catch {}
  return "opaque thrown value";
}

export function preserveReason(record, reason) {
  if (!Object.hasOwn(record, "failureReason")) Object.defineProperty(record, "failureReason", { value: reason });
}
