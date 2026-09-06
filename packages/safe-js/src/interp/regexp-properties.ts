import type { SandboxObject, SandboxRegex } from "./values.js";

export const regexGuestProperties = new WeakMap<object, SandboxObject>();

export function getRegexProperties(value: SandboxRegex): SandboxObject {
  const properties = regexGuestProperties.get(value);
  if (properties === undefined) throw new TypeError("Invalid sandbox RegExp storage.");
  return properties;
}
