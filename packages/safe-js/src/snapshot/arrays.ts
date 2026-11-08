import type { SerializedSymbolProperty } from "./symbols.js";

export type SerializedArray<TValue> =
  ({ symbolEntries?: Array<SerializedSymbolProperty<TValue>> } & (
  | { kind: "array"; items: TValue[] }
  | { kind: "array"; length: number; entries: Record<string, TValue> }));

export function requiresArrayEntries(value: unknown[]): boolean {
  const keys = Object.keys(value);
  return keys.length !== value.length || keys.some((key, index) => key !== String(index));
}

export function serializeArray<TValue>(
  value: unknown[],
  serializeValue: (entry: unknown, key: string) => TValue
): SerializedArray<TValue> {
  if (!requiresArrayEntries(value)) {
    return {
      kind: "array",
      items: Array.from({ length: value.length }, (_, index) => {
        const key = String(index);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return serializeValue(
          descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined,
          key
        );
      })
    };
  }

  const entries = Object.create(null) as Record<string, TValue>;
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && "value" in descriptor) {
      entries[key] = serializeValue(descriptor.value, key);
    }
  }
  return { kind: "array", length: value.length, entries };
}
