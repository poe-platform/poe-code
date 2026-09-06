import { setSandboxPrototype } from "./object-model.js";

const rawJsonValues = new WeakSet<object>();

export function createRawJson(text: string): Readonly<{ rawJSON: string }> {
  if (text.length === 0 || text.trim() !== text) throw new SyntaxError("Invalid raw JSON text.");
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed === "object" && parsed !== null) throw new SyntaxError("Raw JSON requires a primitive value.");
  const value = Object.create(null) as { rawJSON: string };
  value.rawJSON = text;
  setSandboxPrototype(value, null);
  Object.freeze(value);
  rawJsonValues.add(value);
  return value;
}

export function isRawJson(value: unknown): value is Readonly<{ rawJSON: string }> {
  return typeof value === "object" && value !== null && rawJsonValues.has(value);
}
