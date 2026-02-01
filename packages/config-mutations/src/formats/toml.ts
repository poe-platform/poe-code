import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { ConfigFormat, ConfigObject, ConfigValue } from "../types.js";

function isConfigObject(value: unknown): value is ConfigObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parse(content: string): ConfigObject {
  if (!content || content.trim() === "") {
    return {};
  }
  const parsed = parseToml(content);
  if (!isConfigObject(parsed)) {
    throw new Error("Expected TOML document to be a table.");
  }
  return parsed as ConfigObject;
}

function serialize(obj: ConfigObject): string {
  const serialized = stringifyToml(obj);
  return serialized.endsWith("\n") ? serialized : `${serialized}\n`;
}

function merge(base: ConfigObject, patch: ConfigObject): ConfigObject {
  const result: ConfigObject = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }
    const existing = result[key];
    if (isConfigObject(existing) && isConfigObject(value)) {
      result[key] = merge(existing, value);
      continue;
    }
    result[key] = value as ConfigValue;
  }
  return result;
}

function prune(
  obj: ConfigObject,
  shape: ConfigObject
): { changed: boolean; result: ConfigObject } {
  let changed = false;
  const result: ConfigObject = { ...obj };

  for (const [key, pattern] of Object.entries(shape)) {
    if (!(key in result)) {
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
        result[key] = childResult;
      }
      continue;
    }

    delete result[key];
    changed = true;
  }

  return { changed, result };
}

export const tomlFormat: ConfigFormat = {
  parse,
  serialize,
  merge,
  prune
};
