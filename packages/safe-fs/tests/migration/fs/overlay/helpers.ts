import type { FileSystem } from "../../../../src/contracts/index.js";

export function wrapped(backend: FileSystem, overrides: Partial<FileSystem>): FileSystem {
  return new Proxy(backend, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
