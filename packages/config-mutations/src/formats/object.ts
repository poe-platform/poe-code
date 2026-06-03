import type { ConfigObject, ConfigValue } from "../types.js";

export function cloneConfigObject(value: ConfigObject): ConfigObject {
  const result: ConfigObject = {};
  for (const [key, entry] of Object.entries(value)) {
    setConfigEntry(result, key, cloneConfigValue(entry));
  }
  return result;
}

export function setConfigEntry(target: ConfigObject, key: string, value: ConfigValue): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value
  });
}

export function hasConfigEntry(target: ConfigObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function cloneConfigValue(value: ConfigValue): ConfigValue {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneConfigValue(entry));
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return cloneConfigObject(value as ConfigObject);
  }
  return value;
}
