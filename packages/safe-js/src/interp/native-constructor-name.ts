import { types } from "node:util";

// Diagnostics must not acquire host authority by reading constructor/name getters.
export function nativeConstructorName(value: object): string | undefined {
  if (types.isProxy(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  const descriptor =
    Object.getOwnPropertyDescriptor(value, "constructor") ??
    (prototype !== null && !types.isProxy(prototype)
      ? Object.getOwnPropertyDescriptor(prototype, "constructor")
      : undefined);
  const constructor = descriptor?.value;
  if (typeof constructor !== "function" || types.isProxy(constructor)) return undefined;
  const name = Object.getOwnPropertyDescriptor(constructor, "name")?.value;
  return typeof name === "string" ? name : undefined;
}
