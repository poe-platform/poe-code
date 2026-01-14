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
  const result: JsonObject = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) {
      continue;
    }
    const existing = result[key];
    if (isJsonObject(existing) && isJsonObject(value)) {
      result[key] = deepMergeJson(existing, value);
      continue;
    }
    result[key] = value;
  }
  return result;
}

export function pruneJsonByShape(
  target: JsonObject,
  shape: JsonObject
): { changed: boolean; result: JsonObject } {
  let changed = false;
  const result: JsonObject = { ...target };

  for (const [key, pattern] of Object.entries(shape)) {
    if (!(key in result)) {
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
        result[key] = childResult;
      }
      continue;
    }

    delete result[key];
    changed = true;
  }

  return { changed, result };
}
