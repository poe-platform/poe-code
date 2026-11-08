import type { SandboxGenerator, SandboxObject } from "./values.js";

export const generatorGuestProperties = new WeakMap<object, SandboxObject>();

export function getGeneratorProperties(value: SandboxGenerator): SandboxObject {
  let properties = generatorGuestProperties.get(value);
  if (properties === undefined) {
    properties = Object.create(null) as SandboxObject;
    generatorGuestProperties.set(value, properties);
  }
  return properties;
}
