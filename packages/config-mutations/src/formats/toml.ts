import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { ConfigFormat, ConfigObject, ConfigValue } from "../types.js";
import { isConfigObject } from "../types.js";
import { cloneConfigObject, hasConfigEntry, setConfigEntry } from "./object.js";

function parse(content: string): ConfigObject {
  if (!content || content.trim() === "") {
    return {};
  }
  const parsed = parseToml(content);
  if (!isConfigObject(parsed)) {
    throw new Error("Expected TOML document to be a table.");
  }
  return cloneConfigObject(parsed as ConfigObject);
}

function serialize(obj: ConfigObject): string {
  const serialized = stringifyToml(obj);
  return serialized.endsWith("\n") ? serialized : `${serialized}\n`;
}

function merge(base: ConfigObject, patch: ConfigObject): ConfigObject {
  const result = cloneConfigObject(base);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }
    const existing = hasConfigEntry(result, key) ? result[key] : undefined;
    if (isConfigObject(existing) && isConfigObject(value)) {
      setConfigEntry(result, key, merge(existing, value));
      continue;
    }
    setConfigEntry(result, key, value as ConfigValue);
  }
  return result;
}

function prune(
  obj: ConfigObject,
  shape: ConfigObject
): { changed: boolean; result: ConfigObject } {
  let changed = false;
  const result = cloneConfigObject(obj);

  for (const [key, pattern] of Object.entries(shape)) {
    if (!hasConfigEntry(result, key)) {
      continue;
    }

    const current = result[key];

    // Empty object pattern means "delete this key entirely"
    if (isConfigObject(pattern) && Object.keys(pattern).length === 0) {
      delete result[key];
      changed = true;
      continue;
    }

    // Non-empty object pattern with object current: recurse
    if (isConfigObject(pattern) && isConfigObject(current)) {
      const { changed: childChanged, result: childResult } = prune(
        current,
        pattern
      );
      if (childChanged) {
        changed = true;
      }
      if (Object.keys(childResult).length === 0) {
        delete result[key];
      } else {
        setConfigEntry(result, key, childResult);
      }
      continue;
    }

    if (!isConfigObject(pattern) || Object.keys(pattern).length === 0) {
      delete result[key];
      changed = true;
    }
  }

  return { changed, result };
}

export const tomlFormat: ConfigFormat = {
  parse,
  serialize,
  merge,
  prune
};
