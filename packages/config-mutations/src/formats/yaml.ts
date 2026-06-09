import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { ConfigFormat, ConfigObject, ConfigValue } from "../types.js";
import { cloneConfigObject, hasConfigEntry, setConfigEntry } from "./object.js";

function isConfigObject(value: unknown): value is ConfigObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parse(content: string): ConfigObject {
  if (!content || content.trim() === "") {
    return {};
  }
  const parsed = parseYaml(content);
  if (parsed === null || parsed === undefined) {
    return {};
  }
  if (!isConfigObject(parsed)) {
    throw new Error("Expected YAML object.");
  }
  return cloneConfigObject(parsed);
}

function serialize(obj: ConfigObject): string {
  const serialized = stringifyYaml(obj);
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

    if (isConfigObject(pattern) && Object.keys(pattern).length === 0) {
      delete result[key];
      changed = true;
      continue;
    }

    if (isConfigObject(pattern) && isConfigObject(current)) {
      const { changed: childChanged, result: childResult } = prune(current, pattern);
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

export const yamlFormat: ConfigFormat = {
  parse,
  serialize,
  merge,
  prune
};
