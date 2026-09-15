import type { OpObjectBackendOptions } from "./types.js";

const format = "@poe-platform/op/snapshot";

function encode(value: unknown, ancestors: Set<object>): unknown[] {
  if (value === undefined) return ["undefined"];
  if (typeof value === "number" && Object.is(value, -0)) return ["negative-zero"];
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return ["value", value];
  if (typeof value !== "object" || value === null) throw new Error("Unsupported snapshot value");
  if (ancestors.has(value)) throw new Error("Cyclic snapshot state");
  if (Object.getOwnPropertySymbols(value).length) throw new Error("Unsupported snapshot symbol keys");
  if (value instanceof Uint8Array) {
    if (Object.getOwnPropertyNames(value).length !== value.length) throw new Error("Unsupported extended snapshot bytes");
    return ["bytes", Array.from(value)];
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getOwnPropertyNames(value).length !== value.length + 1) throw new Error("Unsupported sparse or extended snapshot array");
      return ["array", Array.from({ length: value.length }, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor)) throw new Error("Unsupported snapshot array property");
        return encode(descriptor.value, ancestors);
      })];
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error("Unsupported snapshot object");
    const entries = Object.entries(Object.getOwnPropertyDescriptors(value)).map(([key, descriptor]) => {
      if (!descriptor.enumerable || !("value" in descriptor)) throw new Error("Unsupported snapshot property");
      return [key, encode(descriptor.value, ancestors)];
    });
    return [prototype === null ? "null-object" : "object", entries];
  } finally {
    ancestors.delete(value);
  }
}

function decode(node: unknown): unknown {
  if (!Array.isArray(node)) throw new Error("Invalid snapshot node");
  const [tag, value] = node;
  if (node.length === 1 && tag === "undefined") return undefined;
  if (node.length === 1 && tag === "negative-zero") return -0;
  if (node.length !== 2) throw new Error("Invalid snapshot node");
  if (tag === "value" && (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)))) return value;
  if (!Array.isArray(value)) throw new Error("Invalid snapshot payload");
  if (tag === "bytes") {
    if (!value.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) throw new Error("Invalid snapshot bytes");
    return new Uint8Array(value);
  }
  if (tag === "array") return value.map(decode);
  if (tag === "object" || tag === "null-object") {
    const result: Record<string, unknown> = tag === "object" ? {} : Object.create(null);
    for (const entry of value) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || Object.hasOwn(result, entry[0])) throw new Error("Invalid snapshot object entry");
      Object.defineProperty(result, entry[0], { value: decode(entry[1]), enumerable: true, configurable: true, writable: true });
    }
    return result;
  }
  throw new Error("Unknown snapshot node type");
}

export function encodeSnapshot(seed: OpObjectBackendOptions): string {
  return JSON.stringify([format, 1, encode(seed, new Set())]);
}

export function decodeSnapshot(text: string): OpObjectBackendOptions {
  let value: unknown = JSON.parse(text);
  if (Array.isArray(value)) {
    if (value.length !== 3 || value[0] !== format || value[1] !== 1) throw new Error("Unsupported snapshot format");
    value = decode(value[2]);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new Error("Snapshot must contain an object seed");
  return value as OpObjectBackendOptions;
}
