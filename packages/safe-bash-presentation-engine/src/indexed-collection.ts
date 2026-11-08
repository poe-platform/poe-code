import { ValueError } from "./errors.js";

export function indexed<T extends { get(index: number): unknown }>(target: T): T {
  return new Proxy(target, {
    get(object, key) {
      if (typeof key === "string" && key !== "" && String(Number(key)) === key)
        return object.get(Number(key));
      const value = Reflect.get(object, key, object);
      return typeof value === "function" ? value.bind(object) : value;
    },
    set(object, key, value) {
      if (typeof key === "string" && key !== "" && String(Number(key)) === key)
        throw new ValueError("Collection entries are read-only.");
      return Reflect.set(object, key, value, object);
    },
    defineProperty(object, key, descriptor) {
      if (typeof key === "string" && key !== "" && String(Number(key)) === key)
        throw new ValueError("Collection entries are read-only.");
      return Reflect.defineProperty(object, key, descriptor);
    },
    deleteProperty(object, key) {
      if (typeof key === "string" && key !== "" && String(Number(key)) === key)
        throw new ValueError("Collection entries are read-only.");
      return Reflect.deleteProperty(object, key);
    }
  });
}
