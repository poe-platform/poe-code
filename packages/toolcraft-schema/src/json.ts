import { withStandardSchema, type Standardized } from "./standard.js";
import type { SchemaBase } from "./index.js";

type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | { [key: string]: JsonValue } | JsonValue[];

export interface JsonValueSchema extends SchemaBase<"json", JsonValue> {
  readonly kind: "json";
  readonly const?: JsonValue;
  readonly enum?: readonly JsonValue[];
}

type ConfiguredJson<TOptions> = JsonValueSchema & (TOptions extends { readonly default: infer Value }
  ? undefined extends Value ? unknown : { readonly default: JsonValue }
  : unknown);

export function Json<const TOptions extends Omit<JsonValueSchema, "kind"> = Record<never, never>>(
  options: TOptions = {} as TOptions
): Standardized<ConfiguredJson<TOptions>> {
  return withStandardSchema({
    kind: "json",
    ...options,
  } as ConfiguredJson<TOptions>);
}

export interface JsonValueValidationOptions {
  readonly maxNodes?: number;
  readonly maxDepth?: number;
}

export function isJsonValue(value: unknown, options: JsonValueValidationOptions = {}): boolean {
  const maxNodes = options.maxNodes ?? 10_000;
  const maxDepth = options.maxDepth ?? 64;
  if (maxNodes !== Infinity && (!Number.isSafeInteger(maxNodes) || maxNodes < 1)) throw new Error("maxNodes must be a positive safe integer");
  if (maxDepth !== Infinity && (!Number.isSafeInteger(maxDepth) || maxDepth < 0)) throw new Error("maxDepth must be a nonnegative safe integer");
  const ancestors = new Set<object>();
  const stack: { owner: object; children: Generator<PropertyDescriptor | undefined>; depth: number }[] = [];
  function* properties(item: object): Generator<PropertyDescriptor | undefined> {
    if (Array.isArray(item)) {
      for (let index = 0; index < item.length; index++) yield Object.getOwnPropertyDescriptor(item, String(index));
    } else for (const key in item) {
      const property = Object.getOwnPropertyDescriptor(item, key);
      if (property !== undefined) yield property;
    }
  }
  let nodes = 0;
  let item = value, depth = 0;
  while (true) {
    if (++nodes > maxNodes || depth > maxDepth) return false;
    if (item !== null && typeof item !== "string" && typeof item !== "boolean") {
      if (typeof item === "number") {
        if (!Number.isFinite(item)) return false;
      } else {
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
        if (Array.isArray(item) && item.length > maxNodes) return false;
        ancestors.add(item);
        stack.push({ owner: item, children: properties(item), depth });
      }
    }
    let next: IteratorResult<PropertyDescriptor | undefined> | undefined;
    while (stack.length) {
      const frame = stack[stack.length - 1];
      next = frame.children.next();
      if (!next.done) {
        if (next.value === undefined || !("value" in next.value)) return false;
        item = next.value.value;
        depth = frame.depth + 1;
        break;
      }
      ancestors.delete(frame.owner);
      stack.pop();
    }
    if (!stack.length) return true;
  }
}
