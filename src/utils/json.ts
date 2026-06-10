export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function deepMergeJson(
  target: JsonObject,
  source: JsonObject
): JsonObject {
  const result = cloneJsonObject(target);
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) {
      continue;
    }
    const existing = hasOwnJsonValue(result, key) ? result[key] : undefined;
    if (isJsonObject(existing) && isJsonObject(value)) {
      setOwnJsonValue(result, key, deepMergeJson(existing, value));
      continue;
    }
    setOwnJsonValue(result, key, value);
  }
  return result;
}

export function pruneJsonByShape(
  target: JsonObject,
  shape: JsonObject
): { changed: boolean; result: JsonObject } {
  let changed = false;
  const result = cloneJsonObject(target);

  for (const [key, pattern] of Object.entries(shape)) {
    if (!hasOwnJsonValue(result, key)) {
      continue;
    }

    const current = result[key];

    if (isJsonObject(pattern) && isJsonObject(current)) {
      const { changed: childChanged, result: childResult } = pruneJsonByShape(
        current,
        pattern
      );
      if (childChanged) {
        changed = true;
      }
      if (Object.keys(childResult).length === 0) {
        delete result[key];
      } else {
        setOwnJsonValue(result, key, childResult);
      }
      continue;
    }

    delete result[key];
    changed = true;
  }

  return { changed, result };
}

function cloneJsonObject(value: JsonObject): JsonObject {
  const result: JsonObject = {};

  for (const [key, item] of Object.entries(value)) {
    setOwnJsonValue(result, key, item);
  }

  return result;
}

function hasOwnJsonValue(value: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function setOwnJsonValue(target: JsonObject, key: string, value: JsonValue): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value
  });
}
