import type { SchemaBase } from "./index.js";

type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | { [key: string]: JsonValue } | JsonValue[];

export interface JsonValueSchema extends SchemaBase<"json", JsonValue> {
  readonly kind: "json";
  readonly const?: JsonValue;
  readonly enum?: readonly JsonValue[];
}

export function Json(options: Omit<JsonValueSchema, "kind"> = {}): JsonValueSchema {
  return {
    kind: "json",
    ...options,
  };
}

export function isJsonValue(value: unknown): boolean {
  const ancestors = new Set<object>();
  let nodes = 0;
  const visit = (item: unknown, depth: number): boolean => {
    if (++nodes > 10_000 || depth > 64) return false;
    if (item === null || typeof item === "string" || typeof item === "boolean") return true;
    if (typeof item === "number") return Number.isFinite(item);
    if (typeof item !== "object" || ancestors.has(item)) return false;
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype &&
        Object.getPrototypeOf(item) !== null) return false;
    let hookOwner: object | null = item;
    let prototypeDepth = 0;
    while (hookOwner !== null) {
      if (++prototypeDepth > 64) return false;
      const serializationHook = Object.getOwnPropertyDescriptor(hookOwner, "toJSON");
      if (serializationHook !== undefined) {
        if (!("value" in serializationHook) || typeof serializationHook.value === "function") return false;
        break;
      }
      hookOwner = Object.getPrototypeOf(hookOwner) as object | null;
    }
    ancestors.add(item);
    let valid = true;
    if (Array.isArray(item)) {
      if (item.length > 10_000) valid = false;
      else for (let index = 0; index < item.length; index++) {
        const property = Object.getOwnPropertyDescriptor(item, String(index));
        if (property === undefined || !("value" in property) || !visit(property.value, depth + 1)) {
          valid = false;
          break;
        }
      }
    } else for (const key in item) {
      const property = Object.getOwnPropertyDescriptor(item, key);
      if (property !== undefined && (!("value" in property) || !visit(property.value, depth + 1))) {
        valid = false;
        break;
      }
    }
    ancestors.delete(item);
    return valid;
  };
  return visit(value, 0);
}
