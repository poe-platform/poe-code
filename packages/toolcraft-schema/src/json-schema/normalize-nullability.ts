import { dialectFor } from "./utils.js";
import type { Dialect } from "./types.js";

const schemaMaps = new Set(["properties", "$defs", "definitions", "patternProperties", "dependentSchemas", "dependencies"]);
const schemaArrays = new Set(["allOf", "anyOf", "oneOf", "prefixItems", "items"]);
const schemaValues = new Set(["items", "additionalProperties", "additionalItems", "contains", "not", "if", "then", "else", "propertyNames", "unevaluatedProperties", "unevaluatedItems"]);
const schemaIdentity = new Set(["$id", "id", "$schema", "$anchor", "$dynamicAnchor", "$defs", "definitions", "description", "default"]);

export function normalizeLegacyNullability(source: object): Record<string, unknown> {
  const locations = new Map<string, string>();
  const resourceIds = new Map<string, string>();
  const references: Array<{ holder: Record<string, unknown>; key: string; value: string; base: string }> = [];
  const pointer = (path: string[]) => path.length === 0 ? "" : `/${path.map((part) => part.split("~").join("~0").split("/").join("~1")).join("/")}`;
  const walk = (node: unknown, before: string[], after: string[], resourceBefore: string[], resourceAfter: string[], base = "https://toolcraft.invalid/schema", inheritedDialect: Dialect = "draft2020-12"): unknown => {
    if (typeof node !== "object" || node === null || Array.isArray(node)) return structuredClone(node);
    const object = node as Record<string, unknown>;
    const dialect = dialectFor(object, inheritedDialect);
    const identifier = dialect === "draft7" ? object.$id ?? object.id : object.$id;
    if (typeof identifier === "string") {
      resourceBefore = before; resourceAfter = after;
      base = new URL(identifier, base).href.split("#", 1)[0]!;
    }
    const resource = pointer(resourceBefore);
    resourceIds.set(base, resource);
    locations.set(`${resource}|${pointer(before.slice(resourceBefore.length))}`, pointer(after.slice(resourceAfter.length)));
    const result: Record<string, unknown> = {};
    const validation: Record<string, unknown> = {};
    const nullable = object.nullable === true;
    for (const [key, value] of Object.entries(object)) {
      if (key === "nullable") continue;
      const target = nullable && !schemaIdentity.has(key) ? validation : result;
      const nextAfter = [...after, ...(target === validation ? ["anyOf", "0"] : []), key];
      let converted: unknown;
      if (schemaMaps.has(key) && typeof value === "object" && value !== null && !Array.isArray(value)) {
        converted = Object.fromEntries(Object.entries(value).map(([name, child]) => [name,
          walk(child, [...before, key, name], [...nextAfter, name], resourceBefore, resourceAfter, base, dialect)]));
      } else if (schemaArrays.has(key) && Array.isArray(value)) {
        converted = value.map((child, index) => walk(child, [...before, key, String(index)], [...nextAfter, String(index)], resourceBefore, resourceAfter, base, dialect));
      } else if (schemaValues.has(key)) {
        converted = walk(value, [...before, key], nextAfter, resourceBefore, resourceAfter, base, dialect);
      } else converted = structuredClone(value);
      Object.defineProperty(target, key, { value: converted, enumerable: true, configurable: true, writable: true });
      if ((key === "$ref" || key === "$dynamicRef") && typeof value === "string") references.push({ holder: target, key, value, base });
    }
    if (nullable) result.anyOf = [validation, { type: "null" }];
    return result;
  };
  const normalized = walk(source, [], [], [], []) as Record<string, unknown>;
  for (const reference of references) {
    const resolved = new URL(reference.value, reference.base);
    if (!resolved.hash.startsWith("#/")) continue;
    const resource = resourceIds.get(resolved.href.slice(0, -resolved.hash.length));
    if (resource === undefined) continue;
    const original = decodeURIComponent(resolved.hash.slice(1));
    const destination = locations.get(`${resource}|${original}`);
    if (destination !== undefined && destination !== original) {
      reference.holder[reference.key] = `${reference.value.slice(0, reference.value.indexOf("#") + 1)}${destination}`;
    }
  }
  return normalized;
}
